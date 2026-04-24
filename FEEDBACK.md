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

**Next step**: swap `_send_tx` to hit the KeeperHub API once creds are provisioned.
