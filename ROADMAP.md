# Unity AI Bridge — Public Roadmap

> **Pre-alpha roadmap.** This is a direction document, not a release promise or proof of implementation.
>
> For actual implementation/verification status, see [`STATUS.md`](STATUS.md).

Unity AI Bridge aims to make safe AI control of the Unity Editor easy enough that a beginner can install a Unity package, connect an AI client, and start working without learning MCP configuration, networking, or editor scripting first.

## Roadmap principles

- Capability gates matter more than dates.
- A feature does not advance because code merely exists; it advances when the required verification evidence exists.
- Reliability, Undo, reconnect behavior, object identity, and security are product features, not cleanup work.
- The project will not chase a 300+ tool count before the core is trustworthy.
- ChatGPT is an important target, but the public core remains provider-neutral.

## Legend

- ⬜ Planned
- 🟨 In progress
- ✅ Verified milestone
- ⛔ Blocked

These roadmap markers describe milestone progress only. `STATUS.md` is authoritative for individual implementation claims.

---

# Phase 0 — Foundation

**Goal:** make the repository safe for humans and AI agents to continue without relying on lost conversation context.

**State:** ✅ Verified milestone — completed 2026-08-22

- ✅ Public/private repository boundary defined
- ✅ AI/contributor hallucination guardrails documented
- ✅ Architecture boundaries documented
- ✅ Durable design blueprint documented
- ✅ Architecture decisions recorded
- ✅ Third-party provenance rules established
- ✅ Public roadmap created
- ✅ Initial Unity support target selected and pinned — Unity 6000.3.21f1
- ✅ Initial source tree scaffolded and exercised
- ✅ TypeScript/runtime/dependency versions pinned with generated lockfile
- ✅ Bridge protocol v0 schema/types/fixtures defined
- ✅ Initial automated build/test commands verified in CI
- ✅ Unity package load/compile verified on Windows / Unity 6000.3.21f1
- ✅ Project license selected — Apache License 2.0 for the public core

### Exit gate

✅ **Passed.**

---

# Phase 1 — Minimal Local End-to-End

**Goal:** prove complete requests can travel from MCP to Unity and back correctly, then establish the minimum useful local tool slice.

**State:** ✅ Verified milestone — completed 2026-08-23

Verified foundation:

- ✅ Real Unity package load/compile on Unity 6000.3.21f1
- ✅ Real local WebSocket hello and `editor.status` round trip
- ✅ Real MCP stdio handshake and `unity_get_status`
- ✅ Active scene / Play Mode / compilation state as structured data
- ✅ Request IDs, deadlines, routing generation checks, timeout/disconnect handling
- ✅ Structured bridge errors including real stale-connection rejection
- ✅ Domain-reload reconnect with stable editor identity and new `connectionGeneration`
- ✅ Post-reconnect command success
- ✅ Bounded active-scene hierarchy with `GlobalObjectId`
- ✅ One empty root GameObject create mutation
- ✅ Duplicate-retry protection
- ✅ Bounded Console/compiler diagnostics
- ✅ Real compiler error with severity/message/file/line/column metadata

### Exit gate

✅ **Passed on 2026-08-23.**

---

# Phase 2 — Reliability Core

**Goal:** make AI changes recoverable and resilient to normal Unity lifecycle events.

**State:** ✅ Verified milestone — completed 2026-08-23 for the tool surface implemented at exit

Phase 2 established the common safety contract that future write tools must adopt individually.

- ✅ Main-thread execution for current bridge operations
- 🟨 Structured scene/state snapshot — epoch/revision + bounded hierarchy/state metadata are available; richer component/asset snapshots move with Phase 3 tool families
- ✅ Stable object resolver using Unity `GlobalObjectId`
- ✅ State revision / stale-state rejection
- ✅ Current single-editor command serialization + mutation re-entry guard
- ✅ Undo transaction grouping for Undo-capable mutation paths
- ✅ Dirty-state outcome reporting, including explicit rollback dirty residue
- ✅ Explicit active-scene save operation
- ✅ Compilation/domain-reload mutation lifecycle for the current Editor session
- ✅ Domain reload recovery and new connection generation
- ✅ Agent capability/version preflight
- ✅ Receive-time + execution-boundary deadline checks for current writes
- ✅ Duplicate/replayed request protection for current writes
- ✅ Common mutation preflight framework
- ✅ Native readback for the current create write
- ✅ Structured semantic verification outcome contract
- ✅ Rollback on failed verification
- ✅ Native verification that rollback restored operation-specific state
- ✅ Unity EditMode reliability suite — **19 Passed / 0 Failed** on Unity 6000.3.21f1

Verified slices:

- ✅ PR #10 — stable resolver / create readback / stale replay
- ✅ PR #11 — capability negotiation/preflight
- ✅ PR #12 — common transaction + Undo core
- ✅ PR #13 — forced rollback probe
- ✅ PR #14 — state revision / stale-state rejection
- ✅ PR #15 — domain-reload-safe same-session mutation lifecycle
- ✅ PR #16 — 8/8 EditMode reliability tests
- ✅ PR #17 — structured verification + rollback verification, 12/12
- ✅ PR #18 — dirty-state reporting, 14/14
- ✅ PR #19 — explicit scene save, 16/16
- ✅ PR #20 — execution-boundary deadlines, 19/19

### Exit gate

✅ **Passed for the current implemented surface.** Normal reconnect/domain reload, stale state, retry/replay, Agent capability skew, failed verification/rollback, explicit persistence, and queued deadline expiry do not silently duplicate the current writes or report success without the expected native evidence.

Important limits remain explicit rather than being promoted to fake completion: full Editor-restart mutation persistence is not implemented, Undo rollback may leave a clean scene dirty, an already-started Unity API call is not force-interrupted, and future Phase 3 write families still require their own native semantic verification.

See [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md).

---

# Phase 3 — Useful Unity Editing Core

**Goal:** move from technical demo to something that can perform normal Unity development work without arbitrary code execution.

**State:** 🟨 In progress — entered 2026-08-23

Target tool families, in approximate implementation order:

- ✅ Transform read/update for a resolved GameObject — `unity_get_transform` + `unity_set_transform` verified on Windows / Unity 6000.3.21f1 with native readback, same-id replay, Undo restoration, stale-replay rejection, cleanup, and **23 Passed / 0 Failed** EditMode tests
- 🟨 GameObject editing beyond create — empty-root create is verified; update/delete remain pending
- ⬜ Component inspect/add/remove/edit
- ⬜ Asset search/inspect
- ⬜ Prefab inspect/create/apply workflows
- ⬜ Script read/write workflows
- ⬜ Diagnostics beyond the Phase 1 minimum where additional coverage is useful
- ⬜ Play Mode control
- ⬜ Unity Test Runner control
- ⬜ Explicit Undo/recovery tools where useful to clients

Reliability requirements inherited from Phase 2:

- stable target resolution,
- stale-state preconditions,
- explicit risk classification,
- main-thread execution,
- Undo grouping where applicable,
- native readback/semantic verification,
- rollback + rollback verification where applicable,
- mutation identity/replay semantics,
- execution-boundary deadline enforcement,
- explicit dirty/save behavior,
- automated + real Unity verification before a write family is marked Verified.

Supporting work:

- ✅ Capability/version reporting foundation already exists
- 🟨 Consistent risk classification — current read/write/destructive operations classified; new tools must follow the same scheme
- ⬜ Broader tool-schema compatibility tests as the surface grows
- ⬜ Better structured error explanations for AI clients

### Exit gate

A small Unity project can be meaningfully inspected and edited from an MCP client without relying on arbitrary code execution, and the useful editing operations retain Phase 2 reliability guarantees.

---

# Phase 4 — Easy Connect / Remote Gateway

**Goal:** remove local networking/MCP setup from the normal user experience.

**State:** ⬜ Planned

Target user experience:

```text
Install Unity package
 -> Connect AI
 -> pairing code
 -> approve/bind
 -> connected
```

Engineering targets:

- ⬜ Outbound secure Unity WebSocket
- ⬜ Remote Streamable HTTP MCP endpoint
- ⬜ Short-lived pairing flow
- ⬜ Scoped connection credentials
- ⬜ User/workspace/editor routing model
- ⬜ Multiple editor instances
- ⬜ Strict cross-user isolation tests
- ⬜ Rate limits and abuse controls
- ⬜ Presence/disconnect state
- ⬜ Self-hosted remote deployment path

### Exit gate

Two different users with multiple Unity Editors can connect concurrently and automated isolation tests prove that commands cannot cross account/editor boundaries.

---

# Phase 5 — ChatGPT Integration Beta

**Goal:** make Unity AI Bridge usable from ChatGPT through the supported integration path available at release time.

**State:** ⬜ Planned

- ⬜ Verify current OpenAI integration requirements at implementation time
- ⬜ Thin ChatGPT-facing adapter/metadata
- ⬜ Tool descriptions optimized for safe model use
- ⬜ Authentication/pairing UX
- ⬜ Destructive-action policy/confirmation behavior
- ⬜ End-to-end tests through the real ChatGPT integration
- ⬜ Beginner installation documentation
- ⬜ Private beta
- ⬜ Public directory/submission work if eligible

### Exit gate

A new user can install the Unity side, connect from ChatGPT using documented steps, perform core editing tasks, and recover from normal failures without editing MCP configuration manually.

---

# Phase 6 — Multi-Provider Integrations

**Goal:** prove the core is genuinely provider-neutral.

**State:** ⬜ Planned

Potential targets, subject to current platform support:

- ⬜ Claude remote MCP/connector path
- ⬜ Codex MCP path
- ⬜ Gemini/Gemini CLI integration path
- ⬜ Other standards-compliant MCP clients
- ⬜ Compatibility test matrix

### Exit gate

The same core tool contracts work across multiple independent MCP clients without vendor-specific logic leaking into Unity handlers.

---

# Phase 7 — Advanced Unity Domains

**Goal:** expand coverage after the execution core is trustworthy.

**State:** ⬜ Planned

Candidate domains, prioritized by real demand and testability:

- ⬜ Terrain
- ⬜ NavMesh
- ⬜ Animation/Animator
- ⬜ UI and UI Toolkit
- ⬜ Lighting
- ⬜ Particles/VFX
- ⬜ Shader Graph
- ⬜ Profiler / memory / frame diagnostics
- ⬜ Build tooling
- ⬜ Package Manager
- ⬜ Multiplayer Play Mode
- ⬜ GameView/screenshot inspection

The list is intentionally not a promise that every domain will ship.

---

# Phase 8 — Extensibility and Ecosystem

**Goal:** let advanced teams extend Unity AI Bridge without forking the core.

**State:** ⬜ Planned

Possible work:

- ⬜ Safe custom-tool extension API
- ⬜ Capability discovery/lazy advanced tools
- ⬜ Third-party package adapters
- ⬜ Versioned extension contracts
- ⬜ Extension validation/security guidance
- ⬜ Examples and templates

Arbitrary code execution is not considered a substitute for a proper extension system.

---

# Not on the early roadmap

These are intentionally deferred unless requirements change:

- 300+ tools for marketing purposes
- arbitrary shell/process control
- unrestricted arbitrary C# execution
- arbitrary third-party EditorWindow GUI automation
- Unity Hub account automation
- multi-agent orchestration
- TeamForge integration
- billing/monetization systems before the product itself works reliably

---

# Version direction

Exact versions are not promises, but the likely semantic progression is:

```text
0.0.x  foundation / protocol experiments
0.1.x  verified local core
0.2.x  reliability + useful editing
0.3.x  remote Easy Connect
0.4.x  client/app beta integrations
0.x    expansion and compatibility hardening
1.0    only after stable contracts, migration policy, security review,
       and repeatable real-world usage justify it
```

Do not bump a version merely to make the project appear mature.

---

# How roadmap items move

For a roadmap item to move toward completion:

1. implementation exists,
2. relevant automated/manual verification is performed,
3. evidence is recorded in `STATUS.md` or linked test output,
4. documentation is updated,
5. known limitations are stated.

A roadmap checkbox alone is never proof that a feature works.
