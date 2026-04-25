"""Depeg-triggered protective swap via KeeperHub Direct Execution.

When the USDC/USDT pairwise spread exceeds 50 bps, swap a fixed-size amount
from the strong stable into the weak stable on Uniswap V2 (Ethereum mainnet),
executed through KeeperHub's Turnkey-managed wallet.

User setup (one-time):
  1. KeeperHub dashboard → Settings → Wallet → copy address into KEEPERHUB_WALLET_ADDRESS
  2. Send some ETH (≥0.005 ETH for gas) to that address
  3. Send ~$200 USDC and ~$200 USDT to that address (covers swaps in both directions)

Approval: handled automatically on agent startup via setup() — sets uint256 max
allowance for both stables against the Uniswap V2 router. Idempotent.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Optional

import httpx

from agent import db, prices

log = logging.getLogger("enstabler.swap")

# Trigger policy
SPREAD_THRESHOLD = 0.005   # 50 bps pairwise USDC/USDT
COOLDOWN_SECONDS = 300     # 5 min between auto-triggered swaps
SWAP_AMOUNT_USD = 100.0
SLIPPAGE_TOLERANCE = 0.01  # 1% min-out floor

# Hybrid by design: depeg signal comes from mainnet USDC/USDT prices via
# Coingecko, swap *executes* on a configurable network. Sepolia by default —
# zero-cost demo; override KEEPERHUB_NETWORK=ethereum for production.
KEEPERHUB_BASE = "https://app.keeperhub.com"
KEEPERHUB_NETWORK = os.getenv("KEEPERHUB_NETWORK", "sepolia")

# Token + router addresses are env-overridable so we can flip networks without
# touching code. Defaults are the Sepolia set.
_DEFAULTS = {
    "sepolia": {
        # Circle's official Sepolia USDC (faucet: faucet.circle.com)
        "USDC": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        # Aave Sepolia mock USDT (faucet: app.aave.com Sepolia faucet)
        "USDT": "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
        # Uniswap V2 official Sepolia router
        "ROUTER": "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
    },
    "ethereum": {
        "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "ROUTER": "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    },
}
_DEFAULT = _DEFAULTS.get(KEEPERHUB_NETWORK, _DEFAULTS["sepolia"])

USDC_ADDR = os.getenv("SWAP_USDC_ADDRESS", _DEFAULT["USDC"])
USDT_ADDR = os.getenv("SWAP_USDT_ADDRESS", _DEFAULT["USDT"])
UNISWAP_V2_ROUTER = os.getenv("SWAP_ROUTER_ADDRESS", _DEFAULT["ROUTER"])

ERC20_ABI: list[dict] = [
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"},
                {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"},
                {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "who", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]

UNISWAP_V2_ABI: list[dict] = [
    {"name": "swapExactTokensForTokens", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
         {"name": "amountIn", "type": "uint256"},
         {"name": "amountOutMin", "type": "uint256"},
         {"name": "path", "type": "address[]"},
         {"name": "to", "type": "address"},
         {"name": "deadline", "type": "uint256"},
     ],
     "outputs": [{"name": "amounts", "type": "uint256[]"}]},
]

_last_swap_ts: float = 0.0
_setup_done: bool = False
_setup_lock = asyncio.Lock()


def _config() -> Optional[dict]:
    api_key = os.getenv("KEEPERHUB_API_KEY")
    wallet = os.getenv("KEEPERHUB_WALLET_ADDRESS")
    if not api_key or not wallet:
        return None
    return {"api_key": api_key, "wallet": wallet}


def is_configured() -> bool:
    return _config() is not None


def is_ready() -> bool:
    return _setup_done


async def _post(path: str, body: dict) -> tuple[int, dict]:
    cfg = _config()
    if cfg is None:
        return 0, {"error": "not configured"}
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as c:
            resp = await c.post(f"{KEEPERHUB_BASE}{path}", headers=headers, json=body)
            try:
                return resp.status_code, resp.json()
            except Exception:
                return resp.status_code, {"error": "non-json response", "text": resp.text[:300]}
    except Exception as e:
        return 0, {"error": str(e)}


def _is_success(status: int, body: dict) -> bool:
    """KeeperHub returns 200 for read calls and either 200 or 202 for writes
    (synchronous-completed). Treat both as success when the body says completed."""
    if status not in (200, 202):
        return False
    body_status = (body.get("status") or "").lower()
    if body_status and body_status not in ("completed", "pending", "running"):
        return False
    return True


async def _read_call(contract: str, func: str, args: list, abi: list) -> Optional[Any]:
    body = {
        "contractAddress": contract,
        "network": KEEPERHUB_NETWORK,
        "functionName": func,
        "functionArgs": json.dumps(args),
        "abi": json.dumps(abi),
    }
    status, data = await _post("/api/execute/contract-call", body)
    if _is_success(status, data):
        return data.get("result")
    log.warning("swap: read %s.%s failed: status=%s body=%s", contract, func, status, data)
    return None


async def _ensure_approvals(wallet: str) -> bool:
    MAX_UINT256 = (1 << 256) - 1
    targets = [(USDC_ADDR, "USDC"), (USDT_ADDR, "USDT")]
    for token_addr, name in targets:
        allowance_str = await _read_call(
            token_addr, "allowance", [wallet, UNISWAP_V2_ROUTER], ERC20_ABI
        )
        try:
            allowance = int(allowance_str) if allowance_str is not None else 0
        except (TypeError, ValueError):
            allowance = 0
        # Treat anything >= ~10^21 (a billion tokens) as effectively max
        if allowance >= 10 ** 21:
            log.info("swap: %s already approved (allowance=%d)", name, allowance)
            continue
        log.info("swap: setting max approval for %s", name)
        body = {
            "contractAddress": token_addr,
            "network": KEEPERHUB_NETWORK,
            "functionName": "approve",
            "functionArgs": json.dumps([UNISWAP_V2_ROUTER, str(MAX_UINT256)]),
            "abi": json.dumps(ERC20_ABI),
            "gasLimitMultiplier": "1.3",
        }
        status, data = await _post("/api/execute/contract-call", body)
        if not _is_success(status, data):
            log.warning("swap: %s approve failed: status=%s body=%s", name, status, data)
            return False
        log.info("swap: %s approve submitted (executionId=%s status=%s)",
                 name, data.get("executionId"), data.get("status"))
    return True


async def setup() -> bool:
    """Idempotent one-time setup: ensure max approvals for USDC and USDT."""
    global _setup_done
    cfg = _config()
    if cfg is None:
        log.info("swap: KEEPERHUB_API_KEY / KEEPERHUB_WALLET_ADDRESS not set; disabled")
        return False
    async with _setup_lock:
        if _setup_done:
            return True
        ok = await _ensure_approvals(cfg["wallet"])
        if ok:
            _setup_done = True
            log.info(
                "swap: ready (network=%s, wallet=%s, threshold=%dbps, amount=$%.0f)",
                KEEPERHUB_NETWORK, cfg["wallet"],
                int(SPREAD_THRESHOLD * 10_000), SWAP_AMOUNT_USD,
            )
        return ok


def _direction() -> tuple[str, str, str, str]:
    """Return (token_in_addr, token_in_sym, token_out_addr, token_out_sym).
    Buys the cheap stable so we move into the depegged side at favourable price."""
    usdc = prices.get_price("USDC") or 1.0
    usdt = prices.get_price("USDT") or 1.0
    if usdc <= usdt:
        return USDT_ADDR, "USDT", USDC_ADDR, "USDC"
    return USDC_ADDR, "USDC", USDT_ADDR, "USDT"


async def trigger_swap(spread: float, reason: str = "auto") -> Optional[str]:
    """Submit a protective swap via KeeperHub Direct Execution.
    Returns KeeperHub executionId on success, None otherwise."""
    global _last_swap_ts
    cfg = _config()
    if cfg is None:
        return None

    token_in, token_in_sym, token_out, token_out_sym = _direction()
    decimals = 6  # USDT and USDC both 6
    amount_in_raw = int(SWAP_AMOUNT_USD * (10 ** decimals))
    min_out_raw = int(amount_in_raw * (1 - SLIPPAGE_TOLERANCE))
    deadline = int(time.time()) + 600

    body = {
        "contractAddress": UNISWAP_V2_ROUTER,
        "network": KEEPERHUB_NETWORK,
        "functionName": "swapExactTokensForTokens",
        "functionArgs": json.dumps([
            str(amount_in_raw),
            str(min_out_raw),
            [token_in, token_out],
            cfg["wallet"],
            str(deadline),
        ]),
        "abi": json.dumps(UNISWAP_V2_ABI),
        "gasLimitMultiplier": "1.3",
    }
    status, data = await _post("/api/execute/contract-call", body)

    exec_id = data.get("executionId")
    kh_status = data.get("status")
    success = _is_success(status, data)
    error = (data.get("error") or data.get("details")) if not success else None

    swap_id = await db.insert_swap(
        ts=int(time.time()),
        trigger_reason=reason,
        spread=spread,
        token_in_symbol=token_in_sym,
        token_out_symbol=token_out_sym,
        amount_in_usd=SWAP_AMOUNT_USD,
        network=KEEPERHUB_NETWORK,
        keeperhub_execution_id=exec_id,
        keeperhub_status=kh_status,
        error=error,
    )

    if success and exec_id:
        _last_swap_ts = time.time()
        log.info(
            "swap: triggered %s→%s $%s spread=%.5f exec=%s status=%s",
            token_in_sym, token_out_sym, SWAP_AMOUNT_USD, spread, exec_id, kh_status,
        )
        # Telegram broadcast — fire-and-forget; import here to avoid cycle at module load
        from agent import telegram_bot
        asyncio.create_task(
            telegram_bot.broadcast_swap(
                token_in_sym, token_out_sym, SWAP_AMOUNT_USD, spread, exec_id, reason
            )
        )
    else:
        log.warning("swap: keeperhub failed status=%s body=%s", status, data)

    return exec_id


async def maybe_trigger() -> None:
    """Cheap path called after every price tick. Bails on threshold/cooldown."""
    cfg = _config()
    if cfg is None or not _setup_done:
        return
    usdc = prices.get_price("USDC")
    usdt = prices.get_price("USDT")
    if usdc is None or usdt is None:
        return
    spread = abs(usdc - usdt)
    if spread <= SPREAD_THRESHOLD:
        return
    if time.time() - _last_swap_ts < COOLDOWN_SECONDS:
        return
    await trigger_swap(spread, reason=f"USDC/USDT spread {spread*10_000:.1f}bps")
