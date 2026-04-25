"""Telegram bot using the Bot API directly (no python-telegram-bot dep).

Commands:
  /status  — agent status, flow count, last classification
  /latest  — last 5 classified flows
  /alerts on | /alerts off — toggle auto-alerts for this chat

Auto-alerts (broadcast to all subscribed chats):
  Any flow classified as `suspicious` with value > $100K.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import httpx

from agent import db

log = logging.getLogger("enstabler.telegram")

API_BASE = "https://api.telegram.org"
SUBS_PATH = Path(os.getenv("ENSTABLER_TELEGRAM_SUBS_PATH", "data/telegram_subs.json"))
ALERT_MIN_USD = 100_000.0
LONG_POLL_TIMEOUT = 25  # seconds


def _token() -> Optional[str]:
    return os.getenv("TELEGRAM_BOT_TOKEN")


def _default_chat_id() -> Optional[str]:
    return os.getenv("TELEGRAM_CHAT_ID")


def _url(method: str) -> str:
    return f"{API_BASE}/bot{_token()}/{method}"


# ---------- subscription persistence ----------

def _load_subs() -> set[str]:
    """Subs = chat IDs that receive auto-alerts. Seeded with TELEGRAM_CHAT_ID."""
    subs: set[str] = set()
    default = _default_chat_id()
    if default:
        subs.add(str(default))
    if SUBS_PATH.exists():
        try:
            data = json.loads(SUBS_PATH.read_text())
            subs.update(str(c) for c in data.get("chats", []))
        except Exception:
            pass
    return subs


def _save_subs(subs: set[str]) -> None:
    SUBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUBS_PATH.write_text(json.dumps({"chats": sorted(subs)}, indent=2))


# ---------- message formatting ----------

def _fmt_flow(row: dict[str, Any]) -> str:
    amount = row.get("amount_usd") or 0.0
    cls = row.get("classification") or "unclassified"
    emoji = {
        "payment": "💚", "cex_flow": "🔵", "arbitrage": "🟡",
        "bot": "⚙️", "mint_burn": "🔥", "suspicious": "🚨",
    }.get(cls, "⚪️")
    pub = "⛓" if row.get("published") else ""
    return (
        f"{emoji} <b>{html.escape(cls)}</b> {pub}\n"
        f"{row.get('stablecoin')} ${amount:,.0f} — "
        f"<code>{html.escape((row.get('from_addr') or '')[:10])}…</code> "
        f"→ <code>{html.escape((row.get('to_addr') or '')[:10])}…</code>\n"
        f"<code>{html.escape((row.get('tx_hash') or '')[:16])}…</code>"
    )


def format_alert(classification: dict[str, Any], flow: dict[str, Any]) -> str:
    amount = flow.get("amount_usd") or 0.0
    cls = classification.get("classification", "?")
    return (
        f"🚨 <b>Suspicious flow</b>\n"
        f"{cls.upper()} — {flow['stablecoin']} <b>${amount:,.0f}</b>\n"
        f"from <code>{html.escape(flow['from_addr'])}</code>\n"
        f"to   <code>{html.escape(flow['to_addr'])}</code>\n"
        f"tx   <code>{html.escape(flow['tx_hash'])}</code>"
    )


# ---------- Bot API calls ----------

async def _send(client: httpx.AsyncClient, chat_id: str, text: str) -> None:
    try:
        await client.post(
            _url("sendMessage"),
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                  "disable_web_page_preview": True},
            timeout=10.0,
        )
    except Exception as e:
        log.debug("telegram: send to %s failed: %s", chat_id, e)


# ---------- broadcasting ----------

_subs: set[str] = set()
_alerts_enabled: set[str] = set()  # subset of _subs who have /alerts on


async def broadcast_alert(classification: dict[str, Any], flow: dict[str, Any]) -> None:
    token = _token()
    if not token or not _alerts_enabled:
        return
    text = format_alert(classification, flow)
    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            *[_send(client, chat, text) for chat in _alerts_enabled],
            return_exceptions=True,
        )


async def broadcast_swap(
    token_in: str, token_out: str, amount_usd: float,
    spread: float, exec_id: str, reason: str,
) -> None:
    token = _token()
    if not token or not _alerts_enabled:
        return
    text = (
        f"🔄 <b>Protective swap fired</b>\n"
        f"Trigger: {html.escape(reason)} (spread {spread*10_000:.1f}bps)\n"
        f"Action: <b>${amount_usd:,.0f}</b> {html.escape(token_in)} → {html.escape(token_out)}\n"
        f"Venue: Uniswap V2 (Ethereum)\n"
        f"Executor: KeeperHub\n"
        f"Exec: <code>{html.escape(exec_id)}</code>"
    )
    async with httpx.AsyncClient() as client:
        await asyncio.gather(
            *[_send(client, chat, text) for chat in _alerts_enabled],
            return_exceptions=True,
        )


# ---------- command handling ----------

async def _handle_command(client: httpx.AsyncClient, chat_id: str, text: str) -> None:
    global _subs, _alerts_enabled
    cmd = text.strip().split()
    if not cmd:
        return
    head = cmd[0].lower().split("@", 1)[0]  # drop bot-name suffix like /status@bot

    if head == "/start":
        _subs.add(chat_id)
        _save_subs(_subs)
        await _send(client, chat_id,
            "Enstabler online.\n"
            "Commands: /status, /latest, /swaps, /alerts on|off")
    elif head == "/status":
        total = await db.flow_count()
        counts = await db.classification_counts()
        recent = await db.latest_classified(1)
        last = _fmt_flow(recent[0]) if recent else "(none yet)"
        parts = "\n".join(f"  {k}: {v}" for k, v in counts.items()) or "  (none)"
        msg = (
            f"<b>Enstabler status</b>\n"
            f"flows ingested: <b>{total}</b>\n"
            f"classifications:\n{parts}\n\n"
            f"latest:\n{last}"
        )
        await _send(client, chat_id, msg)
    elif head == "/latest":
        rows = await db.latest_classified(5)
        if not rows:
            await _send(client, chat_id, "No classified flows yet.")
            return
        body = "\n\n".join(_fmt_flow(r) for r in rows)
        await _send(client, chat_id, f"<b>Last 5 classified</b>\n\n{body}")
    elif head == "/swaps":
        rows = await db.latest_swaps(5)
        if not rows:
            await _send(client, chat_id, "No swaps yet.")
            return
        lines = []
        for r in rows:
            spread = (r.get("spread") or 0) * 10_000
            exec_id = (r.get("keeperhub_execution_id") or "?")[:16]
            err = r.get("error")
            tail = f"❌ {html.escape(err[:80])}" if err else f"exec=<code>{html.escape(exec_id)}</code>"
            lines.append(
                f"<b>{r['token_in_symbol']}→{r['token_out_symbol']}</b> "
                f"${r['amount_in_usd']:,.0f}  spread={spread:.1f}bps\n  {tail}"
            )
        await _send(client, chat_id, "<b>Recent swaps</b>\n\n" + "\n\n".join(lines))
    elif head == "/alerts":
        if len(cmd) < 2 or cmd[1].lower() not in ("on", "off"):
            await _send(client, chat_id, "Usage: /alerts on | /alerts off")
            return
        if cmd[1].lower() == "on":
            _subs.add(chat_id)
            _alerts_enabled.add(chat_id)
            _save_subs(_subs)
            await _send(client, chat_id, "Auto-alerts ON.")
        else:
            _alerts_enabled.discard(chat_id)
            await _send(client, chat_id, "Auto-alerts OFF.")


# ---------- long-poll loop ----------

async def telegram_task() -> None:
    global _subs, _alerts_enabled
    token = _token()
    if not token:
        log.warning("telegram: TELEGRAM_BOT_TOKEN not set, skipping")
        return

    _subs = _load_subs()
    _alerts_enabled = set(_subs)  # default: subscribed chats get alerts
    log.info("telegram: starting with %d subscribed chats", len(_subs))

    # Clear existing webhook so long-polling works
    async with httpx.AsyncClient() as client:
        try:
            await client.get(_url("deleteWebhook"), timeout=10.0)
        except Exception:
            pass

        offset: Optional[int] = None
        while True:
            try:
                params: dict[str, Any] = {"timeout": LONG_POLL_TIMEOUT}
                if offset is not None:
                    params["offset"] = offset
                resp = await client.get(
                    _url("getUpdates"),
                    params=params,
                    timeout=LONG_POLL_TIMEOUT + 5,
                )
                if resp.status_code != 200:
                    log.debug("telegram: getUpdates http %s", resp.status_code)
                    await asyncio.sleep(5)
                    continue
                body = resp.json()
                for update in body.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message") or update.get("channel_post")
                    if not msg:
                        continue
                    chat_id = str(msg.get("chat", {}).get("id", ""))
                    text = msg.get("text") or ""
                    if chat_id and text.startswith("/"):
                        await _handle_command(client, chat_id, text)
            except asyncio.CancelledError:
                log.info("telegram: cancelled")
                raise
            except Exception as e:
                log.debug("telegram: loop error: %s", e)
                await asyncio.sleep(5)
