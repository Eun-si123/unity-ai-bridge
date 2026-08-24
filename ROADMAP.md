# Unity AI Bridge — Public Roadmap

> **Pre-alpha roadmap.** This is a direction document, not a release promise or proof of implementation.
>
> For actual implementation/verification status, see [`STATUS.md`](STATUS.md).

Unity AI Bridge aims to make safe AI control of the Unity Editor easy enough that a beginner can install a Unity package, connect an AI client, and start working without learning MCP configuration, networking, or editor scripting first.

## Roadmap principles

- Capability gates matter more than dates.
- A feature advances only with implementation plus relevant verification evidence.
- Reliability, Undo, reconnect behavior, object identity, and security are product features.
- The project will not chase a huge tool count before the core is trustworthy.
- MCP/provider neutrality is an architectural boundary, not a later compatibility patch.
- ChatGPT is an important first production host target, not the owner of the public core architecture.
- Portable packaging standards may reduce duplicated integration work, but they do not replace the canonical MCP/tool contract.

## Legend

- ⬜ Planned
- 🟨 In progress
- ✅ Verified milestone/slice
- ⛔ Blocked

---

# Phase 0 — Foundation

**State:** ✅ Verified milestone — completed 2026-08-22

Foundation established repository/architecture boundaries, AI grounding rules, provenance, Unity target, source scaffold, pinned dependencies, bridge protocol v0, CI, package compile/load, and Apache-2.0 public-core licensing.

### Exit gate

✅ Passed.

---

# Phase 1 — Minimal Local End-to-End

**State:** ✅ Verified milestone — completed 2026-08-23

Verified MCP -> local bridge -> Unity main-thread -> structured result path, including status, hierarchy, first GameObject create, duplicate-retry protection, diagnostics, compiler source locations, and domain-reload reconnect/stale-generation protection.

### Exit gate

✅ Passed.

---

# Phase 2 — Reliability Core

**State:** ✅ Verified milestone — completed 2026-08-23 for the surface implemented at exit

Verified foundations include:

- ✅ stable `GlobalObjectId` resolver
- ✅ state epoch/revision + stale-state rejection
- ✅ current single-editor serialization + mutation re-entry guard
- ✅ main-thread mutation execution
- ✅ common mutation preflight
- ✅ Undo transaction grouping
- ✅ semantic native readback
- ✅ rollback + rollback verification
- ✅ same-session mutation lifecycle across domain reload
- ✅ capability/version preflight
- ✅ receive-time + execution-boundary deadlines
- ✅ explicit active-scene save
- ✅ dirty-state outcome reporting
- ✅ Phase 2 EditMode reliability suite: **19/19**

Known Phase 2 limits remain explicit: full Editor-restart transaction persistence is not implemented, Undo rollback may leave a clean scene dirty, and already-started Unity API calls are not force-interrupted.

See [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md).

---

# Phase 3 — Useful Unity Editing Core

**Goal:** perform normal Unity inspection/editing work without arbitrary code execution while carrying the Phase 2 reliability rules into each new write family.

**State:** 🟨 In progress — entered 2026-08-23

Verified slices:

- ✅ Transform read/update — `unity_get_transform` + `unity_set_transform`, **23/23** EditMode
- ✅ GameObject update/delete — `unity_update_game_object` + `unity_delete_game_object`, **29/29** EditMode
- ✅ Component inspect — `unity_get_components`, **33/33** EditMode
- ✅ Component add/remove — `unity_add_component` + `unity_remove_component`, **39/39** EditMode
- ✅ Component property edit — `unity_set_component_property`, **45/45** EditMode
- ✅ Asset search/inspect — `unity_search_assets` + `unity_inspect_asset`, **50/50** EditMode
- ✅ Prefab inspect + linked scene instantiate — `unity_inspect_prefab` + `unity_instantiate_prefab`, **56/56** EditMode
- ✅ Prefab Asset creation — `unity_create_prefab_asset`, create-only disk write with native GUID/hash/root verification and stale replay after manual removal, **62/62** EditMode
- 🟨 Bounded Prefab Apply Overrides workflow — next Prefab slice
- ⬜ Script read/write workflows
- ⬜ Diagnostics extensions where they unlock concrete workflows
- ⬜ Play Mode control
- ⬜ Unity Test Runner control
- ⬜ Explicit Undo/recovery tools where useful to clients

Supporting work:

- ✅ capability/version reporting foundation
- ✅ bounded structured Component inspection
- ✅ bounded AssetDatabase search/inspection
- ✅ Prefab asset-side precondition using Unity dependencyHash
- ✅ create-only Prefab disk-write contract that never overwrites an existing destination
- 🟨 consistent risk classification as new operations are added
- ⬜ broader tool-schema compatibility tests as the surface grows
- ⬜ better structured error explanations for AI clients
- 🟨 development-install Test Runner discovery bootstrap for package tests; implementation exists and requires fresh Unity runtime verification before being marked Verified

Reliability requirements inherited from Phase 2:

- stable target resolution,
- scene- or domain-appropriate concurrency preconditions,
- explicit risk classification,
- main-thread execution,
- Undo grouping where applicable,
- native readback/semantic verification,
- rollback + rollback verification where applicable,
- mutation identity/replay semantics,
- execution-boundary deadline enforcement,
- explicit dirty/save behavior,
- automated + real Unity verification before write families become Verified.

### Exit gate

A small Unity project can be meaningfully inspected and edited from an MCP client without arbitrary code execution, and the useful editing operations retain the reliability guarantees required for their domains.

---

# Phase 4 — Remote MCP / Easy Connect

**State:** ⬜ Planned

Goal: remove local networking/MCP setup from the normal cloud-AI user experience while preserving a self-host path.

Target experience:

```text
Install Unity package
 -> Connect AI
 -> pairing code
 -> approve/bind
 -> connected
```

Targets include:

- remote Streamable HTTP MCP endpoint,
- secure outbound Unity connection,
- short-lived pairing,
- scoped credentials,
- account/workspace/editor routing,
- multi-editor isolation,
- rate limits and abuse controls,
- disconnect/presence state,
- self-hosted deployment path.

### Exit gate

Two different users with multiple Unity Editors can connect concurrently and automated isolation tests prove commands cannot cross account/editor boundaries.

---

# Phase 5 — Portable Integration Beta

**State:** ⬜ Planned

Goal: package the proven MCP core so multiple AI ecosystems can consume the same Unity implementation with as little vendor-specific duplication as practical.

Targets:

- verify current MCP/client requirements at implementation time,
- harden tool descriptions, schemas, structured results, and compatibility behavior,
- evaluate and, if still appropriate, package the integration using **Agent Plugins 1.0** or a successor portable standard,
- add reusable Agent Skills only where they improve workflows without hiding core tool semantics,
- keep vendor-specific adapters/metadata thin,
- use ChatGPT as an important first production-host validation target,
- authentication/pairing UX for the chosen first host,
- destructive-action policy behavior,
- real end-to-end integration tests,
- beginner installation docs,
- private beta/public submission work where eligible.

Agent Plugins is a distribution/packaging candidate, not a replacement for MCP and not a required dependency of the Unity execution core.

### Exit gate

A new user can install the Unity side and use at least one production AI host through the shared MCP core without manually rebuilding vendor-specific Unity logic, and the packaging approach is documented well enough to reuse for additional hosts.

---

# Phase 6 — Multi-Client Compatibility

**State:** ⬜ Planned

Goal: prove the public core is genuinely provider-neutral rather than merely claiming it.

Potential compatibility targets include:

- ChatGPT,
- Claude,
- Codex,
- Gemini / Gemini CLI,
- Cursor,
- Copilot,
- other standards-compliant MCP hosts.

Work includes a compatibility matrix covering tool discovery, structured results, write safety/approval behavior where host-controlled, authentication/remote transport differences, and host-specific packaging only where required.

### Exit gate

Multiple independently implemented MCP hosts can perform the same representative Unity workflows against one shared public core, with any host-specific exceptions explicitly documented rather than hidden in duplicated Unity code.

---

# Phase 7 — Advanced Unity Domains

**State:** ⬜ Planned

Candidate domains, prioritized by demand and testability:

- Terrain
- NavMesh
- Animation/Animator
- UI and UI Toolkit
- Lighting
- Particles/VFX
- Shader Graph
- Profiler / memory / frame diagnostics
- Build tooling
- Package Manager
- Multiplayer Play Mode
- GameView/screenshot inspection

This list is not a promise that every domain will ship.

---

# Phase 8 — Extensibility and Ecosystem

**State:** ⬜ Planned

Possible work includes a safe custom-tool extension API, lazy capability discovery, third-party package adapters, versioned extension contracts, validation/security guidance, and templates. Arbitrary code execution is not considered a substitute for a real extension system.

---

# Not on the early roadmap

Intentionally deferred:

- 300+ tools for marketing purposes
- arbitrary shell/process control
- unrestricted arbitrary C# execution
- arbitrary third-party EditorWindow GUI automation
- Unity Hub account automation
- multi-agent orchestration
- TeamForge integration
- billing/monetization before the product works reliably

---

# Version direction

Likely semantic progression, not a release promise:

```text
0.0.x  foundation / protocol experiments
0.1.x  verified local core
0.2.x  reliability + useful editing
0.3.x  remote Easy Connect
0.4.x  portable/client integration beta
0.x    expansion and compatibility hardening
1.0    only after stable contracts, migration policy, security review,
       and repeatable real-world usage justify it
```

Do not bump versions merely to make the project appear mature.

---

# How roadmap items move

1. implementation exists,
2. relevant automated/manual verification is performed,
3. evidence is recorded in `STATUS.md` or linked test output,
4. documentation is updated,
5. known limitations are stated.

A roadmap checkbox alone is never proof that a feature works.
