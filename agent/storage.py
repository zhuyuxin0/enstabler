"""0G Storage uploader: periodic flow snapshots; cached root hash for on-chain refs.

Each snapshot is a JSON file containing the most recent flows. The Merkle root
hash returned by 0G Storage gets passed to FlowRiskOracle.publishScore() so
that every on-chain score can be traced back to the dataset that produced it.

Auth and provider discovery use the same wallet-based pattern as agent/compute.py
(`OG_PRIVATE_KEY` is bridged to `A0G_PRIVATE_KEY`).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("enstabler.storage")

SNAPSHOT_INTERVAL_SECONDS = 1800   # 30 min
# Mainnet ingest runs ~300-1000 flows/min, so 30k flows ≈ 30-100 min of data per
# snapshot. Consecutive snapshots overlap, giving a continuous audit trail rather
# than 1-3 min spotchecks every 30 min.
SNAPSHOT_LIMIT = 30_000

_latest_root_hash: Optional[str] = None
_latest_tx_hash: Optional[str] = None
_latest_uploaded_at: Optional[int] = None
_latest_flow_count: int = 0
_disabled: bool = False
_lock = asyncio.Lock()


def _map_env() -> None:
    """python-0g uses A0G_* env vars; bridge from OG_* names."""
    if not os.getenv("A0G_PRIVATE_KEY"):
        og = os.getenv("OG_PRIVATE_KEY")
        if og:
            os.environ["A0G_PRIVATE_KEY"] = og.removeprefix("0x")
    if not os.getenv("A0G_RPC_URL"):
        rpc = os.getenv("OG_RPC_URL")
        if rpc:
            os.environ["A0G_RPC_URL"] = rpc
    if not os.getenv("A0G_INDEXER_RPC_URL"):
        idx = os.getenv("OG_STORAGE_INDEXER")
        if idx:
            os.environ["A0G_INDEXER_RPC_URL"] = idx


async def _build_snapshot_file() -> tuple[str, int]:
    """Materialise a JSON snapshot of recent flows. Returns (path, flow_count)."""
    from agent import db
    flows = await db.latest_flows(SNAPSHOT_LIMIT)
    payload = {
        "version": 1,
        "agent": "enstabler",
        "snapshot_at": int(time.time()),
        "flow_count": len(flows),
        "flows": flows,
    }
    fd, path = tempfile.mkstemp(prefix="enstabler-snapshot-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(payload, f, default=str)
    return path, len(flows)


async def upload_snapshot() -> Optional[str]:
    """Upload a fresh snapshot to 0G Storage. Returns the root hash hex string,
    or None if disabled / failed."""
    global _latest_root_hash, _latest_tx_hash, _latest_uploaded_at, _latest_flow_count, _disabled
    if _disabled:
        return None
    if not os.getenv("OG_PRIVATE_KEY"):
        log.info("storage: no OG_PRIVATE_KEY, disabled")
        _disabled = True
        return None

    _map_env()
    snapshot_path, count = await _build_snapshot_file()
    try:
        async with _lock:
            from a0g.base import A0G

            def _do_upload():
                a = A0G()
                return a.upload_to_storage(Path(snapshot_path))

            loop = asyncio.get_running_loop()
            obj = await loop.run_in_executor(None, _do_upload)
            _latest_root_hash = obj.root_hash
            _latest_tx_hash = obj.tx_hash
            _latest_uploaded_at = int(time.time())
            _latest_flow_count = count
            log.info(
                "storage: snapshot uploaded (%d flows) rootHash=%s tx=%s",
                count, _latest_root_hash, _latest_tx_hash,
            )
            return _latest_root_hash
    except Exception as e:
        log.warning("storage: upload failed: %s", e)
        return None
    finally:
        try:
            os.unlink(snapshot_path)
        except Exception:
            pass


async def storage_task() -> None:
    """Background task: snapshot once at boot, then every SNAPSHOT_INTERVAL_SECONDS."""
    while True:
        try:
            await upload_snapshot()
        except asyncio.CancelledError:
            log.info("storage: cancelled")
            raise
        except Exception as e:
            log.warning("storage: task error: %s", e)
        await asyncio.sleep(SNAPSHOT_INTERVAL_SECONDS)


def latest_root_hash_bytes() -> bytes:
    """Return the 32-byte root hash of the latest snapshot, or 32 zero bytes if none."""
    if not _latest_root_hash:
        return b"\x00" * 32
    raw = bytes.fromhex(_latest_root_hash.removeprefix("0x"))
    if len(raw) >= 32:
        return raw[:32]
    return raw.ljust(32, b"\x00")


def latest_status() -> dict:
    return {
        "configured": bool(os.getenv("OG_PRIVATE_KEY")),
        "disabled": _disabled,
        "latest_root_hash": _latest_root_hash,
        "latest_tx_hash": _latest_tx_hash,
        "uploaded_at": _latest_uploaded_at,
        "flow_count": _latest_flow_count,
    }
