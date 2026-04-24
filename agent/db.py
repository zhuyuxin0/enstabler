import os
from pathlib import Path
from typing import Iterable

import aiosqlite

from agent.models import Flow

DB_PATH = Path(os.getenv("ENSTABLER_DB_PATH", "data/enstabler.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS flows (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        TEXT NOT NULL,
    chain         TEXT NOT NULL,
    tx_hash       TEXT NOT NULL,
    log_index     INTEGER NOT NULL,
    block_number  INTEGER NOT NULL,
    ts            INTEGER NOT NULL,
    stablecoin    TEXT NOT NULL,
    from_addr     TEXT NOT NULL,
    to_addr       TEXT NOT NULL,
    amount_raw    TEXT NOT NULL,
    amount_usd    REAL,
    UNIQUE(chain, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_flows_ts ON flows(ts DESC);
CREATE INDEX IF NOT EXISTS idx_flows_stablecoin ON flows(stablecoin);
"""


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(SCHEMA)
        await db.commit()


async def insert_flow(flow: Flow) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                """INSERT INTO flows
                   (source, chain, tx_hash, log_index, block_number, ts,
                    stablecoin, from_addr, to_addr, amount_raw, amount_usd)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (flow.source, flow.chain, flow.tx_hash, flow.log_index,
                 flow.block_number, flow.ts, flow.stablecoin,
                 flow.from_addr, flow.to_addr, flow.amount_raw, flow.amount_usd),
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False  # duplicate on (chain, tx_hash, log_index)


async def insert_flows(flows: Iterable[Flow]) -> int:
    inserted = 0
    async with aiosqlite.connect(DB_PATH) as db:
        for f in flows:
            try:
                await db.execute(
                    """INSERT INTO flows
                       (source, chain, tx_hash, log_index, block_number, ts,
                        stablecoin, from_addr, to_addr, amount_raw, amount_usd)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f.source, f.chain, f.tx_hash, f.log_index, f.block_number,
                     f.ts, f.stablecoin, f.from_addr, f.to_addr, f.amount_raw, f.amount_usd),
                )
                inserted += 1
            except aiosqlite.IntegrityError:
                pass
        await db.commit()
    return inserted


async def latest_flows(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM flows ORDER BY ts DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def flow_count() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM flows") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0
