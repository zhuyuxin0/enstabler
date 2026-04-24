"""0G Compute integration: verified LLM explanations via Sealed Inference (TEE).

Heuristic classifier runs locally; this module sends the classified flow to a
0G Compute provider to get a natural-language explanation. The explanation is
verifiable because 0G providers run inside TEEs and sign their outputs.

Funding prerequisite (one-time, done via `0g-compute-cli` outside this module):
  0g-compute-cli deposit --amount 10
  0g-compute-cli transfer-fund --provider <addr> --amount 1

The python-0g SDK handles provider discovery and per-session auth using the
same EVM wallet we already deploy with (`OG_PRIVATE_KEY`).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

log = logging.getLogger("enstabler.compute")

_async_client = None
_service = None
_lock = asyncio.Lock()
_disabled = False  # latches on first init failure — don't retry per-flow


def _map_env() -> None:
    """python-0g reads A0G_* env vars. Bridge from our OG_* names."""
    if not os.getenv("A0G_PRIVATE_KEY"):
        og_key = os.getenv("OG_PRIVATE_KEY")
        if og_key:
            os.environ["A0G_PRIVATE_KEY"] = og_key.removeprefix("0x")
    if not os.getenv("A0G_RPC_URL"):
        rpc = os.getenv("OG_RPC_URL")
        if rpc:
            os.environ["A0G_RPC_URL"] = rpc
    if not os.getenv("A0G_INDEXER_RPC_URL"):
        idx = os.getenv("OG_STORAGE_INDEXER")
        if idx:
            os.environ["A0G_INDEXER_RPC_URL"] = idx


def _pick_chat_service(services: list) -> Any:
    """Prefer a chat-style LLM over image models."""
    for s in services:
        model = str(getattr(s, "model", "")).lower()
        if any(k in model for k in ("qwen", "llama", "chat", "instruct")):
            return s
    return services[0]


async def _ensure_client():
    global _async_client, _service, _disabled
    if _disabled:
        return None
    if _async_client and _service:
        return _async_client, _service

    async with _lock:
        if _async_client and _service:
            return _async_client, _service
        _map_env()
        if not os.getenv("A0G_PRIVATE_KEY"):
            log.warning("compute: no A0G_PRIVATE_KEY / OG_PRIVATE_KEY, disabled")
            _disabled = True
            return None
        try:
            from a0g.base import A0G

            loop = asyncio.get_running_loop()

            def _init():
                a = A0G()
                services = a.get_all_services()
                if not services:
                    raise RuntimeError("no 0G Compute services available")
                svc = _pick_chat_service(services)
                client = a.get_openai_async_client(svc.provider)
                return client, svc

            client, svc = await loop.run_in_executor(None, _init)
            _async_client = client
            _service = svc
            log.info(
                "compute: ready (provider=%s model=%s)",
                getattr(svc, "provider", "?"),
                getattr(svc, "model", "?"),
            )
            return _async_client, _service
        except Exception as e:
            # Most common causes: provider not funded, network, no service
            log.warning("compute: init failed (%s); disabling for this process", e)
            _disabled = True
            return None


def _build_messages(
    flow: dict[str, Any],
    features: dict[str, Any],
    classification: str,
    risk: int,
) -> list[dict]:
    from_addr = (flow.get("from_addr") or "")[:10]
    to_addr = (flow.get("to_addr") or "")[:10]
    amount = float(flow.get("amount_usd") or 0.0)
    stable = flow.get("stablecoin", "?")
    sender_cat = features.get("entity_class_sender", "unknown")
    receiver_cat = features.get("entity_class_receiver", "unknown")
    freq = features.get("tx_frequency_sender", 0)
    age = features.get("receiver_age_days", 0.0)
    spread = features.get("stablecoin_spread", 0.0)
    val24 = features.get("value_vs_24h_avg", 0.0)

    system = (
        "You are a stablecoin flow analyst. Given one classified flow, explain in "
        "one sentence why it was classified the way it was. Cite the specific features "
        "that drove the rule. No hedging, no filler, no preamble."
    )
    user = (
        f"Flow: ${amount:,.0f} {stable} — {from_addr}… → {to_addr}…\n"
        f"Classification: {classification} (risk level {risk}/3)\n"
        f"Features:\n"
        f"  sender_class = {sender_cat}\n"
        f"  receiver_class = {receiver_cat}\n"
        f"  sender_24h_tx_count = {freq}\n"
        f"  receiver_age_days = {age:.1f}\n"
        f"  stablecoin_spread = {spread:.5f}\n"
        f"  value_vs_24h_avg = {val24:.2f}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def explain(
    flow: dict[str, Any],
    features: dict[str, Any],
    classification: str,
    risk: int,
) -> Optional[str]:
    """Generate a verified natural-language explanation via 0G Compute.

    Returns None if the service is disabled, unfunded, or errors out.
    """
    got = await _ensure_client()
    if got is None:
        return None
    client, svc = got
    try:
        resp = await client.chat.completions.create(
            model=getattr(svc, "model", None),
            messages=_build_messages(flow, features, classification, risk),
            max_tokens=180,
            temperature=0.2,
        )
        text = resp.choices[0].message.content
        return text.strip() if text else None
    except Exception as e:
        log.warning("compute: explain failed: %s", e)
        return None


def is_available() -> bool:
    return _async_client is not None and not _disabled
