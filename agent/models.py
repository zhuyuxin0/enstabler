from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


@dataclass
class Flow:
    source: str           # "alchemy_ws" | "bitquery"
    chain: str            # "ethereum" | "arbitrum"
    tx_hash: str
    log_index: int        # -1 when unavailable (Bitquery aggregate)
    block_number: int
    ts: int               # unix seconds
    stablecoin: str       # "USDT" | "USDC" | "DAI" | "PYUSD"
    from_addr: str
    to_addr: str
    amount_raw: str       # string to avoid sqlite int overflow on 256-bit values
    amount_usd: Optional[float] = None
