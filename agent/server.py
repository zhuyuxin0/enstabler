import asyncio
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Query

from agent import watcher
from agent.db import flow_count, init_db, latest_flows

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    _tasks.append(asyncio.create_task(watcher.alchemy_ws_task(), name="alchemy_ws"))
    _tasks.append(asyncio.create_task(watcher.bitquery_task(), name="bitquery"))
    try:
        yield
    finally:
        for t in _tasks:
            t.cancel()
        await asyncio.gather(*_tasks, return_exceptions=True)
        _tasks.clear()


app = FastAPI(title="Enstabler", version="0.2.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
async def status():
    return {
        "agent": "enstabler",
        "milestone": "M2",
        "flows_ingested": await flow_count(),
        "watchers": [t.get_name() for t in _tasks if not t.done()],
    }


@app.get("/flows/latest")
async def flows_latest(limit: int = Query(default=50, ge=1, le=500)):
    return {"flows": await latest_flows(limit)}
