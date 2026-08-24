# Unity AI Bridge — Public Roadmap

> **Pre-alpha roadmap.** This is a direction document, not a release promise or proof of implementation.
>
> For actual implementation/verification status, see [`STATUS.md`](STATUS.md).

Unity AI Bridge aims to make safe AI control of the Unity Editor easy enough that a beginner can install a Unity package, connect an AI client, and start working without learning MCP configuration, networking, or editor scripting first.

## Roadmap principles

- Capability gates matter more than dates.
- A feature advances only with implementation plus relevant verification evidence.
- Reliability, Undo, reconnect behavior, object identity, persistent-write safety, and security are product features.
- The project will not chase a huge tool count before the core is trustworthy.
- MCP/provider neutrality is an architectural boundary, not a later compatibility patch.
- ChatGPT is an important first production host target, not the owner of the public core architecture.
- Portable packaging standards may reduce duplicated integration work, but they do not replace the canonical MCP/tool contract.
- Model compatibility should be capability/profile oriented rather than hardcoded by model name.

## Legend

- ⬜ Planned
- 🟨 In progress / implemented but not yet fully runtime-verified
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
- ✅ rollback + rollback verification where a write family can honestly provide it
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

- ✅ Transform read/update — `unity_get_transform` + `unity_set_transform`, **23/23** milestone
- ✅ GameObject update/delete — `unity_update_game_object` + `unity_delete_game_object`, **29/29** milestone
- ✅ Component inspect — `unity_get_components`, **33/33** milestone
- ✅ Component add/remove — `unity_add_component` + `unity_remove_component`, **39/39** milestone
- ✅ Component property edit — `unity_set_component_property`, **45/45** milestone
- ✅ Asset search/inspect — `unity_search_assets` + `unity_inspect_asset`, **50/50** milestone
- ✅ Prefab inspect + linked scene instantiate — `unity_inspect_prefab` + `unity_instantiate_prefab`, **56/56** milestone
- ✅ Prefab Asset creation — `unity_create_prefab_asset`, **62/62** milestone
- ✅ installed-package Test Runner discovery/bootstrap — first **75/75** real Unity baseline
- ✅ bounded single-property Prefab override apply — `unity_apply_prefab_property_override`; real Unity **80/80** plus dedicated live MCP E2E PASS
- ✅ direct `Undo.RecordObject` scene-Prefab override recording — Transform/GameObject direct writes; real Unity **81/81** through PR #43
- ✅ bounded Script read — `unity_read_script` / `script.read`; real Unity **85/85** plus live MCP reconstruction/identity/non-mutation PASS through PR #44
- ✅ reload-safe Script replace/write — `unity_replace_script` / `script.replace`; real Unity **89/89** plus live MCP CAS/write/compile/reload/replay/stale/restore PASS through PR #45
- ✅ reload-aware Play Mode control — `unity_set_play_mode` / `editor.playMode.set`; real Unity **93/93** plus live MCP edit/play/replay/stale/final-restore PASS through PR #46
- ⬜ Unity Test Runner control
- ⬜ diagnostics extensions where they unlock concrete workflows
- ⬜ explicit Undo/recovery tools where useful to clients

### Verified Play Mode strategy

Play Mode is an Editor lifecycle boundary, not a synchronous Boolean mutation. The first slice therefore exposes stable preconditions/targets while observing transient native states and optional reload/reconnect behavior.

Verified lifecycle:

```text
editor.status observation
 -> stable expected mode: edit | play
 -> target mode: edit | play
 -> record mutationId journal before transition
 -> request Unity EnterPlaymode / ExitPlaymode
 -> observe edit / entering_play / play / exiting_play
 -> tolerate optional domain reload / bridge reconnect
 -> same-editor reconciliation
 -> wait for stable target mode
 -> same-id retry remains readback-only
 -> stale expected mode fails closed
```

Verified first-slice properties:

- `editor.status` reports four-state lifecycle, pause state, and effective Enter Play Mode reload flags,
- user Enter Play Mode settings are observed but never changed,
- reload/connection-generation change is reported but is not mandatory for success,
- same-id retries do not blindly request a second transition,
- no automatic scene save and no Unity Undo claim,
- explicit 180-second bounded lifecycle timeout for slow/project-heavy cases,
- live verifier proves edit -> play -> edit, replay, stale-precondition rejection, settings preservation, and exact final stable Edit Mode.

### Verified Script strategy

Script authoring crosses a different reliability boundary from scene mutations: changing a `.cs` file can cause AssetDatabase import, script compilation, assembly reload, and domain reload. The project therefore separates observation from mutation and uses raw-file identity/content preconditions for writes.

Verified observation slice:

```text
exact Assets/*.cs or Packages/*.cs Unity asset
 -> canonical GUID/path + MonoScript validation
 -> bounded strict UTF-8 read
 -> raw-file SHA-256
 -> dependencyHash + source metadata
 -> deterministic offset paging
 -> exact multi-chunk reconstruction
```

`script.read` is read-only and limits a source file to 4 MiB and each returned chunk to 100,000 UTF-16 code units. It reports BOM/encoding, byte/character/line counts, `nextOffset`, truncation metadata, and raw `contentSha256`. Package source resolution uses Unity Package Manager metadata rather than guessing package-cache paths.

Verified first write slice:

```text
script.read observation
 -> exact writable Assets/*.cs path
 -> expected GUID + raw contentSha256 CAS
 -> validate replacement content/encoding/bounds/editability
 -> record mutationId journal before persistence
 -> compare current bytes to expected state
 -> atomic replacement + exact new SHA verification
 -> AssetDatabase import / compilation observation
 -> survive domain reload/reconnect
 -> same-id reconciliation without a blind second write
 -> post-reload script.read verification
 -> report persistence and compiler outcome separately
```

Verified first-slice properties:

- exact existing `Assets/*.cs` target only; Packages remain read-only,
- current GUID + raw `contentSha256` are mandatory CAS state,
- stale content fails before write,
- replacement content is bounded and encoding/BOM behavior is explicit,
- mutationId replay never blindly rewrites an already-started mutation,
- file persistence and compile success are separate outcomes,
- compilation errors are reportable rather than misclassified as persistence failure,
- no claim of Unity Undo for source-file writes,
- recovery is guarded by recognized exact SHA states and refuses unknown concurrent third-state content,
- reconnect/domain reload is part of the normal success path,
- verifier/client timeouts must leave enough headroom for slower machines and larger projects; short fixed external timeouts can false-fail legitimate compile/reload work.

### Prefab strategy

The verified first apply slice remains intentionally narrow: one exact visible non-array serialized-property override, an explicit writable Prefab Asset target, dependencyHash + scene-state preconditions, native source/instance readback, conservative replay semantics, and no generic Undo claim for the persistent asset write.

Broader Prefab operations remain separate future contracts:

- object/component-wide apply,
- Apply All,
- Revert Overrides,
- added/removed object/component apply/revert,
- Prefab variants,
- unpacking.

Supporting work:

- ✅ capability/version reporting foundation
- ✅ bounded structured Component inspection
- ✅ bounded AssetDatabase search/inspection
- ✅ Prefab asset-side precondition using Unity dependencyHash
- ✅ create-only Prefab disk-write contract
- ✅ installed-package Test Runner discovery bootstrap
- ✅ bounded existing-Prefab property-write contract + live MCP verifier
- ✅ direct scene-Prefab write override recording audit/fix (#41 / PR #43)
- ✅ bounded Script read + raw SHA-256 observation token (PR #44, **85/85 + live MCP PASS**)
- ✅ reload-safe Script replace/CAS contract (PR #45, **89/89 + live MCP PASS**)
- ✅ reload-aware Play Mode lifecycle control (PR #46, **93/93 + live MCP PASS**)
- 🟨 consistent risk classification as new operations are added
- ⬜ broader tool-schema compatibility tests as the surface grows
- ⬜ better structured error explanations for AI clients

Reliability requirements inherited from Phase 2:

- stable target resolution,
- domain-appropriate concurrency preconditions,
- explicit risk classification,
- main-thread execution where Unity APIs require it,
- Undo grouping where applicable,
- native readback/semantic verification,
- rollback + rollback verification where the operation can safely support it,
- conservative ambiguous-outcome handling where persistent writes cannot safely be generically rolled back,
- mutation identity/replay semantics,
- execution-boundary deadline enforcement,
- explicit dirty/save/compile behavior,
- automated + real Unity verification before write families become Verified.

### Immediate next gate

**Unity Test Runner control** is the next bounded Phase 3 workflow. It should support a deliberate run request, bounded selection/filtering, asynchronous progress/completion, exact result counts/details, lifecycle/reload-safe observation, and conservative retry semantics before it is marked Verified.

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

Targets include remote Streamable HTTP MCP, secure outbound Unity connectivity, short-lived pairing, scoped credentials, account/workspace/editor routing, multi-editor isolation, rate limits/abuse controls, disconnect/presence state, and a self-hosted deployment path.

### Exit gate

Two different users with multiple Unity Editors can connect concurrently and automated isolation tests prove commands cannot cross account/editor boundaries.

---

# Phase 5 — Portable Integration Beta

**State:** ⬜ Planned

Goal: package the proven MCP core so multiple AI ecosystems can consume the same Unity implementation with as little vendor-specific duplication as practical.

Targets include current MCP/client verification, hardened tool schemas/results, optional portable Agent Plugins/skills packaging where still appropriate, thin vendor-specific adapters, ChatGPT as an important first production-host target, authentication/pairing UX, destructive-action policy behavior, real end-to-end integration tests, beginner docs, and eligible beta/submission work.

Portable packaging is a distribution concern, not a replacement for MCP or the Unity execution core.

### Exit gate

A new user can install the Unity side and use at least one production AI host through the shared MCP core without manually rebuilding vendor-specific Unity logic.

---

# Phase 6 — Multi-Client and Local-Agent Compatibility

**State:** ⬜ Planned

Goal: prove the public core is genuinely provider/model-neutral rather than merely claiming it.

Potential compatibility targets include ChatGPT, Claude, Codex, Gemini / Gemini CLI, Cursor, Copilot, MCP-capable local/open-weight agent runtimes, and other standards-compliant MCP hosts.

Open-weight models are not integrated as raw inference endpoints. The compatibility target is a real agent/runtime/harness that can perform MCP discovery/invocation, structured-result handling, retries, approval policy, and multi-step workflows. See [`docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md`](docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md).

A later Adaptive Router may expose Workflow/Semantic/Primitive abstraction levels based on explicit capability/profile evidence. It must not hardcode model names into Unity execution semantics.
