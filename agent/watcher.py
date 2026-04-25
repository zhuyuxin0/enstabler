"""Data ingestion watcher.

Single source of live flow data: Alchemy WebSocket subscription to ERC-20
`Transfer` logs on USDT / USDC / DAI / PYUSD on Ethereum mainnet. Includes
exponential-backoff reconnect so transient drops don't lose flows.

(We previously also polled Bitquery for backfill, but in practice it added
~5% volume on a paid quota that didn't justify the operational tax.)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Optional

import websockets

from agent import pipeline
from agent.db import insert_flow
from agent.models import Flow
from agent.stablecoins import (
    BY_ADDRESS,
    ETHEREUM,
    TRANSFER_TOPIC0,
    raw_to_usd,
    topic_to_address,
)

log = logging.getLogger("enstabler.watcher")


def _alchemy_ws_url() -> Optional[str]:
    url = os.getenv("ALCHEMY_WS_URL")
    if url:
        return url
    key = os.getenv("ALCHEMY_API_KEY")
    if not key:
        return None
    return f"wss://eth-mainnet.g.alchemy.com/v2/{key}"


# ---------- Alchemy WebSocket ----------

async def alchemy_ws_task() -> None:
    ws_url = _alchemy_ws_url()
    if not ws_url:
        log.warning("alchemy: ALCHEMY_API_KEY / ALCHEMY_WS_URL not set, skipping")
        return

    backoff = 1.0
    while True:
        try:
            log.info("alchemy: connecting")
            async with websockets.connect(ws_url, ping_interval=20, ping_timeout=20) as ws:
                sub_id = await _alchemy_subscribe(ws)
                log.info("alchemy: subscribed id=%s", sub_id)
                backoff = 1.0
                async for raw in ws:
                    await _handle_alchemy_message(raw)
        except asyncio.CancelledError:
            log.info("alchemy: cancelled")
            raise
        except Exception as e:
            log.warning("alchemy: connection error: %s (reconnect in %.1fs)", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def _alchemy_subscribe(ws) -> str:
    addresses = [s.address for s in ETHEREUM.values()]
    req = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_subscribe",
        "params": [
            "logs",
            {"address": addresses, "topics": [TRANSFER_TOPIC0]},
        ],
    }
    await ws.send(json.dumps(req))
    while True:
        raw = await ws.recv()
        msg = json.loads(raw)
        if msg.get("id") == 1:
            if "result" in msg:
                return msg["result"]
            raise RuntimeError(f"alchemy subscribe failed: {msg}")


async def _handle_alchemy_message(raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return
    params = msg.get("params") or {}
    result = params.get("result")
    if not result:
        return

    contract = (result.get("address") or "").lower()
    stablecoin = BY_ADDRESS.get(contract)
    if not stablecoin:
        return

    topics = result.get("topics") or []
    if len(topics) < 3 or topics[0].lower() != TRANSFER_TOPIC0:
        return

    data = result.get("data") or "0x0"
    try:
        amount_raw = int(data, 16)
    except ValueError:
        return

    tx_hash = result.get("transactionHash", "")
    try:
        block_number = int(result.get("blockNumber", "0x0"), 16)
        log_index = int(result.get("logIndex", "0x0"), 16)
    except (TypeError, ValueError):
        return

    flow = Flow(
        source="alchemy_ws",
        chain="ethereum",
        tx_hash=tx_hash,
        log_index=log_index,
        block_number=block_number,
        ts=int(time.time()),  # we don't get block ts from logs; close enough for M2
        stablecoin=stablecoin.symbol,
        from_addr=topic_to_address(topics[1]),
        to_addr=topic_to_address(topics[2]),
        amount_raw=str(amount_raw),
        amount_usd=raw_to_usd(amount_raw, stablecoin.decimals),
    )
    flow_id = await insert_flow(flow)
    if flow_id:
        asyncio.create_task(pipeline.process_flow(flow_id))


