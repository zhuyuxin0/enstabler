"""Extract the 10 classifier features from a Flow row.

The 10 features per the spec:
  1. tx_value_usd
  2. entity_class_sender
  3. entity_class_receiver
  4. tx_frequency_sender     — count of same-sender txs in last 24h
  5. fan_ratio               — fan_in / fan_out of the receiver over 24h
  6. is_cross_chain          — placeholder; False until Arbitrum/CCTP is live
  7. stablecoin_spread       — |max price - 1.0| across USDT/USDC/DAI/PYUSD
  8. is_mint_burn            — from or to is zero address or issuer treasury
  9. value_vs_24h_avg        — amount_usd / avg amount_usd for this stablecoin over 24h
 10. receiver_age_days       — days since receiver was first seen in our DB
"""
from __future__ import annotations

import time
from typing import Any

from agent import db, entities, prices

DAY = 86_400
_MINT_BURN_CATEGORIES = {"zero", "stablecoin_issuer", "treasury"}


async def extract(flow: dict[str, Any]) -> dict[str, Any]:
    now = int(time.time())
    day_ago = now - DAY

    sender = flow["from_addr"]
    receiver = flow["to_addr"]
    tx_value_usd = float(flow.get("amount_usd") or 0.0)
    stablecoin = flow["stablecoin"]

    sender_cat = entities.classify_entity(sender)
    receiver_cat = entities.classify_entity(receiver)

    tx_frequency_sender = await db.sender_tx_count_since(sender, day_ago)
    fan_in, fan_out = await db.fan_counts(receiver, day_ago)
    fan_ratio = fan_in / fan_out if fan_out > 0 else float(fan_in)

    avg_24h = await db.avg_flow_usd_since(stablecoin, day_ago)
    value_vs_24h_avg = tx_value_usd / avg_24h if avg_24h > 0 else 0.0

    first_seen = await db.first_seen_ts(receiver)
    receiver_age_days = ((now - first_seen) / DAY) if first_seen is not None else 0.0

    is_mint_burn = (
        sender_cat in _MINT_BURN_CATEGORIES or receiver_cat in _MINT_BURN_CATEGORIES
    )

    is_cross_chain = (flow.get("source") or "").startswith("cctp_")

    return {
        "tx_value_usd": tx_value_usd,
        "entity_class_sender": sender_cat,
        "entity_class_receiver": receiver_cat,
        "tx_frequency_sender": tx_frequency_sender,
        "fan_ratio": fan_ratio,
        "is_cross_chain": is_cross_chain,
        "stablecoin_spread": prices.current_spread(),
        "is_mint_burn": is_mint_burn,
        "value_vs_24h_avg": value_vs_24h_avg,
        "receiver_age_days": receiver_age_days,
    }
