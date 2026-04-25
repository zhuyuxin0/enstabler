# KeeperHub Integration Feedback

Running log of KeeperHub integration friction, feature requests, and UX notes
from building Enstabler (ETHGlobal Open Agents, Apr 2026).

Each entry is dated and includes concrete, reproducible context. Every claim
about API behaviour was empirically verified against the live API at
`app.keeperhub.com` on 2026-04-25 with HTTP transcripts retained. Documentation
gaps were independently audited against the live `docs.keeperhub.com` content
on the same date (Mintlify-style SPA — sub-pages return 403 to non-browser
fetchers, so the audit relied on Google's index of page contents and
sidebar structure).

---

## 2026-04-25 — Publisher integration: KeeperHub vs direct web3

**Context**: Built `agent/publisher.py` to publish flow-risk scores to
`FlowRiskOracle.sol` on 0G Galileo. The class is structured with a single
`_send_tx(args)` method so swapping in KeeperHub Direct Execution is a
one-file change. Policy: only risk_level ≥ 2 publishes on-chain, with a
15-second cooldown between txs.

**What would have unblocked earlier integration**:

- A one-line `curl` example for submitting a contract call via KeeperHub's
  HTTP API on the very first page a developer lands on, before MCP or CLI
  setup. The first 10 minutes of any integration is "prove the happy path."
- A clear statement on the landing doc whether KeeperHub is primarily an
  MCP tool (for agentic sessions in Claude Code etc.) vs. a runtime API for
  Python/Node servers. Both paths exist; the landing prose conflates them.

---

## 2026-04-25 — Documentation inconsistencies (5 issues)

### 1. Direct Execution page contradicts the canonical Bearer auth scheme

The Direct Execution API page states:

> All direct execution endpoints require an API key passed in the `X-API-Key` header:
>
> ```
> X-API-Key: keeper_...
> ```

This contradicts every other auth example in the docs:

- **Authentication page**: `Authorization: Bearer kh_your_api_key`
- **Webhook Authentication section**: `Authorization: Bearer wfb_your_api_key`
- **API Keys page**: keys are described as starting with `kh_` (organization)
  or `wfb_` (user-scoped webhook). No `keeper_` prefix appears anywhere else.

**Empirical reproduction (HTTP transcript, retained):**

```
$ curl -s -o /dev/null -w "%{http_code}\n" \
    -H "X-API-Key: kh_<live_key>" -H "Content-Type: application/json" \
    -X POST https://app.keeperhub.com/api/execute/contract-call \
    -d '{"contractAddress":"0xa0b8...eb48","network":"ethereum","functionName":"name","functionArgs":"[]"}'
401

$ curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer kh_<live_key>" -H "Content-Type: application/json" \
    -X POST https://app.keeperhub.com/api/execute/contract-call \
    -d '{"contractAddress":"0xa0b8...eb48","network":"ethereum","functionName":"name","functionArgs":"[]"}'
200   # body: {"result":"USD Coin"}
```

So the documented header returns 401, and the auth scheme used by the
adjacent Workflows + Webhook pages (Bearer) is what actually works. This
divergence cost ~10 minutes on first contact — the kind of friction the
team is paying this bounty to surface.

**Why it matters**: this looks like an artefact of an earlier rebrand
(`keeper_` → `kh_`) or auth migration where one example page wasn't swept.
Builders will hit it, won't find a 401-debugging note in the docs, and will
either rotate their key suspecting key error or start adding both headers.

**Suggested doc edits**:
1. Replace the entire "Authentication" section of the Direct Execution page
   with the Bearer example, identical to Workflows/Webhook pages.
2. Add an `HTTP/1.1 401 Unauthorized` example showing the body returned when
   the wrong header is sent, so the error is grep-able.
3. Document the `kh_` / `wfb_` prefix convention at the top of the
   Authentication page so builders know what shape of key to expect.

---

### 2. "Chains" page exists but the supported-network surface is fragmented

A top-level **Chains** entry exists in the docs sidebar (between Tags and
User), so my initial claim that "no page exists" was wrong. The real issue
is more subtle and arguably worse.

The only enumerated list of supported chains anywhere in the indexed docs
content is in the Overview prose:

> "KeeperHub operates on Ethereum, Base, Arbitrum, Polygon, Sepolia, and
> additional EVM-compatible networks. Chain-specific gas defaults are
> applied automatically based on network conditions and trigger type."

That's five chains plus "and additional EVM-compatible networks" — a
hand-wave. Meanwhile, the marketing site (keeperhub.com) advertises
**"12 EVM chains"**, a number that does not appear anywhere in the indexed
developer docs. The Chains page itself surfaces no enumerable content in
indexed snippets.

The empirical workaround integrators actually use to discover supported
chains is the API error response. Calling
`POST /api/execute/contract-call` with `network: "0g-galileo"` returns:

> `{"error":"ABI is required. Could not auto-fetch ABI: Unsupported network:
> 0g-galileo. Supported: mainnet, eth-mainnet, ethereum-mainnet, ethereum,
> sepolia, eth-sepolia, sepolia-testnet, base, base-mainnet, …"}`

That is the most useful network reference in the entire docs surface, and
it's an error message, not documentation.

**Suggested doc edits**:
1. Rename "Chains" → "Supported Networks (Chains)" so it's discoverable to
   builders searching the obvious term.
2. Replace the prose enumeration with a complete table on the Chains page:
   | Display name | `network` value | Numeric chain ID | Mainnet/testnet | Gas-default tier | Notes |
   |---|---|---|---|---|---|
3. Reconcile with the marketing site's "12 EVM chains" — list all 12
   explicitly with their `network` strings, or remove the number from
   marketing.
4. Cross-link the Chains page from every endpoint page that takes a
   `network` parameter, and from any Errors-page entry for "Unsupported
   network".

---

### 3. HTTP 202 success is undocumented and contradicts the page's own framing

The Direct Execution page states:

> "The execution runs synchronously. Status will be `completed` or `failed`
> when the request returns."

In practice, successful write operations return **HTTP 202 Accepted**, not
200. Reproduction:

```
# After running an ERC20 approve via /api/execute/contract-call:
WARNING enstabler.swap: swap: USDC approve failed: status=202
  body={'executionId': '2gtztnd17qabe3mr7reol', 'status': 'completed'}
```

The transaction landed on chain (`status: "completed"` in the body, real
tx hash retrievable via `/api/execute/{id}/status`), but my client treated
it as a failure because the docs led me to gate on `status === 200`.

This is a footgun for two reasons:

1. **RFC 7231 defines 202 as "Accepted, but processing has not been
   completed."** Returning 202 with a body that says `status: "completed"`
   conflates the two layers (HTTP semantics vs application semantics) in
   exactly the way HTTP status codes were designed to avoid.
2. **The canonical "synchronous" framing in the docs reinforces 200 as the
   expected success code.** Adjacent Keeper-named products (e.g. Keeper
   Commander's service-mode REST API) explicitly call out
   `Response (202 Accepted)` for async-queue submissions distinct from a
   200 synchronous path. KeeperHub appears to have inherited the 202
   convention without inheriting that documentation hygiene.

**Suggested doc edits**:
1. Add a "Response" section to the Direct Execution page with two literal
   examples: `HTTP/1.1 202 Accepted` for `status: "completed"` (success on
   chain) and for `status: "failed"` (revert), each with a body sample.
2. Add a callout: *"Do not branch on `res.status === 200`. Branch on the
   JSON body's `status` field."*
3. Or, if the team prefers strict HTTP-code semantics, change the response
   to 200 for completed and 422 for failed, and update docs accordingly.

---

### 4. Numeric chain IDs are silently accepted, undocumented escape hatch

By accident I tried `network: "16602"` (decimal chain ID for 0G Galileo).
The error switched from "Unsupported network" to:

> `{"error":"ABI is required. Could not auto-fetch ABI: No explorer API
> configured for chain 16602","field":"abi"}`

That is a *different* error class — the chain *is* recognized at the
routing layer; only the auto-ABI-from-explorer lookup is unconfigured.
Supplying `abi` explicitly in the request body bypasses this entirely and
the call lands on chain. So **any EIP-155 chain ID can be passed as a
decimal string in the `network` field**, and the API will route to it.

For Enstabler this was load-bearing: 0G Galileo (16602) is not in the
supported-networks named list, but our integration works because of this
escape hatch. **Anyone integrating with a long-tail chain depends on
silently-supported behaviour that the team can break in any release.**

**Suggested doc edits**:
1. Document the escape hatch on the Chains page (or Direct Execution page):
   *"Any EIP-155 chain ID may be passed as a decimal string in the
   `network` field (e.g. `"16602"`). Custom chains use default gas
   heuristics and the network's standard public RPC; SLA guarantees apply
   only to chains in the named list above."*
2. Enumerate which behaviours degrade on custom chains (gas-tier defaults,
   MEV protection, multi-RPC failover) so builders make informed
   reliability tradeoffs.
3. Add a worked example to Direct Execution using `"network": "16602"` so
   the path is searchable.
4. **Or**, if the team intends to remove this in the next release, add a
   deprecation warning so integrators don't build on quicksand.

---

### 5. No REST endpoint to discover the Turnkey wallet address

The CLI exposes wallet context — `kh wallet`, `kh wallet balance`,
`kh wallet tokens` — which means the underlying state is reachable
programmatically. But there is no documented REST endpoint along
`GET /api/user`, `GET /api/wallet/me`, or `GET /api/wallet`. The User and
Organizations pages exist in the sidebar but neither surfaces an
address-fetching example in indexed snippets.

The documented onboarding path is:

> "Create an account at app.keeperhub.com — a Turnkey wallet is
> provisioned automatically"
> "Fund your wallet with ETH on your target network."

…with no hint of how to retrieve the wallet address other than logging
into the dashboard UI. This is an **onboarding-friction blocker** for the
explicit use case the docs themselves call out:

> "For teams that prefer programmatic control, the REST API lets you
> create, update, trigger, and monitor workflows from your own tooling or
> CI/CD pipelines."

You cannot do programmatic CI/CD if step one of the loop ("get the wallet
address you need to fund") requires a human in app.keeperhub.com.

**Architectural side effect**: I deployed `FlowRiskOracle.sol` on 0G with
an `onlyAgent` modifier locked to `msg.sender = my deployer wallet` at
deploy time. KeeperHub's Turnkey wallet has a different address. Without
discovering that address, I couldn't predeploy with the right `agent`
permission. I worked around this by routing FlowRiskOracle writes via
direct web3 (my deployer wallet) and using KeeperHub Direct Execution for
a separate path (Sepolia Uniswap protective swap), where the Turnkey
wallet is the natural caller. Hybrid architecture forced by missing
discovery API.

**Suggested doc edits + feature request**:
1. Expose a `GET /api/user` (or `GET /api/wallet/me`) endpoint that
   returns at minimum
   `{"userId", "organizationId", "wallet": {"address", "turnkeyWalletId"}}`.
   Document it on the User page in the sidebar.
2. Add a CLI flag `kh wallet address` (or extend `kh wallet`) that prints
   *just* the address, suitable for shell scripting:
   `WALLET=$(kh wallet address)`.
3. Add a "Programmatic onboarding" recipe to the Quickstart that shows the
   full no-UI flow: create API key → `GET /api/wallet/me` → fund returned
   address → first `POST /api/execute/contract-call`.
4. If exposing this is blocked on a security review, document the
   workaround explicitly: *"There is no REST endpoint for wallet
   discovery. Retrieve your wallet address from app.keeperhub.com →
   Settings → Wallet."* That removes the surprise, even if it doesn't
   remove the friction.

---

## 2026-04-25 — Working integration verified

After resolving all five docs gaps above, the integration works end-to-end:

- `Authorization: Bearer kh_<key>` against `/api/execute/contract-call`
  with `network: "ethereum"` and explicit ABI: USDC `name()` returned
  `"USD Coin"` (verified the auth + read path).
- ERC20 `approve()` for the Uniswap V2 Router on the same endpoint:
  returned `HTTP 202 {"executionId": "2gtztnd17qabe3mr7reol", "status":
  "completed"}` (verified the write path + 202 success semantics).
- `network: "16602"` for 0G Galileo: routing works once ABI is supplied
  (verified the custom-chain escape hatch).

The publisher in `agent/swap.py` is wired to fire a $100 protective USDC↔USDT
swap on Uniswap V2 Sepolia via KeeperHub when our Coingecko-monitored
USDC/USDT mainnet spread crosses 50bps. Hybrid by design: real depeg
signal sourced from mainnet, free testnet execution for the demo.
