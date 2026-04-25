# KeeperHub Integration Feedback

Running log of KeeperHub integration friction, feature requests, and UX notes
from building Enstabler (ETHGlobal Open Agents, Apr 2026).

Format: each entry is dated, categorised (setup / api / docs / ux / feature),
and includes concrete context.

---

## 2026-04-25 — Publisher design choice (setup)

**Context**: Built `agent/publisher.py` with direct `web3.py` calls to
`FlowRiskOracle.publishScore()` on 0G Galileo. The class is structured with a
single `_send_tx(args)` method so the KeeperHub swap is a one-file change.
Policy already in place: only risk_level ≥ 2 goes on-chain, with a 15-second
cooldown between txs.

**What would have unblocked earlier integration**:
- A one-line `curl` example for submitting a txn via KeeperHub's HTTP API —
  before diving into MCP or SDK setup. First 10 minutes of any integration is
  "prove the happy path."
- A clear statement in the landing doc whether KeeperHub is primarily an MCP
  tool (for Claude Code agentic sessions) vs. a production runtime API for
  Python/Node agents — ideally both paths with examples.

## 2026-04-25 — Doc inconsistencies discovered while probing the API

Three concrete issues encountered while integrating KeeperHub against the
docs at `docs.keeperhub.com`:

**1. Direct Execution auth header is documented wrong.**
The Direct Execution API page states:
```
All direct execution endpoints require an API key passed in the `X-API-Key` header:
X-API-Key: keeper_...
```
This is incorrect on two counts:
  - The actual working header is `Authorization: Bearer kh_<key>` (same as the
    Workflows API). `X-API-Key` always returned `401 Unauthorized` in my tests.
  - The example shows a `keeper_` prefix, but Organization keys minted in the
    dashboard begin with `kh_`. The example should match the real prefix.

I burned ~10 minutes adding both headers and toggling between them before
realising the Workflows-page Bearer auth applies to Direct Execution too.

**2. The set of supported chain identifiers is not documented anywhere visible.**
When I called `/api/execute/contract-call` with `network: "0g-galileo"`, the
error response listed valid networks inline: `mainnet, eth-mainnet, ethereum,
sepolia, base, base-mainnet, …`. That list belongs in the docs (e.g. on the
Direct Execution page or a dedicated "Supported Networks" page) — not as an
error response. As an integrator, I want to know up front whether my chain is
supported.

**3. Numeric chain IDs are accepted, but undocumented.**
By accident, I tried `network: "16602"` (the chain ID for 0G Galileo). The
error switched to `"No explorer API configured for chain 16602"` — meaning
the chain *is* recognized at the routing layer; only the auto-ABI explorer
lookup isn't configured. Passing the ABI explicitly bypasses this entirely.
This is a great escape hatch for any EVM chain not on the named list, and
it should be called out in the docs ("To use a chain not in the named list,
pass its chain ID as a numeric string and supply the `abi` field explicitly").

## 2026-04-25 — Architectural collision: Turnkey wallets vs `onlyAgent` modifier

KeeperHub broadcasts from a Turnkey-managed wallet, not from a wallet I
control. Our `FlowRiskOracle.sol` was deployed with `agent = msg.sender` in
the constructor (locked at deploy time), so any `publishScore()` call from
KeeperHub's Turnkey wallet reverts on `require(msg.sender == agent)`.

**Feature request**: a way for an integrator's API key to surface the
underlying Turnkey wallet's address — ideally a `GET /api/wallet/me` or
similar — so I can either (a) deploy with that address as the privileged
caller from the start, or (b) call a setter to grant it permission post-deploy.
Right now I'm guessing the dashboard exposes this, but the docs API section
doesn't reference a wallet-info endpoint.

**Decision**: switching to a **hybrid model** — direct web3 keeps writing
to FlowRiskOracle on 0G, while KeeperHub gets used for a *new* on-chain
action where the Turnkey wallet is the natural caller (depeg-triggered
protective swap on Uniswap mainnet). This sidesteps the modifier collision
and uses each tool for what it's best at.
