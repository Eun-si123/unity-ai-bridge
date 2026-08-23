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

**Current state:** ✅ Verified milestone — completed 2026-08-22

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

✅ **Passed.** Phase 0 was squash-merged to `main` on 2026-08-22.

---

# Phase 1 — Minimal Local End-to-End

**Goal:** prove complete requests can travel from MCP to Unity and back correctly, then establish the minimum useful local tool slice.

**State:** ✅ Verified milestone — completed 2026-08-23

Target flow:

```text
MCP client
  -> public MCP server
  -> local bridge transport
  -> Unity command queue
  -> Unity main thread
  -> Unity Editor API
  -> structured result
  -> MCP result
```

Verified foundation slice:

- ✅ Real Unity package load/compile on Unity 6000.3.21f1
- ✅ Real local WebSocket hello and `editor.status` round trip
- ✅ Real MCP stdio handshake and `unity_get_status` call against live Unity
- ✅ Active scene / Play Mode / compilation state returned as structured data
- ✅ Request IDs, deadlines, routing generation checks, timeout/disconnect handling
- ✅ Structured bridge error propagation, including real `routing/stale_connection`
- ✅ Domain-reload reconnect with stable editor identity and new `connectionGeneration`
- ✅ Post-reconnect command success on the new generation

Minimum capabilities:

- ✅ Unity/editor status
- ✅ Active scene information
- ✅ Hierarchy read with bounded traversal and `GlobalObjectId` metadata
- ✅ Create one simple GameObject with Undo/dirty metadata and duplicate-retry protection
- ✅ Read bounded Console/compiler diagnostics
- ✅ Capture a real compiler error with severity/message/file/line/column metadata
- ✅ Structured error model for current read/write/routing paths
- ✅ First mutation request identity and retry protection

### Exit gate

✅ **Passed on 2026-08-23.** The clean Unity 6000.3.21f1 test project completed the minimum capabilities through real MCP-to-Unity paths. The final compiler diagnostic test captured an intentional `CS0103` at `Assets/MCPCompileErrorTest.cs`, line 5, column 21.

---

# Phase 2 — Reliability Core

**Goal:** make AI changes recoverable and resilient to normal Unity lifecycle events.

**State:** 🟨 In progress — officially entered after Phase 1 completion on 2026-08-23

The common reliability core is now substantially implemented and runtime-verified for the bounded `gameObject.create` mutation path. Remaining work is mainly to generalize those guarantees across future write families and close save/dirty/cancellation/full-restart gaps.

- 🟨 Main-thread dispatcher hardened — one queued Unity main-thread boundary is verified across current reads and the bounded write path; broader future tool coverage remains
- 🟨 Structured scene/state snapshot suitable for preflight and verification — hierarchy/resolver/status carry structured state and `stateEpoch`/`stateRevision`, but a broader canonical snapshot contract is still pending
- ✅ Stable object resolver — live Unity 6000.3.21f1 re-resolved a created GameObject by `GlobalObjectId`; after Undo the same identifier returned `found=false`
- ✅ State revision / stale-state detection — fresh observed state permits the write, a different write using the stale token fails closed before mutation, and Undo advances the state detector
- 🟨 Serialized conflicting writes — current bridge work is funneled through a single main-thread queue and the common mutation core rejects re-entrant overlap; richer per-target conflict scheduling is future work
- ✅ Common mutation preflight framework — compilation state, active-scene validity, optional state revision expectations, and one-at-a-time mutation checks exist on the common transaction path
- ✅ Undo transaction grouping — the common transaction opens/names/collapses an Undo group and `gameObject.create` is verified through it
- 🟨 Scene dirty-state policy/reporting — create reports/marks dirty; rollback was verified when the test scene was already dirty, but restoration semantics for a previously clean scene are not established
- ⬜ Explicit save behavior — writes do not silently save; a deliberate save contract/tool remains to be designed and verified
- ✅ Compilation/domain-reload mutation lifecycle — a `SessionState` mutation ledger survives real script-domain reload and blocks ambiguous same-ID re-execution after reload
- ✅ Domain reload connection recovery — stable editor identity reconnects with a new connection generation
- ✅ Reconnection and connection generations — stale-generation routing is rejected and commands succeed on the current generation
- ✅ Unity Agent capability/version negotiation — `editor.status` advertises `agentVersion` + supported operations and MCP preflights capabilities before non-status operations
- 🟨 Timeout/cancellation behavior — request deadlines/timeouts exist; generalized cancellation outcome/reconciliation semantics remain pending
- 🟨 Duplicate/replayed request protection — `gameObject.create` has verified immediate dedup, native replay revalidation, stale-target rejection, and reload ambiguity protection; future mutation families must adopt the same contract
- 🟨 Native readback after writes — verified for the bounded GameObject-create identity/existence contract; broader component/property/asset readback remains future work
- 🟨 Semantic verification of intended state — verified for create identity/existence and absence after rollback; a generalized verification-result contract is the next reliability slice
- ✅ Rollback on failed verification — a forced verifier failure caused the common Undo transaction to revert the created object
- 🟨 Verification that rollback itself restored expected state — native resolver + hierarchy confirmed absence in the bounded rollback probe; this is not yet a reusable rollback-verification contract for arbitrary mutations
- ✅ Initial Unity EditMode reliability tests — 8/8 passed on Unity 6000.3.21f1 for state-revision and mutation-lifecycle fail-closed rules

### Exit gate

Normal disconnects, compilation, domain reload, stale-state, retry, agent-version skew, and failed-write scenarios do not silently duplicate mutations, lose routing identity, execute unsupported operations, or report false success; write outcomes are verified against native Unity state and recover safely when verification fails.

Remaining Phase 2 exit-gate work includes generalized semantic/rollback verification, explicit save and clean-scene dirty-state semantics, cancellation reconciliation, and enough coverage to show new write families inherit the same guarantees rather than reimplementing them ad hoc.

---

# Phase 3 — Useful Unity Editing Core

**Goal:** move from technical demo to something that can perform normal Unity development work.

**State:** ⬜ Planned

Target tool families:

- ⬜ GameObject create/read/update/delete beyond the verified Phase 1 empty-root create primitive
- ⬜ Transform editing
- ⬜ Component inspect/add/remove/edit
- ⬜ Asset search/inspect
- ⬜ Prefab inspect/create/apply workflows
- ⬜ Script read/write workflows
- ⬜ Console/compiler diagnostics beyond the Phase 1 minimum
- ⬜ Play Mode control
- ⬜ Unity Test Runner integration
- ⬜ Undo/recovery tools

Supporting work:

- ⬜ Capability/version reporting beyond the current local Agent operation preflight
- ⬜ Consistent risk classification
- ⬜ Tool schema compatibility tests
- ⬜ Better error explanations for AI clients

### Exit gate

A small Unity project can be meaningfully inspected and edited from an MCP client without relying on arbitrary code execution.

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

**Goal:** make Unity AI Bridge usable from ChatGPT through the supported plugin/app/MCP integration path available at release time.

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
