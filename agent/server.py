import asyncio
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Query

from agent import pipeline, prices, telegram_bot, watcher
from agent.db import classification_counts, flow_count, init_db, latest_classified, latest_flows
from agent.publisher import Publisher

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    publisher = Publisher()
    if await publisher.setup():
        pipeline.set_publisher(publisher)

    _tasks.append(asyncio.create_task(prices.prices_task(), name="prices"))
    _tasks.append(asyncio.create_task(watcher.alchemy_ws_task(), name="alchemy_ws"))
    _tasks.append(asyncio.create_task(watcher.bitquery_task(), name="bitquery"))
    _tasks.append(asyncio.create_task(telegram_bot.telegram_task(), name="telegram"))
    try:
        yield
    finally:
        for t in _tasks:
            t.cancel()
        await asyncio.gather(*_tasks, return_exceptions=True)
        _tasks.clear()


app = FastAPI(title="Enstabler", version="0.3.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
async def status():
    return {
        "agent": "enstabler",
        "milestone": "M3",
        "flows_ingested": await flow_count(),
        "classifications": await classification_counts(),
        "watchers": [t.get_name() for t in _tasks if not t.done()],
    }


@app.get("/flows/latest")
async def flows_latest(limit: int = Query(default=50, ge=1, le=500)):
    return {"flows": await latest_flows(limit)}


@app.get("/classifications/latest")
async def classifications_latest(limit: int = Query(default=50, ge=1, le=500)):
    return {"classifications": await latest_classified(limit)}
