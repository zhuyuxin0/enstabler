"""Publish classifications to FlowRiskOracle on 0G Galileo.

Direct web3.py path for M3. Swap to KeeperHub MCP by replacing
`_send_tx` in this file — everything else stays the same.

Publish policy to keep gas use sane during the demo:
  - Only classifications with risk_level >= 2
  - Rate-limit: one tx per PUBLISH_COOLDOWN_SECONDS
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

from eth_account import Account
from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.types import TxReceipt

from agent import db

log = logging.getLogger("enstabler.publisher")

PUBLISH_COOLDOWN_SECONDS = 15
PUBLISH_MIN_RISK = 2  # only risk_level >= 2 go on-chain

_FLOW_RISK_ORACLE_ABI = [
    {
        "type": "function",
        "name": "publishScore",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_stablecoin", "type": "address"},
            {"name": "_flowHash", "type": "uint256"},
            {"name": "_riskLevel", "type": "uint8"},
            {"name": "_classification", "type": "string"},
            {"name": "_storageRootHash", "type": "bytes32"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "function",
        "name": "getScoreCount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "type": "event",
        "name": "FlowScored",
        "inputs": [
            {"name": "scoreId", "type": "uint256", "indexed": True},
            {"name": "stablecoin", "type": "address", "indexed": False},
            {"name": "riskLevel", "type": "uint8", "indexed": False},
            {"name": "classification", "type": "string", "indexed": False},
        ],
    },
]


@dataclass
class PublishArgs:
    classification_id: int
    stablecoin_address: str
    flow_hash: int            # uint256 — we use int(tx_hash hex, 16) or a hash of (chain,tx,log)
    risk_level: int
    classification: str
    storage_root_hash: bytes  # 32 bytes; zero-bytes for now until 0G Storage is wired


class Publisher:
    """Publishes classifications to FlowRiskOracle. Single-writer; has its own
    asyncio.Lock to serialise tx sends and prevent nonce races."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last_tx_ts: float = 0.0
        self._w3: Optional[AsyncWeb3] = None
        self._contract = None
        self._account = None
        self._chain_id: Optional[int] = None

    async def setup(self) -> bool:
        rpc = os.getenv("OG_RPC_URL")
        key = os.getenv("OG_PRIVATE_KEY")
        oracle_addr = os.getenv("FLOW_RISK_ORACLE_ADDRESS")
        if not (rpc and key and oracle_addr):
            log.warning("publisher: OG_RPC_URL / OG_PRIVATE_KEY / FLOW_RISK_ORACLE_ADDRESS missing, disabled")
            return False
        self._w3 = AsyncWeb3(AsyncHTTPProvider(rpc))
        self._account = Account.from_key(key)
        self._contract = self._w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(oracle_addr),
            abi=_FLOW_RISK_ORACLE_ABI,
        )
        self._chain_id = await self._w3.eth.chain_id
        log.info(
            "publisher: ready (chain_id=%s, oracle=%s, agent=%s)",
            self._chain_id, oracle_addr, self._account.address,
        )
        return True

    async def maybe_publish(self, args: PublishArgs) -> Optional[str]:
        """Publish if policy allows. Returns tx hash if published, else None."""
        if self._contract is None:
            return None
        if args.risk_level < PUBLISH_MIN_RISK:
            return None
        now = time.time()
        if now - self._last_tx_ts < PUBLISH_COOLDOWN_SECONDS:
            return None
        async with self._lock:
            # re-check cooldown inside the lock
            if time.time() - self._last_tx_ts < PUBLISH_COOLDOWN_SECONDS:
                return None
            try:
                tx_hash, score_id = await self._send_tx(args)
                self._last_tx_ts = time.time()
                await db.mark_published(args.classification_id, score_id, tx_hash)
                log.info(
                    "publisher: published cls_id=%s score_id=%s tx=%s",
                    args.classification_id, score_id, tx_hash,
                )
                return tx_hash
            except Exception as e:
                log.warning("publisher: send failed: %s", e)
                return None

    async def _send_tx(self, args: PublishArgs) -> tuple[str, int]:
        """Build, sign, and broadcast the publishScore tx. Returns (tx_hash_hex, score_id).

        Swap this method's body to call KeeperHub MCP when wiring is ready.
        """
        assert self._w3 and self._contract and self._account and self._chain_id is not None

        nonce = await self._w3.eth.get_transaction_count(self._account.address, "pending")
        gas_price = await self._w3.eth.gas_price

        stablecoin_addr = AsyncWeb3.to_checksum_address(args.stablecoin_address)
        tx = await self._contract.functions.publishScore(
            stablecoin_addr,
            args.flow_hash,
            args.risk_level,
            args.classification,
            args.storage_root_hash,
        ).build_transaction({
            "from": self._account.address,
            "nonce": nonce,
            "gasPrice": gas_price,
            "chainId": self._chain_id,
        })
        signed = self._account.sign_transaction(tx)
        tx_hash = await self._w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt: TxReceipt = await self._w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        score_id = -1
        event = self._contract.events.FlowScored()
        try:
            logs = event.process_receipt(receipt)
            if logs:
                score_id = int(logs[0]["args"]["scoreId"])
        except Exception:
            pass

        return tx_hash.hex(), score_id
