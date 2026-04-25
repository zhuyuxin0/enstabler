"""Pipeline: feature extraction → classification → persistence → publish + alert.

Called from the watcher after a Flow row lands in SQLite.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from agent import classifier, compute, db, features, storage, telegram_bot
from agent.publisher import PublishArgs, Publisher
from agent.stablecoins import ETHEREUM

log = logging.getLogger("enstabler.pipeline")

SUSPICIOUS_ALERT_USD = 100_000.0

_publisher: Publisher | None = None


def set_publisher(p: Publisher | None) -> None:
    global _publisher
    _publisher = p


def _flow_hash(flow: dict[str, Any]) -> int:
    """Deterministic uint256 hash-ish id — good enough for the oracle field."""
    tx = flow.get("tx_hash") or ""
    try:
        n = int(tx, 16) if tx.startswith("0x") else int(tx or "0", 16)
    except ValueError:
        n = 0
    # Mix in log_index so different logs in the same tx get different hashes.
    return (n ^ (int(flow.get("log_index") or 0) & 0xFFFF)) & ((1 << 256) - 1)


def _stablecoin_address(symbol: str) -> str:
    entry = ETHEREUM.get(symbol)
    return entry.address if entry else "0x0000000000000000000000000000000000000000"


async def process_flow(flow_id: int) -> None:
    flow = await db.get_flow(flow_id)
    if flow is None:
        return

    feats = await features.extract(flow)
    cls = classifier.classify_flow(feats)
    risk = classifier.risk_level(cls, feats)
    ts = int(time.time())

    cls_id = await db.insert_classification(
        flow_id=flow_id,
        classification=cls,
        risk_level=risk,
        features_json=json.dumps(feats, default=str),
        ts=ts,
    )
    if cls_id is None:
        return  # already classified

    amount_usd = float(flow.get("amount_usd") or 0.0)
    log.info(
        "classified flow=%s stable=%s usd=%.2f → %s (risk=%d)",
        flow_id, flow["stablecoin"], amount_usd, cls, risk,
    )

    # Fire-and-forget side effects — don't block ingestion.
    asyncio.create_task(_maybe_publish(cls_id, flow, cls, risk))
    if risk >= 2:
        asyncio.create_task(_maybe_explain(cls_id, flow, feats, cls, risk))
    if cls == "suspicious" and amount_usd > SUSPICIOUS_ALERT_USD:
        asyncio.create_task(
            telegram_bot.broadcast_alert(
                {"classification": cls, "risk_level": risk}, flow
            )
        )


async def _maybe_explain(
    classification_id: int,
    flow: dict[str, Any],
    feats: dict[str, Any],
    cls: str,
    risk: int,
) -> None:
    text = await compute.explain(flow, feats, cls, risk)
    if text:
        await db.set_explanation(classification_id, text)
        log.info("compute: explained cls_id=%s (%d chars)", classification_id, len(text))


async def _maybe_publish(
    classification_id: int, flow: dict[str, Any], cls: str, risk: int
) -> None:
    if _publisher is None:
        return
    args = PublishArgs(
        classification_id=classification_id,
        stablecoin_address=_stablecoin_address(flow["stablecoin"]),
        flow_hash=_flow_hash(flow),
        risk_level=risk,
        classification=cls,
        storage_root_hash=storage.latest_root_hash_bytes(),
    )
    try:
        await _publisher.maybe_publish(args)
    except Exception as e:
        log.warning("pipeline: publish error: %s", e)
