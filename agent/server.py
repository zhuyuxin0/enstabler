import asyncio
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from agent import cctp, inft, pipeline, prices, storage, swap, telegram_bot, watcher
from agent.db import (
    cctp_count,
    cctp_volume_by_destination,
    classification_counts,
    flow_count,
    init_db,
    latest_cctp_messages,
    latest_classified,
    latest_flows,
    latest_swaps,
    swap_count,
)
from agent.publisher import Publisher

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
# httpx logs full URLs at INFO, which leaks the Telegram bot token via getUpdates URLs
logging.getLogger("httpx").setLevel(logging.WARNING)

_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    publisher = Publisher()
    if await publisher.setup():
        pipeline.set_publisher(publisher)

    # iNFT bootstrap runs in background — mints once if our wallet has no token yet
    asyncio.create_task(inft.init(), name="inft_init")

    # KeeperHub setup runs in background — sets max approvals if needed
    if swap.is_configured():
        asyncio.create_task(swap.setup(), name="swap_setup")

    _tasks.append(asyncio.create_task(prices.prices_task(), name="prices"))
    _tasks.append(asyncio.create_task(watcher.alchemy_ws_task(), name="alchemy_ws"))
    _tasks.append(asyncio.create_task(watcher.bitquery_task(), name="bitquery"))
    _tasks.append(asyncio.create_task(cctp.cctp_task(), name="cctp"))
    _tasks.append(asyncio.create_task(telegram_bot.telegram_task(), name="telegram"))
    _tasks.append(asyncio.create_task(storage.storage_task(), name="storage"))
    try:
        yield
    finally:
        for t in _tasks:
            t.cancel()
        await asyncio.gather(*_tasks, return_exceptions=True)
        _tasks.clear()


app = FastAPI(title="Enstabler", version="0.5.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://enstabler.xyz",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
async def status():
    return {
        "agent": "enstabler",
        "milestone": "M3+",
        "flows_ingested": await flow_count(),
        "classifications": await classification_counts(),
        "swaps": await swap_count(),
        "cctp_messages": await cctp_count(),
        "watchers": [t.get_name() for t in _tasks if not t.done()],
        "swap": {
            "configured": swap.is_configured(),
            "ready": swap.is_ready(),
            "network": swap.KEEPERHUB_NETWORK,
            "threshold_bps": int(swap.SPREAD_THRESHOLD * 10_000),
            "amount_usd": swap.SWAP_AMOUNT_USD,
        },
        "storage": storage.latest_status(),
        "inft": inft.get_state(),
    }


@app.get("/agent")
async def agent_identity():
    return inft.get_state()


@app.get("/flows/latest")
async def flows_latest(limit: int = Query(default=50, ge=1, le=500)):
    return {"flows": await latest_flows(limit)}


@app.get("/classifications/latest")
async def classifications_latest(limit: int = Query(default=50, ge=1, le=500)):
    return {"classifications": await latest_classified(limit)}


@app.get("/swaps/latest")
async def swaps_latest(limit: int = Query(default=20, ge=1, le=200)):
    return {"swaps": await latest_swaps(limit)}


@app.get("/cctp/latest")
async def cctp_latest(limit: int = Query(default=50, ge=1, le=500)):
    return {"messages": await latest_cctp_messages(limit)}


@app.get("/cctp/by-destination")
async def cctp_by_destination():
    return {"by_destination": await cctp_volume_by_destination()}


@app.post("/admin/trigger-swap")
async def admin_trigger_swap():
    """Manual swap trigger for demo recording. Local-use only — do not expose."""
    if not swap.is_configured():
        raise HTTPException(503, "swap not configured (KEEPERHUB_API_KEY / KEEPERHUB_WALLET_ADDRESS)")
    if not swap.is_ready():
        ok = await swap.setup()
        if not ok:
            raise HTTPException(503, "swap setup failed (check approvals path)")
    # Use the actual current pairwise spread, even if below threshold
    usdc = prices.get_price("USDC") or 1.0
    usdt = prices.get_price("USDT") or 1.0
    spread = abs(usdc - usdt)
    exec_id = await swap.trigger_swap(spread=spread, reason="manual demo")
    if not exec_id:
        raise HTTPException(502, "keeperhub did not return an executionId")
    return {"executionId": exec_id, "spread": spread}
