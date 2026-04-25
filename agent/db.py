import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Iterable, Optional

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
CREATE INDEX IF NOT EXISTS idx_flows_from ON flows(from_addr, ts);
CREATE INDEX IF NOT EXISTS idx_flows_to ON flows(to_addr, ts);

CREATE TABLE IF NOT EXISTS classifications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id           INTEGER NOT NULL UNIQUE REFERENCES flows(id),
    classification    TEXT NOT NULL,
    risk_level        INTEGER NOT NULL,
    features_json     TEXT,
    published         INTEGER NOT NULL DEFAULT 0,
    onchain_score_id  INTEGER,
    onchain_tx_hash   TEXT,
    ts                INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cls_ts ON classifications(ts DESC);
CREATE INDEX IF NOT EXISTS idx_cls_classification ON classifications(classification);
CREATE INDEX IF NOT EXISTS idx_cls_published ON classifications(published);

CREATE TABLE IF NOT EXISTS swaps (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                       INTEGER NOT NULL,
    trigger_reason           TEXT,
    spread                   REAL,
    token_in_symbol          TEXT NOT NULL,
    token_out_symbol         TEXT NOT NULL,
    amount_in_usd            REAL NOT NULL,
    network                  TEXT NOT NULL,
    keeperhub_execution_id   TEXT,
    keeperhub_status         TEXT,
    tx_hash                  TEXT,
    error                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_swaps_ts ON swaps(ts DESC);

CREATE TABLE IF NOT EXISTS cctp_messages (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                          INTEGER NOT NULL,
    source_chain                TEXT NOT NULL,
    source_domain               INTEGER NOT NULL,
    destination_chain           TEXT NOT NULL,
    destination_domain          INTEGER NOT NULL,
    nonce                       INTEGER NOT NULL,
    burn_token                  TEXT NOT NULL,
    amount_raw                  TEXT NOT NULL,
    amount_usd                  REAL,
    depositor                   TEXT NOT NULL,
    mint_recipient              TEXT NOT NULL,
    tx_hash                     TEXT NOT NULL,
    block_number                INTEGER NOT NULL,
    log_index                   INTEGER NOT NULL,
    UNIQUE(source_domain, nonce)
);
CREATE INDEX IF NOT EXISTS idx_cctp_ts ON cctp_messages(ts DESC);
CREATE INDEX IF NOT EXISTS idx_cctp_dst ON cctp_messages(destination_domain);

CREATE TABLE IF NOT EXISTS kh_executions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                  INTEGER NOT NULL,
    classification_id   INTEGER,
    workflow_id         TEXT NOT NULL,
    execution_id        TEXT,
    status              TEXT,
    error               TEXT,
    inputs_json         TEXT
);
CREATE INDEX IF NOT EXISTS idx_kh_exec_ts ON kh_executions(ts DESC);
"""


@asynccontextmanager
async def _conn() -> AsyncIterator[aiosqlite.Connection]:
    """Single source of truth for DB connections. Applies the per-connection
    busy_timeout so concurrent writers wait briefly instead of erroring with
    'database is locked'. WAL mode is set once globally in init_db()."""
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute("PRAGMA busy_timeout=5000")
        yield db
    finally:
        await db.close()


async def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        # WAL mode: readers + 1 writer concurrently, instead of full-file lock.
        # Eliminates most "database is locked" bursts when many pipeline tasks
        # write at once. Persistent: set once, sticks for the lifetime of the DB.
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=5000")
        await db.execute("PRAGMA synchronous=NORMAL")  # safe with WAL, faster
        await db.executescript(SCHEMA)
        # Idempotent migration: add explanation column if missing
        async with db.execute("PRAGMA table_info(classifications)") as cur:
            cols = {row[1] for row in await cur.fetchall()}
        if "explanation" not in cols:
            await db.execute("ALTER TABLE classifications ADD COLUMN explanation TEXT")
        await db.commit()


async def insert_flow(flow: Flow) -> Optional[int]:
    """Insert a flow. Returns the new row id, or None if duplicate."""
    async with _conn() as db:
        try:
            cur = await db.execute(
                """INSERT INTO flows
                   (source, chain, tx_hash, log_index, block_number, ts,
                    stablecoin, from_addr, to_addr, amount_raw, amount_usd)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (flow.source, flow.chain, flow.tx_hash, flow.log_index,
                 flow.block_number, flow.ts, flow.stablecoin,
                 flow.from_addr, flow.to_addr, flow.amount_raw, flow.amount_usd),
            )
            await db.commit()
            return cur.lastrowid
        except aiosqlite.IntegrityError:
            return None


async def insert_flows(flows: Iterable[Flow]) -> list[int]:
    """Insert many flows. Returns the list of new row ids (skipping duplicates)."""
    ids: list[int] = []
    async with _conn() as db:
        for f in flows:
            try:
                cur = await db.execute(
                    """INSERT INTO flows
                       (source, chain, tx_hash, log_index, block_number, ts,
                        stablecoin, from_addr, to_addr, amount_raw, amount_usd)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f.source, f.chain, f.tx_hash, f.log_index, f.block_number,
                     f.ts, f.stablecoin, f.from_addr, f.to_addr, f.amount_raw, f.amount_usd),
                )
                if cur.lastrowid:
                    ids.append(cur.lastrowid)
            except aiosqlite.IntegrityError:
                pass
        await db.commit()
    return ids


async def get_flow(flow_id: int) -> Optional[dict]:
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM flows WHERE id = ?", (flow_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def latest_flows(limit: int = 50) -> list[dict]:
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT f.*, c.classification, c.risk_level, c.published,
                      c.onchain_tx_hash, c.explanation
               FROM flows f
               LEFT JOIN classifications c ON c.flow_id = f.id
               ORDER BY f.ts DESC LIMIT ?""",
            (limit,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def latest_classified(limit: int = 5) -> list[dict]:
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT f.*, c.classification, c.risk_level, c.published,
                      c.onchain_tx_hash, c.explanation
               FROM classifications c JOIN flows f ON f.id = c.flow_id
               ORDER BY c.ts DESC LIMIT ?""",
            (limit,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def flow_count() -> int:
    async with _conn() as db:
        async with db.execute("SELECT COUNT(*) FROM flows") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def classification_counts() -> dict[str, int]:
    async with _conn() as db:
        async with db.execute(
            "SELECT classification, COUNT(*) FROM classifications GROUP BY classification"
        ) as cur:
            return {row[0]: row[1] for row in await cur.fetchall()}


# ---------- queries used for feature extraction ----------

async def sender_tx_count_since(sender: str, since_ts: int) -> int:
    async with _conn() as db:
        async with db.execute(
            "SELECT COUNT(*) FROM flows WHERE from_addr = ? AND ts >= ?",
            (sender, since_ts),
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def fan_counts(addr: str, since_ts: int) -> tuple[int, int]:
    """Return (distinct senders INTO addr, distinct receivers OUT OF addr) since since_ts."""
    async with _conn() as db:
        async with db.execute(
            "SELECT COUNT(DISTINCT from_addr) FROM flows WHERE to_addr = ? AND ts >= ?",
            (addr, since_ts),
        ) as cur:
            row = await cur.fetchone()
            fan_in = row[0] if row else 0
        async with db.execute(
            "SELECT COUNT(DISTINCT to_addr) FROM flows WHERE from_addr = ? AND ts >= ?",
            (addr, since_ts),
        ) as cur:
            row = await cur.fetchone()
            fan_out = row[0] if row else 0
    return fan_in, fan_out


async def avg_flow_usd_since(stablecoin: str, since_ts: int) -> float:
    async with _conn() as db:
        async with db.execute(
            "SELECT AVG(amount_usd) FROM flows WHERE stablecoin = ? AND ts >= ? AND amount_usd IS NOT NULL",
            (stablecoin, since_ts),
        ) as cur:
            row = await cur.fetchone()
            return float(row[0]) if row and row[0] is not None else 0.0


async def first_seen_ts(addr: str) -> Optional[int]:
    async with _conn() as db:
        async with db.execute(
            "SELECT MIN(ts) FROM flows WHERE from_addr = ? OR to_addr = ?",
            (addr, addr),
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row and row[0] is not None else None


# ---------- classifications ----------

async def insert_classification(
    flow_id: int,
    classification: str,
    risk_level: int,
    features_json: str,
    ts: int,
) -> Optional[int]:
    async with _conn() as db:
        try:
            cur = await db.execute(
                """INSERT INTO classifications
                   (flow_id, classification, risk_level, features_json, ts)
                   VALUES (?, ?, ?, ?, ?)""",
                (flow_id, classification, risk_level, features_json, ts),
            )
            await db.commit()
            return cur.lastrowid
        except aiosqlite.IntegrityError:
            return None


async def mark_published(
    classification_id: int, onchain_score_id: int, onchain_tx_hash: str
) -> None:
    async with _conn() as db:
        await db.execute(
            """UPDATE classifications
               SET published = 1, onchain_score_id = ?, onchain_tx_hash = ?
               WHERE id = ?""",
            (onchain_score_id, onchain_tx_hash, classification_id),
        )
        await db.commit()


async def set_explanation(classification_id: int, explanation: str) -> None:
    async with _conn() as db:
        await db.execute(
            "UPDATE classifications SET explanation = ? WHERE id = ?",
            (explanation, classification_id),
        )
        await db.commit()


# ---------- swaps ----------

async def insert_swap(
    *,
    ts: int,
    trigger_reason: str,
    spread: float,
    token_in_symbol: str,
    token_out_symbol: str,
    amount_in_usd: float,
    network: str,
    keeperhub_execution_id: Optional[str],
    keeperhub_status: Optional[str],
    error: Optional[str] = None,
) -> int:
    async with _conn() as db:
        cur = await db.execute(
            """INSERT INTO swaps
               (ts, trigger_reason, spread, token_in_symbol, token_out_symbol,
                amount_in_usd, network, keeperhub_execution_id, keeperhub_status, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ts, trigger_reason, spread, token_in_symbol, token_out_symbol,
             amount_in_usd, network, keeperhub_execution_id, keeperhub_status, error),
        )
        await db.commit()
        return cur.lastrowid or 0


async def update_swap_status(
    swap_id: int, keeperhub_status: str, tx_hash: Optional[str] = None, error: Optional[str] = None
) -> None:
    async with _conn() as db:
        await db.execute(
            "UPDATE swaps SET keeperhub_status = ?, tx_hash = COALESCE(?, tx_hash), error = COALESCE(?, error) WHERE id = ?",
            (keeperhub_status, tx_hash, error, swap_id),
        )
        await db.commit()


async def latest_swaps(limit: int = 20) -> list[dict]:
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM swaps ORDER BY ts DESC LIMIT ?", (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def swap_count() -> int:
    async with _conn() as db:
        async with db.execute("SELECT COUNT(*) FROM swaps") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


# ---------- cctp messages ----------

async def insert_cctp_message(
    *,
    ts: int,
    source_chain: str,
    source_domain: int,
    destination_chain: str,
    destination_domain: int,
    nonce: int,
    burn_token: str,
    amount_raw: str,
    amount_usd: Optional[float],
    depositor: str,
    mint_recipient: str,
    tx_hash: str,
    block_number: int,
    log_index: int,
) -> bool:
    async with _conn() as db:
        try:
            await db.execute(
                """INSERT INTO cctp_messages
                   (ts, source_chain, source_domain, destination_chain, destination_domain,
                    nonce, burn_token, amount_raw, amount_usd, depositor, mint_recipient,
                    tx_hash, block_number, log_index)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (ts, source_chain, source_domain, destination_chain, destination_domain,
                 nonce, burn_token, amount_raw, amount_usd, depositor, mint_recipient,
                 tx_hash, block_number, log_index),
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False  # duplicate (source_domain, nonce)


async def latest_cctp_messages(limit: int = 50) -> list[dict]:
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM cctp_messages ORDER BY ts DESC LIMIT ?", (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def cctp_count() -> int:
    async with _conn() as db:
        async with db.execute("SELECT COUNT(*) FROM cctp_messages") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def insert_kh_execution(
    *,
    ts: int,
    classification_id: Optional[int],
    workflow_id: str,
    execution_id: Optional[str],
    status: Optional[str],
    error: Optional[str],
    inputs_json: Optional[str],
) -> int:
    async with _conn() as db:
        cur = await db.execute(
            """INSERT INTO kh_executions
               (ts, classification_id, workflow_id, execution_id, status, error, inputs_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (ts, classification_id, workflow_id, execution_id, status, error, inputs_json),
        )
        await db.commit()
        return cur.lastrowid or 0


async def latest_kh_executions(limit: int = 20) -> list[dict]:
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM kh_executions ORDER BY ts DESC LIMIT ?", (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def kh_execution_count() -> int:
    async with _conn() as db:
        async with db.execute("SELECT COUNT(*) FROM kh_executions") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def cctp_volume_by_destination() -> list[dict]:
    """Return sum of amount_usd per destination chain, descending by volume."""
    async with _conn() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT destination_chain, COUNT(*) as count, SUM(amount_usd) as volume_usd
               FROM cctp_messages GROUP BY destination_chain ORDER BY volume_usd DESC"""
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]
