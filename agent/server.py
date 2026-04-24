from fastapi import FastAPI

app = FastAPI(title="Enstabler", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def status():
    return {
        "agent": "enstabler",
        "milestone": "M1",
        "flows_classified": 0,
        "last_flow_at": None,
    }
