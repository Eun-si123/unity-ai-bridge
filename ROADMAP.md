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

✅ **Passed.** The repository can be cloned, its architecture understood from repository documentation, dependencies installed, automated checks run, and the Unity package loaded/compiled without relying on private chat history. Phase 0 was squash-merged to `main` on 2026-08-22.

---

# Phase 1 — Minimal Local End-to-End

**Goal:** prove complete requests can travel from MCP to Unity and back correctly, then establish the minimum useful local tool slice.

**State:** 🟨 In progress

Target flow:

```text
MCP client
  -> public MCP server
  -> local bridge transport
  -> Unity command queue
  -> Unity main thread
  -> Unity Editor API
  -> structured result
  -> re-read state for verification
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
- ✅ Hierarchy read — verified through real MCP stdio against Unity 6000.3.21f1 with bounded traversal and `GlobalObjectId` metadata
- 🟨 Create a simple GameObject — implementation and Node/bridge CI pass; real Unity create/dedup/Undo verification pending on `feat/phase1-create-gameobject`
- ⬜ Read Console/compiler errors
- ✅ Structured error model for the current read/routing path
- 🟨 Request IDs and write retry protection — request IDs/routing are verified; the first write tool now has fail-closed same-session idempotency protection, with real Unity verification and cross-restart durability still pending

### Exit gate

A clean test project can perform the minimum capabilities repeatedly with reproducible end-to-end evidence and without freezing the Unity Editor.

---

# Phase 2 — Reliability Core

**Goal:** make AI changes recoverable and resilient to normal Unity lifecycle events.

**State:** ⬜ Planned as a full phase; some connection-lifecycle and first-mutation groundwork was completed early in Phase 1

- 🟨 Main-thread dispatcher hardened — verified for `editor.status` and hierarchy read paths; first write path implemented but pending real runtime verification
- ⬜ Serialized conflicting writes
- ⬜ Stable object resolver
- 🟨 Undo integration — implemented for first GameObject-create mutation; real Unity Undo verification pending
- 🟨 Scene/asset dirty-state reporting — scene dirty reporting implemented for first create mutation; real Unity verification pending
- ⬜ Explicit save behavior
- ⬜ Compilation watcher
- ✅ Domain reload recovery — verified for the local connection/status lifecycle
- ✅ Reconnection and connection generations — verified for the local single-editor lifecycle
- 🟨 Timeout/cancellation behavior — request deadlines/timeouts exist; broader cancellation semantics pending
- 🟨 Duplicate/replayed request protection for mutations — first create operation consumes caller idempotency identity before state change and deduplicates via `SessionState`; real Unity and cross-restart durability remain pending
- ⬜ Unity EditMode test coverage for core execution

### Exit gate

Normal disconnects, compilation, domain reload, and retry scenarios do not silently duplicate mutations, lose routing identity, or report false success.

---

# Phase 3 — Useful Unity Editing Core

**Goal:** move from technical demo to something that can perform normal Unity development work.

**State:** ⬜ Planned

Target tool families:

- ⬜ GameObject create/read/update/delete
- ⬜ Transform editing
- ⬜ Component inspect/add/remove/edit
- ⬜ Asset search/inspect
- ⬜ Prefab inspect/create/apply workflows
- ⬜ Script read/write workflows
- ⬜ Console/compiler diagnostics
- ⬜ Play Mode control
- ⬜ Unity Test Runner integration
- ⬜ Undo/recovery tools

Supporting work:

- ⬜ Capability/version reporting
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
