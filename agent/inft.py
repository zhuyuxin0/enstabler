"""ERC-7857 iNFT lifecycle: mint the Enstabler agent identity on 0G Chain.

Flow:
  1. On startup, read tokenOf(wallet) on AgentNFT contract.
  2. If 0, build the identity JSON (config + classifier rules + entity labels),
     upload to 0G Storage, and mint a token with the resulting Merkle root.
  3. If a token already exists, just refresh local state from chain.

Idempotent across restarts. Mint only ever happens once per wallet/contract pair.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

from eth_account import Account
from web3 import AsyncHTTPProvider, AsyncWeb3

log = logging.getLogger("enstabler.inft")

VERSION = "0.5.0"
DESCRIPTOR = "enstabler-heuristic-v1"

_AGENT_NFT_ABI: list[dict] = [
    {"type": "function", "name": "tokenOf", "stateMutability": "view",
     "inputs": [{"type": "address", "name": "holder"}],
     "outputs": [{"type": "uint256", "name": ""}]},
    {"type": "function", "name": "totalSupply", "stateMutability": "view",
     "inputs": [], "outputs": [{"type": "uint256", "name": ""}]},
    {"type": "function", "name": "ownerOf", "stateMutability": "view",
     "inputs": [{"type": "uint256", "name": "tokenId"}],
     "outputs": [{"type": "address", "name": ""}]},
    {"type": "function", "name": "metadata", "stateMutability": "view",
     "inputs": [{"type": "uint256", "name": ""}],
     "outputs": [
         {"type": "bytes32", "name": "storageRootHash"},
         {"type": "string", "name": "modelDescriptor"},
         {"type": "string", "name": "versionTag"},
         {"type": "uint256", "name": "mintedAt"},
         {"type": "uint256", "name": "lastUpdatedAt"},
     ]},
    {"type": "function", "name": "mint", "stateMutability": "nonpayable",
     "inputs": [
         {"type": "bytes32", "name": "_storageRootHash"},
         {"type": "string", "name": "_modelDescriptor"},
         {"type": "string", "name": "_versionTag"},
     ],
     "outputs": [{"type": "uint256", "name": ""}]},
    {"type": "function", "name": "updateMetadata", "stateMutability": "nonpayable",
     "inputs": [
         {"type": "uint256", "name": "tokenId"},
         {"type": "bytes32", "name": "_newStorageRootHash"},
         {"type": "string", "name": "_newVersionTag"},
     ],
     "outputs": []},
]

_state: dict[str, Any] = {
    "configured": False,
    "ready": False,
    "contract_address": None,
    "token_id": None,
    "owner": None,
    "storage_root_hash": None,
    "model_descriptor": None,
    "version_tag": None,
    "minted_at": None,
    "last_updated_at": None,
}


def _map_env_for_storage() -> None:
    if not os.getenv("A0G_PRIVATE_KEY"):
        og = os.getenv("OG_PRIVATE_KEY")
        if og:
            os.environ["A0G_PRIVATE_KEY"] = og.removeprefix("0x")
    if not os.getenv("A0G_RPC_URL"):
        rpc = os.getenv("OG_RPC_URL")
        if rpc:
            os.environ["A0G_RPC_URL"] = rpc
    if not os.getenv("A0G_INDEXER_RPC_URL"):
        idx = os.getenv("OG_STORAGE_INDEXER")
        if idx:
            os.environ["A0G_INDEXER_RPC_URL"] = idx


def _build_identity_blob() -> dict:
    from agent import classifier
    labels_path = Path("data/entity_labels.json")
    labels: dict = {}
    if labels_path.exists():
        with labels_path.open() as f:
            labels = json.load(f)
    return {
        "agent": "enstabler",
        "version": VERSION,
        "descriptor": DESCRIPTOR,
        "minted_at": int(time.time()),
        "classifier": {
            "type": "heuristic-rules",
            "classes": list(classifier.CLASSIFICATIONS),
            "rules_priority": [
                "is_mint_burn -> mint_burn",
                "entity_class_receiver == cex -> cex_flow",
                "stablecoin_spread > 0.001 -> arbitrage",
                "tx_frequency_sender > 10 -> bot",
                "value > $500K AND receiver_age_days < 7 -> suspicious",
                "default -> payment",
            ],
        },
        "entity_labels": labels,
        "data_sources": ["alchemy_ws", "coingecko", "circle_cctp_logs"],
        "supported_stablecoins": ["USDT", "USDC", "DAI", "PYUSD"],
        "execution": {
            "publisher": "FlowRiskOracle on 0G Galileo",
            "compute_provider": "0G Compute (qwen-2.5-7b-instruct, TDX TEE)",
            "storage": "0G Storage (Merkle-rooted flow snapshots, 30-min cadence)",
            "swap_executor": "KeeperHub Direct Execution → Uniswap V2 (Sepolia by default)",
        },
    }


async def _upload_identity() -> Optional[str]:
    _map_env_for_storage()
    blob = _build_identity_blob()
    fd, path = tempfile.mkstemp(prefix="enstabler-identity-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(blob, f, indent=2, default=str)
    try:
        from a0g.base import A0G

        def _do_upload():
            a = A0G()
            return a.upload_to_storage(Path(path))

        loop = asyncio.get_running_loop()
        obj = await loop.run_in_executor(None, _do_upload)
        log.info("inft: identity uploaded rootHash=%s", obj.root_hash)
        return obj.root_hash
    except Exception as e:
        log.warning("inft: identity upload failed: %s", e)
        return None
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


async def _refresh_state(contract, token_id: int, owner: str) -> None:
    md = await contract.functions.metadata(token_id).call()
    _state["token_id"] = int(token_id)
    _state["owner"] = owner
    _state["storage_root_hash"] = "0x" + md[0].hex()
    _state["model_descriptor"] = md[1]
    _state["version_tag"] = md[2]
    _state["minted_at"] = int(md[3])
    _state["last_updated_at"] = int(md[4])
    _state["ready"] = True


async def init() -> None:
    """Bootstrap our agent identity NFT. Idempotent."""
    addr = os.getenv("AGENT_NFT_ADDRESS")
    rpc = os.getenv("OG_RPC_URL")
    key = os.getenv("OG_PRIVATE_KEY")
    if not (addr and rpc and key):
        log.info("inft: AGENT_NFT_ADDRESS / OG_RPC_URL / OG_PRIVATE_KEY missing — disabled")
        return

    _state["configured"] = True
    _state["contract_address"] = addr

    try:
        w3 = AsyncWeb3(AsyncHTTPProvider(rpc))
        account = Account.from_key(key)
        contract = w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(addr),
            abi=_AGENT_NFT_ABI,
        )

        existing = await contract.functions.tokenOf(account.address).call()
        if existing > 0:
            log.info(
                "inft: wallet %s already owns tokenId=%s",
                account.address, existing,
            )
            await _refresh_state(contract, existing, account.address)
            return

        log.info("inft: no token yet — uploading identity to 0G Storage and minting")
        root_hash_hex = await _upload_identity()
        if not root_hash_hex:
            return
        root_bytes = bytes.fromhex(root_hash_hex.removeprefix("0x"))[:32].ljust(32, b"\x00")

        chain_id = await w3.eth.chain_id
        nonce = await w3.eth.get_transaction_count(account.address, "pending")
        gas_price = await w3.eth.gas_price

        tx = await contract.functions.mint(
            root_bytes, DESCRIPTOR, VERSION
        ).build_transaction({
            "from": account.address,
            "nonce": nonce,
            "gasPrice": gas_price,
            "chainId": chain_id,
        })
        signed = account.sign_transaction(tx)
        tx_hash = await w3.eth.send_raw_transaction(signed.raw_transaction)
        await w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        token_id = await contract.functions.tokenOf(account.address).call()
        log.info("inft: minted tokenId=%s tx=%s", token_id, tx_hash.hex())
        await _refresh_state(contract, token_id, account.address)
    except Exception as e:
        log.warning("inft: init failed: %s", e)


def get_state() -> dict:
    return dict(_state)
