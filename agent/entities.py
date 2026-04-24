"""Entity label lookup backed by data/entity_labels.json."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

LABELS_PATH = Path("data/entity_labels.json")

# Categories the classifier cares about
CEX = "cex"
DEX = "dex"
BRIDGE = "bridge"
LENDING = "lending"
STABLECOIN_ISSUER = "stablecoin_issuer"
TREASURY = "treasury"
MEV = "mev"

ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


@lru_cache(maxsize=1)
def _labels() -> dict[str, dict]:
    if not LABELS_PATH.exists():
        return {}
    with LABELS_PATH.open() as f:
        data = json.load(f)
    raw = data.get("labels", {})
    # Lowercase keys for case-insensitive lookup
    return {k.lower(): v for k, v in raw.items()}


def classify_entity(addr: str) -> str:
    """Return category like 'cex', 'dex', 'bridge', 'lending', 'stablecoin_issuer',
    'zero', or 'unknown'."""
    if not addr:
        return "unknown"
    addr_l = addr.lower()
    if addr_l == ZERO_ADDRESS:
        return "zero"
    entry = _labels().get(addr_l)
    if entry:
        return entry.get("category", "unknown")
    return "unknown"


def entity_name(addr: str) -> str:
    entry = _labels().get((addr or "").lower())
    return entry["name"] if entry else addr


def known_cex_wallets() -> set[str]:
    return {a for a, e in _labels().items() if e.get("category") == CEX}
