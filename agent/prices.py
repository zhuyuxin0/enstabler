"""Lightweight Coingecko poller for USDT/USDC/DAI/PYUSD prices.

Stablecoin spread = the most mispriced pair at any given moment. A spread
above ~10bps is an arbitrage signal per the spec.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx

log = logging.getLogger("enstabler.prices")

_COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
_COIN_IDS = {"tether": "USDT", "usd-coin": "USDC", "dai": "DAI", "paypal-usd": "PYUSD"}
_POLL_SECONDS = 60

_prices: dict[str, float] = {}
_last_updated: Optional[int] = None


def get_price(symbol: str) -> Optional[float]:
    return _prices.get(symbol)


def current_spread() -> float:
    """Max pairwise absolute deviation from $1 across the four stables."""
    if not _prices:
        return 0.0
    deviations = [abs(p - 1.0) for p in _prices.values()]
    return max(deviations) if deviations else 0.0


def last_updated_ts() -> Optional[int]:
    return _last_updated


async def prices_task() -> None:
    global _last_updated
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            try:
                resp = await client.get(
                    _COINGECKO_URL,
                    params={"ids": ",".join(_COIN_IDS.keys()), "vs_currencies": "usd"},
                )
                if resp.status_code == 200:
                    body = resp.json()
                    for coin_id, symbol in _COIN_IDS.items():
                        usd = body.get(coin_id, {}).get("usd")
                        if usd is not None:
                            _prices[symbol] = float(usd)
                    _last_updated = int(time.time())
                else:
                    log.debug("coingecko: http %s", resp.status_code)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.debug("coingecko: %s", e)
            await asyncio.sleep(_POLL_SECONDS)
