# Unity AI Bridge

> **Status: active development paused (soft freeze) — 2026-09-18**
>
> New feature development is paused while Unity's official Unity CLI, Pipeline, MCP, and Codex tooling matures. This repository is intentionally **not archived**: the existing implementation, tests, and verification evidence are being preserved for reference and possible reuse.
>
> Development should resume only if testing of the official Unity tooling exposes a concrete gap that this project can address without simply duplicating an official capability, or if the project is deliberately repurposed around a clearly distinct problem. Planned roadmap items below are historical/planned context, not active commitments while the pause is in effect.
>
> Phases 0, 1, and 2 are verified milestones. Phase 3 reached a verified reliability/recovery surface including mutation lifecycle observation, response-loss reconciliation, bounded action history and safe Undo, GameObject checkpoint/restore, and bounded multi-step task journal/resume. See [`STATUS.md`](STATUS.md) for exact evidence and limitations.

Unity AI Bridge was created to make AI-assisted Unity Editor control easy enough that users would not need to understand MCP, ports, networking, or Unity editor scripting just to get started.

Historical target beginner flow:

```text
Install Unity package
 -> click Connect AI
 -> pair
 -> use natural language to inspect and edit Unity
```

The control layer was designed to be **provider-neutral**. The same Unity-side implementation and MCP tool surface could be reused by ChatGPT, Claude, Codex, Gemini, Cursor, Copilot, open-weight/local agents with an MCP-capable runtime, and other standards-compatible MCP hosts without reimplementing Unity control for each vendor or model family.

## License

The public `unity-ai-bridge` repository is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE).

This public core may be used, modified, distributed, and commercially used under Apache-2.0 terms. The separate private `unity-ai-mcp-infra` repository is managed-service infrastructure and is not automatically licensed under this repository's license.

The previously planned long-term product direction was a public/self-hostable core plus an optional managed hosted service. That direction is **not active development** while the project is paused.

## Where to start

- [`STATUS.md`](STATUS.md) — what actually exists, what has been verified, and the current paused state
- [`CODEMAP.md`](CODEMAP.md) — current repository structure and ownership
- [`DESIGN.md`](DESIGN.md) — detailed intended system behavior
- [`DECISIONS.md`](DECISIONS.md) — why major architecture choices were made
- [`ROADMAP.md`](ROADMAP.md) — public milestone/phase plan; currently not an active commitment
- [`AGENTS.md`](AGENTS.md) — mandatory AI/contributor rules
- [`REFERENCES.md`](REFERENCES.md) — external research references; not incorporated code
- [`CHANGELOG.md`](CHANGELOG.md) — notable project changes
- [`docs/TESTING.md`](docs/TESTING.md) — repeatable verification gates
- [`docs/TEST_DISCOVERY_TESTING.md`](docs/TEST_DISCOVERY_TESTING.md) — verified real-Unity Test Framework discovery gate
- [`docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md`](docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md) — deferred compatibility direction for local/open-weight agents
- [`LICENSE`](LICENSE) — Apache License 2.0 terms
- [`llms.txt`](llms.txt) — compact AI-agent entrypoint

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the concise high-level architecture summary. `DESIGN.md` is the detailed design authority.

## Current source layout

```text
unity-package/      Unity Editor UPM package, reliability layer, commands, EditMode/PlayMode tests
bridge-protocol/    versioned Unity-facing command/result schemas + fixtures
mcp-server/         TypeScript MCP v2 server, tool schemas, bridge routing, tests/verifiers
```

Current initial pins:

- Unity: **6000.3.21f1** initial verified development target
- Node.js: **24.19.0 LTS**
- `@modelcontextprotocol/server`: **2.0.0**
- TypeScript: **7.0.2**
- `@types/node`: **24.13.3**
- Unity bridge protocol: **v0**

The exact implementation/verification state moves faster than this overview; `STATUS.md` is authoritative.

## Design goals

The following are the project's existing design goals and remain useful historical context while active development is paused:

- **Beginner-friendly:** eventually package install -> Connect AI -> pairing, with no manual MCP configuration for the default hosted path.
- **Provider-neutral:** Unity command logic must not depend on one LLM vendor or model family.
- **MCP-native:** MCP is the canonical AI-client/tool boundary; vendor/model integrations stay thin.
- **Reliable before broad:** prefer a small set of dependable, composable tool families over hundreds of fragile tools.
- **Safe by default:** remote editor control, destructive actions, credentials, and arbitrary execution need explicit boundaries.
- **Recoverable:** use Unity Undo where practical and report dirty/unsaved state; persistent asset/file writes that cannot honestly promise Undo are classified separately.
- **Reconnect-aware:** compilation/domain reload, editor restart, and network interruption are normal lifecycle events.
- **Retry-safe:** ambiguous retries must not silently repeat Unity mutations.
- **Verifiable:** transport success is not proof that the requested Unity state change happened.
- **Self-hostable target:** managed convenience should not require a permanently divergent private copy of the core.
- **Capability-oriented compatibility:** future adaptive tool abstraction should key off host/model capabilities rather than hardcoded model names.

## Accepted technical direction

```text
ChatGPT / Claude / Codex / Gemini / Cursor / local MCP agent / other MCP host
                              |
                              | MCP
                              v
                   Public MCP/server core
                              |
                      bridge protocol
                              |
                    WebSocket first
                              v
                     Unity C# Agent
                              |
                    main-thread queue
                              v
                     Unity Editor APIs
```

Current recorded direction:

- Unity side: C# Unity Editor package
- MCP/server side: TypeScript
- MCP SDK: official MCP TypeScript SDK v2 line
- local MCP transport: stdio
- remote MCP transport target: Streamable HTTP
- Unity bridge: transport-independent protocol, WebSocket first
- conflicting writes: serialized by default
- target identity: not dependent on Unity `InstanceID` alone
- scene mutations: request identity/retry protection, optimistic state preconditions, Undo where practical, semantic readback, rollback/rollback verification where applicable
- persistent asset/file writes: explicit preconditions/readback and conservative retry/recovery behavior when generic Unity Undo cannot be promised
- Editor lifecycle mutations: stable native preconditions/targets, mutation identity, bounded waits, optional reload/reconnect observation, and same-id reconciliation rather than blind repeat requests
- asynchronous Editor jobs such as tests: explicit mode/selection, immediate run identity, current-session journal, bounded polling/results, lifecycle/reconnect tolerance where needed, and same-id no-duplicate scheduling
- Test Framework discovery: native discovered assembly/leaf selectors are preferred over source-text inference and are returned through bounded read-only paging
- client integrations: reuse the common MCP core; vendor-specific adapters/metadata should remain thin
- portable packaging: Agent Plugins 1.0 was a candidate distribution layer to evaluate, not a replacement for MCP and not a core runtime dependency
- open-weight/local models: later compatibility target through MCP-capable agent runtimes; the Unity core will not become an inference server/model manager

These directions are preserved as design history. They should not be treated as justification for new implementation work during the pause without first re-evaluating current official Unity capabilities.

## Current verified engineering surface

Verified Phase 3 slices include:

- Transform read/update
- GameObject update/delete
- Component inspection
- Component add/remove
- bounded Component serialized-property editing
- Asset search/inspection
- Prefab inspection and linked instantiation
- create-only Prefab Asset creation
- bounded single-property Prefab override apply
- direct Prefab-instance override recording for direct Transform/GameObject writes
- installed-package Test Runner discovery/bootstrap
- bounded Script read with exact GUID/path, strict UTF-8, raw SHA-256, dependencyHash, and deterministic paging
- reload-safe Script replace with path/GUID/SHA CAS, atomic persistence, compile/reload reconciliation, same-id replay protection, stale-content rejection, post-reload readback, and guarded recovery
- reload-aware Play Mode control with four-state lifecycle observation, stable-mode preconditions, same-id reconciliation, optional reload tracking, stale-mode rejection, and user setting preservation
- bounded asynchronous EditMode Test Runner control with exact assembly/test selection, Unity run GUIDs, SessionState result journals, compact failure details, same-id replay, and conflict rejection
- bounded asynchronous PlayMode Test Runner control with exact runtime-capable assembly/test selection, Test Framework-owned Edit -> Play -> Edit lifecycle, reconnect-safe same-mutation reconciliation, stable run GUID replay, and final Edit Mode/settings preservation
- bounded native Test Framework discovery with exact EditMode/PlayMode assembly names, exact leaf `fullName` selectors, deterministic paging, substring filtering, unknown-assembly rejection, and read-only state preservation
- bounded common mutation lifecycle status and safe response-loss reconciliation for the reviewed common mutation set
- current-session bridge action history with safe latest-action Undo
- bounded GameObject checkpoint capture/get/restore
- bounded multi-step task journal/resume with explicit state boundaries

The latest expanded real Unity EditMode verification is **135 passed / 0 failed** on Unity 6000.3.21f1. See `STATUS.md` for the exact latest evidence and historical milestone details.

New work is paused; no new write/lifecycle/job/read family should be started merely to expand coverage while the soft freeze remains in effect.

## Package tests and Test Runner

The package contains EditMode tests under `unity-package/Tests/Editor` and a dedicated bounded PlayMode verifier assembly under `unity-package/Tests/PlayMode`.

Unity normally requires non-embedded packages to be listed in the consuming project's `Packages/manifest.json` `testables` array before their package tests appear in Test Runner. Unity AI Bridge includes a development-install bootstrap that adds itself automatically for Local, LocalTarball, and Git package sources. Embedded packages need no such entry. Registry installs are not automatically modified. When Test Framework does not immediately discover the newly testable package, the bootstrap performs one guarded package reimport.

This installed-package flow was reproduced on Unity 6000.3.21f1 on 2026-08-24. Historical EditMode package-suite milestones are 75/75, 80/80, 81/81, 85/85, 89/89, 93/93, 97/97 during the first Test Runner-control candidate, 98/98 after the terminal selected-count regression fix, 100/100 after PlayMode Test Runner contract coverage, 105/105 after bounded Test Framework discovery coverage, and the later expanded reliability suite reached **135/135**. The dedicated PlayMode verifier assembly was independently verified **1/1** during its slice.

The names are intentionally distinct:

- **installed-package Test Runner discovery/bootstrap** means making package tests visible through `manifest.json` `testables` + guarded reimport,
- **Test Framework discovery** means `unity_list_tests` reading the native Test Framework tree to return exact runnable assembly/test selectors.

See [`unity-package/Tests/README.md`](unity-package/Tests/README.md), [`docs/TESTING.md`](docs/TESTING.md), [`docs/PLAYMODE_TEST_RUNNER_TESTING.md`](docs/PLAYMODE_TEST_RUNNER_TESTING.md), and [`docs/TEST_DISCOVERY_TESTING.md`](docs/TEST_DISCOVERY_TESTING.md).

## Near-term engineering direction

**Paused.** No near-term feature slice is currently active.

Before any substantial development resumes, current official Unity CLI/Pipeline/MCP/Codex capabilities should be re-evaluated against the concrete gap being proposed. Work should resume only when there is evidence that the project can solve a distinct problem rather than recreate a capability now maintained by Unity.

The previously verified bounded Script read/replace pair, reload-aware Play Mode control, bounded asynchronous EditMode + PlayMode Test Runner control, native Test Framework discovery, response-loss reconciliation, safe Undo, checkpoint/restore, and task journal/resume are preserved as engineering evidence and reusable implementation work.

## Repository split

```text
unity-ai-bridge        (PUBLIC, Apache-2.0)
  reusable Unity package, MCP/server core, bridge protocol,
  local/self-host path, reusable routing abstractions, tests/docs,
  publishable provider integration metadata/adapters

unity-ai-mcp-infra     (PRIVATE)
  managed-service deployment, production auth/database wiring,
  rate limits/abuse controls, monitoring and private operations
```

This split is preserved as historical architecture. No new managed-service work is implied while active development is paused.

## Why not start with 300 tools?

The hard parts are not the tool count. They are safe Unity main-thread execution, object identity, retries, Undo, persistent asset/file writes, compilation/domain reload, Editor lifecycle transitions, long-running Editor jobs, reconnection, permission boundaries, semantic verification, rollback/recovery behavior, and multi-editor routing.

The project prefers stable domain tools/tool families over a giant surface whose behavior cannot be trusted.

Arbitrary C# execution is intentionally not an early default escape hatch.

## External projects

Other Unity MCP projects may be studied for requirements, UX, interoperability, feature coverage, and known failure modes. That does **not** mean their implementation is incorporated here.

Research references are tracked in [`REFERENCES.md`](REFERENCES.md). If copyrighted third-party code or other material is ever actually incorporated, its exact source revision and license obligations must be reviewed and recorded at that time.

## Core truth rule

> **Repository evidence beats memory, assumptions, chat history, and plans.**

`STATUS.md` is authoritative for implementation/verification. Design and roadmap documents may describe future behavior and are not proof that functionality exists.