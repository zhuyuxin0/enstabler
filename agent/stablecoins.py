from dataclasses import dataclass


@dataclass(frozen=True)
class Stablecoin:
    symbol: str
    address: str       # lowercased checksum address for cheap comparison
    decimals: int


ETHEREUM: dict[str, Stablecoin] = {
    "USDT":  Stablecoin("USDT",  "0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
    "USDC":  Stablecoin("USDC",  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6),
    "DAI":   Stablecoin("DAI",   "0x6b175474e89094c44da98b954eedeac495271d0f", 18),
    "PYUSD": Stablecoin("PYUSD", "0x6c3ea9036406852006290770bedfcaba0e23a0e8", 6),
}

BY_ADDRESS: dict[str, Stablecoin] = {s.address: s for s in ETHEREUM.values()}

# Transfer(address,address,uint256) topic0
TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def raw_to_usd(amount_raw: int, decimals: int) -> float:
    """Stablecoins are ~$1, so raw/10**decimals is a good USD estimate."""
    return amount_raw / (10 ** decimals)


def topic_to_address(topic: str) -> str:
    """Transfer topic addresses are left-padded to 32 bytes. Take last 20."""
    # topic is 0x + 64 hex chars; address is last 40
    return "0x" + topic[-40:].lower()
