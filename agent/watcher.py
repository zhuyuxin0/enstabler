"""Data ingestion watchers.

Two sources, both writing Flow rows into SQLite:
  - Alchemy WebSocket subscription for ERC-20 Transfer logs on USDT/USDC/DAI/PYUSD
  - Bitquery GraphQL HTTP poller (free tier; subscriptions require paid plan)

Both are async tasks spawned from the FastAPI lifespan.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Optional

import httpx
import websockets

from agent import pipeline
from agent.db import insert_flow, insert_flows
from agent.models import Flow
from agent.stablecoins import (
    BY_ADDRESS,
    ETHEREUM,
    TRANSFER_TOPIC0,
    raw_to_usd,
    topic_to_address,
)

log = logging.getLogger("enstabler.watcher")

BITQUERY_URL = "https://streaming.bitquery.io/eap"
BITQUERY_POLL_SECONDS = 30


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


# ---------- Bitquery GraphQL poller ----------

_BITQUERY_QUERY = """
query RecentStablecoinTransfers($since: DateTime, $addresses: [String!]) {
  EVM(network: eth) {
    Transfers(
      where: {
        Block: {Time: {since: $since}}
        Transfer: {Currency: {SmartContract: {in: $addresses}}}
      }
      orderBy: {descending: Block_Time}
      limit: {count: 200}
    ) {
      Block { Number Time }
      Transaction { Hash }
      Transfer {
        Amount
        AmountInUSD
        Sender
        Receiver
        Currency { SmartContract Symbol Decimals }
      }
    }
  }
}
"""


async def bitquery_task() -> None:
    key = os.getenv("BITQUERY_API_KEY")
    if not key:
        log.warning("bitquery: BITQUERY_API_KEY not set, skipping")
        return

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    addresses = [s.address for s in ETHEREUM.values()]

    # First poll looks back 2 minutes; subsequent polls look back the poll interval + a little slack.
    since_seconds_ago = 120
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            try:
                since_iso = _iso_seconds_ago(since_seconds_ago)
                resp = await client.post(
                    BITQUERY_URL,
                    headers=headers,
                    json={
                        "query": _BITQUERY_QUERY,
                        "variables": {"since": since_iso, "addresses": addresses},
                    },
                )
                if resp.status_code != 200:
                    log.warning("bitquery: http %s", resp.status_code)
                else:
                    body = resp.json()
                    if "errors" in body:
                        log.warning("bitquery: %s", body["errors"])
                    else:
                        flows = _bitquery_to_flows(body)
                        if flows:
                            new_ids = await insert_flows(flows)
                            log.info("bitquery: %d new flows (saw %d)", len(new_ids), len(flows))
                            for fid in new_ids:
                                asyncio.create_task(pipeline.process_flow(fid))
            except asyncio.CancelledError:
                log.info("bitquery: cancelled")
                raise
            except Exception as e:
                log.warning("bitquery: poll error: %s", e)
            since_seconds_ago = BITQUERY_POLL_SECONDS + 10
            await asyncio.sleep(BITQUERY_POLL_SECONDS)


def _iso_seconds_ago(seconds: int) -> str:
    import datetime
    dt = datetime.datetime.utcnow() - datetime.timedelta(seconds=seconds)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _bitquery_to_flows(body: dict[str, Any]) -> list[Flow]:
    transfers = (
        body.get("data", {})
            .get("EVM", {})
            .get("Transfers") or []
    )
    out: list[Flow] = []
    for t in transfers:
        try:
            block = t["Block"]
            tx = t["Transaction"]
            tr = t["Transfer"]
            cur = tr["Currency"]
            symbol = cur.get("Symbol") or "UNKNOWN"
            decimals = int(cur.get("Decimals") or 6)
            amount_human = tr.get("Amount") or "0"
            amount_raw = int(float(amount_human) * (10 ** decimals))
            ts = _iso_to_unix(block.get("Time", ""))
            out.append(Flow(
                source="bitquery",
                chain="ethereum",
                tx_hash=tx.get("Hash", ""),
                log_index=-1,
                block_number=int(block.get("Number") or 0),
                ts=ts,
                stablecoin=symbol,
                from_addr=(tr.get("Sender") or "").lower(),
                to_addr=(tr.get("Receiver") or "").lower(),
                amount_raw=str(amount_raw),
                amount_usd=float(tr.get("AmountInUSD") or 0.0) or raw_to_usd(amount_raw, decimals),
            ))
        except (KeyError, TypeError, ValueError) as e:
            log.debug("bitquery: skipping bad row: %s", e)
    return out


def _iso_to_unix(iso: str) -> int:
    import datetime
    if not iso:
        return int(time.time())
    try:
        # Bitquery returns "YYYY-MM-DDTHH:MM:SSZ"
        dt = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc
        )
        return int(dt.timestamp())
    except ValueError:
        return int(time.time())
