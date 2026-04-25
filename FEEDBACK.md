# KeeperHub Integration Feedback

**Project:** Enstabler — Autonomous Stablecoin Flow Intelligence Agent
**Builder:** @zhuyuxin0
**Hackathon:** ETHGlobal Open Agents 2026
**Date:** April 25, 2026

Friction encountered while integrating KeeperHub into Enstabler's autonomous
loop. Every claim about API behaviour was empirically reproduced against the
live API at `app.keeperhub.com`; documentation gaps were verified against
`docs.keeperhub.com` page contents on the same date. HTTP transcripts and
screenshots are retained and available on request.

---

## Builder context (one paragraph)

Enstabler is a solo-built agent that monitors real stablecoin transfers on
Ethereum mainnet (USDT/USDC/DAI/PYUSD), classifies each one (payment /
arbitrage / cex_flow / bot / suspicious / mint_burn), publishes flow risk
scores on-chain to a `FlowRiskOracle` contract on 0G Galileo, and triggers
KeeperHub-executed protective swaps on Uniswap V2 (Sepolia) when the live
USDC/USDT pairwise spread crosses 50 bps. KeeperHub Direct Execution is the
sole writer for the swap path. The findings below were collected over a
single afternoon's integration work.

---

## Claim 1 — Direct Execution page contradicts the canonical Bearer auth scheme

**Verdict: VERIFIED**

The Direct Execution API page at `docs.keeperhub.com/api/direct-execution`
literally states:

> All direct execution endpoints require an API key passed in the `X-API-Key`
> header:
> ```
> X-API-Key: keeper_...
> ```

This contradicts every other auth example in the docs:

- **Authentication page**: `Authorization: Bearer kh_your_api_key`
- **Webhook Authentication section**: `Authorization: Bearer wfb_your_api_key`
- **API Keys page**: keys are described with `kh_` (organization) or `wfb_`
  (user-scoped) prefixes. No `keeper_` prefix exists in the actual API.

Two issues:

1. **Wrong header name.** The page documents `X-API-Key`; the API requires
   `Authorization: Bearer`.
2. **Wrong key prefix.** The page documents `keeper_`; actual keys minted in
   the dashboard begin with `kh_`.

This looks like a residue of an earlier rebrand (`keeper_` → `kh_`) or auth
migration where one example page wasn't swept.

### Empirical reproduction (HTTP transcripts)

```bash
# Documented header — fails
$ curl -s -o /dev/null -w "%{http_code}\n" \
    -H "X-API-Key: kh_<live_key>" -H "Content-Type: application/json" \
    -X POST https://app.keeperhub.com/api/execute/contract-call \
    -d '{"contractAddress":"0xa0b8...eb48","network":"ethereum","functionName":"name","functionArgs":"[]"}'
401

# Actual working auth — succeeds
$ curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer kh_<live_key>" -H "Content-Type: application/json" \
    -X POST https://app.keeperhub.com/api/execute/contract-call \
    -d '{"contractAddress":"0xa0b8...eb48","network":"ethereum","functionName":"name","functionArgs":"[]"}'
200   # body: {"result":"USD Coin"}
```

### Suggested fix

1. Replace the auth example on `docs.keeperhub.com/api/direct-execution`
   with the canonical Bearer example used elsewhere:
   ```
   Authorization: Bearer kh_...
   ```
2. Add a top-of-page callout: *"Direct Execution endpoints use the same auth
   as Workflows. The `X-API-Key` header and `keeper_` prefix are not
   supported."*
3. Add a literal `HTTP/1.1 401 Unauthorized` example with the response body
   so builders who hit the failure can grep the docs for the error string.
4. Document the `kh_` / `wfb_` prefix convention at the top of the
   Authentication page so builders know what key shape to expect.

---

## Claim 2 — No static enumeration of supported networks

**Verdict: PARTIALLY VERIFIED (revised from original "no page exists")**

A "Chains API" page does exist at `docs.keeperhub.com/api/chains` and it
documents a `GET /api/chains` endpoint that returns supported networks
programmatically. So the strict claim "there is no page" is wrong.

The real gap is more subtle and arguably worse:

- **The page has no static reference table.** The example response only shows
  Ethereum Mainnet and Sepolia — **2 chains** out of the **"12 EVM chains"**
  advertised on `keeperhub.com`. A reader cannot learn which chains are
  supported from the docs alone — they must make an authenticated API call
  first, which is a chicken-and-egg problem during initial onboarding.

- **The Direct Execution page describes `network` as:**

  > `network` (required): Blockchain network name (e.g., `ethereum`, `base`,
  > `polygon`)

  Three examples, no exhaustive list, no clarification of the exact accepted
  values (is it `ethereum` or `eth-mainnet` or `mainnet`? It turns out **all
  three** work, but the only place this is enumerated is an API error
  response when an unsupported value is sent).

- **The error path itself is the de-facto reference.** Calling
  `POST /api/execute/contract-call` with `network: "0g-galileo"` returns:

  > `{"error":"ABI is required. Could not auto-fetch ABI: Unsupported
  > network: 0g-galileo. Supported: mainnet, eth-mainnet, ethereum-mainnet,
  > ethereum, sepolia, eth-sepolia, sepolia-testnet, base, base-mainnet,
  > …"}`

  That is the most informative network reference in the docs surface, and
  it's an error message.

### Suggested fix

1. Add a static reference table to the Chains page with columns:
   **Display name | `network` slug | Numeric chain ID | Mainnet/testnet | Gas-default tier | Notes**
2. Reconcile the homepage's "12 EVM chains" with the docs — either enumerate
   all 12 explicitly with their `network` strings, or remove the number from
   marketing.
3. Cross-link the Chains page from every endpoint that takes a `network`
   parameter (Direct Execution, contract-call, transfer, Workflows web3
   nodes), and from any Errors-page entry for "Unsupported network".

---

## Claim 3a — HTTP 202 success is undocumented and contradicts the page's framing

**Verdict: VERIFIED**

The Direct Execution page documents the response shape:

> ```json
> {
>   "executionId": "direct_123",
>   "status": "completed"
> }
> ```
> The execution runs synchronously. Status will be `completed` or `failed`
> when the request returns.

…and the Error Responses section lists status codes `401`, `422`, `429`,
`400`. It **never lists the success status code.** The string "200" does
not appear; the string "202" does not appear.

In practice, successful write operations return **HTTP 202 Accepted**.

### Empirical reproduction (from the agent's runtime log)

```
WARNING enstabler.swap: swap: USDC approve failed: status=202
  body={'executionId': '2gtztnd17qabe3mr7reol', 'status': 'completed'}
```

The transaction landed on chain. The `status: "completed"` body confirmed it.
The retrievable tx hash via `/api/execute/{id}/status` confirmed it. But my
client treated the response as a failure because the docs led me to gate on
`status === 200`.

This is a footgun for two structural reasons:

1. **RFC 7231 defines 202 as "Accepted, but processing has not been
   completed."** Returning 202 with a body that says `status: "completed"`
   conflates the two layers (HTTP semantics vs application semantics) in
   exactly the way HTTP status codes were designed to avoid.
2. **The docs' "synchronous" framing reinforces 200 as the expected success
   code.** A reasonable client written from the docs alone will branch on
   `200`.

### Suggested fix

1. Add explicit HTTP status codes to every response example on the page:
   ```
   HTTP/1.1 202 Accepted
   ```
2. Add a callout: *"Successful write operations return HTTP 202. Branch on
   the JSON body's `status` field, not the HTTP status code."*
3. Or, if the team prefers strict HTTP semantics, change the response code
   to 200 for completed and 422 for failed and update docs accordingly —
   either is fine, but the docs and the API have to agree.

---

## Claim 3b — Numeric chain-ID escape hatch is undocumented

**Verdict: VERIFIED**

The Direct Execution page describes the `network` parameter as:

> `network` (required): Blockchain network name (e.g., `ethereum`, `base`,
> `polygon`)

No mention of numeric chain IDs. The Chains page documents `chainId` as a
**field** in the response object (e.g. `"chainId": 1`, `"chainId":
11155111`) but nowhere indicates these can be passed as the `network` value
in execution requests.

### Empirical reproduction

By accident I tried `network: "16602"` (decimal chain ID for 0G Galileo,
which is *not* in the named-networks list). The error switched from
"Unsupported network" to:

> `{"error":"ABI is required. Could not auto-fetch ABI: No explorer API
> configured for chain 16602","field":"abi"}`

That is a **different error class** — the chain *is* recognized at the
routing layer; only the auto-ABI-from-explorer lookup is unconfigured.
Supplying `abi` explicitly in the request body bypasses this entirely and
the call lands on chain. So **any EIP-155 chain ID can be passed as a
decimal string in the `network` field**, and the API routes to it.

This is load-bearing for Enstabler: 0G Galileo (chain ID 16602) is not in
the supported-networks named list, but our integration works because of
this escape hatch. **Anyone integrating with a long-tail chain depends on
silently-supported behaviour the team can break in any release without a
deprecation notice.**

### Suggested fix

1. If this is intentionally supported: add a "Custom EVM Chains" subsection
   to the Chains page documenting it: *"Any EIP-155 chain ID may be passed
   as a decimal string in the `network` field (e.g. `"16602"`). Custom
   chains use default gas heuristics and the network's standard public RPC.
   ABI auto-fetch, explorer links, and gas-tier defaults are not available;
   pass the `abi` field explicitly. SLA guarantees apply only to chains in
   the named list."*
2. Enumerate which behaviours degrade on custom chains so builders make
   informed reliability tradeoffs.
3. Add a worked example to the Direct Execution page using
   `"network": "16602"` so the path is searchable.
4. Or, if the behaviour is **not** intentionally supported and may be
   removed, add input validation that rejects unknown chain IDs with a
   clear error, and document the supported values exhaustively. Either
   support it or deprecate it — leaving it as silent quicksand is the
   worst option.

---

## Claim 4 — No REST endpoint for Turnkey wallet-address discovery

**Verdict: VERIFIED**

No page in the docs describes a REST endpoint to programmatically retrieve
the Turnkey wallet address tied to an API key. The CLI exposes wallet
context — `kh wallet`, `kh wallet balance`, `kh wallet tokens` — proving
the underlying state is reachable. The corresponding REST endpoint is not
documented.

The Direct Execution page references wallet management only in an error
context:

> `422`: Wallet not configured (see Wallet Management)

The documented onboarding path:

> "Create an account at app.keeperhub.com — a Turnkey wallet is provisioned
> automatically"
>
> "Fund your wallet with ETH on your target network."

…with no hint of how to retrieve the wallet address other than navigating
the dashboard UI. This is an **onboarding-friction blocker** for the
explicit use case the docs themselves call out:

> "For teams that prefer programmatic control, the REST API lets you create,
> update, trigger, and monitor workflows from your own tooling or CI/CD
> pipelines."

You cannot do programmatic CI/CD if step one ("get your wallet address to
fund it") requires a human in `app.keeperhub.com`.

### Architectural side effect on Enstabler

I deployed `FlowRiskOracle.sol` on 0G Galileo with an `onlyAgent` modifier
locked to `msg.sender = my deployer wallet` at deploy time. KeeperHub's
Turnkey wallet has a different address. Without a programmatic way to
discover that address before deploy, I couldn't predeploy with the right
`agent` permission. I worked around this by routing FlowRiskOracle writes
via direct `web3.py` (my deployer wallet signs them) and using KeeperHub
Direct Execution for a separate path (Sepolia Uniswap protective swap),
where the Turnkey wallet is the natural caller. **The hybrid architecture
was forced by the missing discovery API.**

### Suggested fix + feature request

1. Expose `GET /api/user` (or `GET /api/wallet/me`) returning at minimum:
   ```json
   {
     "userId": "...",
     "organizationId": "...",
     "wallet": {
       "address": "0x...",
       "turnkeyWalletId": "..."
     }
   }
   ```
   Document on the User page (already in the sidebar).
2. Add a CLI flag `kh wallet address` that prints just the hex address,
   suitable for shell scripting: `WALLET=$(kh wallet address)`.
3. Add a "Programmatic Onboarding" recipe to Quickstart that shows the full
   no-UI flow: create API key → `GET /api/wallet/me` → fund returned address
   → first `POST /api/execute/contract-call`.
4. If exposing this is blocked on a security review, document the workaround
   explicitly: *"There is no REST endpoint for wallet discovery. Retrieve
   your wallet address from app.keeperhub.com → Settings → Wallet."* That
   removes the surprise even if it doesn't remove the friction.

---

## Summary

| # | Claim | Verdict |
|---|---|---|
| 1 | Direct Execution shows `X-API-Key: keeper_...` instead of `Authorization: Bearer kh_...` | **VERIFIED** — page literally shows wrong header; live API returns 401 with documented header, 200/202 with Bearer |
| 2 | No static list of supported networks | **PARTIALLY VERIFIED** — Chains page exists with `GET /api/chains`; example shows only 2 of 12 advertised chains; no static reference table |
| 3a | HTTP 202 not documented as success code | **VERIFIED** — docs list error codes (401, 422, 429, 400) but never the success code; live writes return 202 |
| 3b | Numeric chain-ID escape hatch undocumented | **VERIFIED** — `network` parameter documented as a "name" only; API silently accepts numeric strings (`"16602"` works) |
| 4 | No REST endpoint for wallet-address discovery | **VERIFIED** — CLI has `kh wallet`, REST equivalent missing; documented onboarding requires dashboard UI |

## Working integration verified

After resolving every gap above, Enstabler's KeeperHub integration is
operational:

- `Authorization: Bearer kh_<key>` against `/api/execute/contract-call` with
  `network: "ethereum"` and explicit ABI: USDC `name()` returned
  `"USD Coin"` (proves the auth + read path).
- ERC20 `approve()` for the Uniswap V2 Router on the same endpoint:
  returned `HTTP 202 {"executionId": "2gtztnd17qabe3mr7reol", "status":
  "completed"}` (proves the write path + 202 success semantics).
- `network: "16602"` for 0G Galileo: routing works once ABI is supplied
  (proves the custom-chain escape hatch).

The publisher in `agent/swap.py` is wired to fire a $100 protective
USDC↔USDT swap on Uniswap V2 Sepolia via KeeperHub Direct Execution when
our Coingecko-monitored mainnet USDC/USDT spread crosses 50 bps. Hybrid by
design: real depeg signal sourced from mainnet, free testnet execution for
the demo.
