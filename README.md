# Unity AI Bridge

> **Status: pre-alpha / Phase 3 — Useful Unity Editing Core in progress**
>
> Phases 0, 1, and 2 are verified milestones. The current verified Unity surface includes status/hierarchy/diagnostics/object resolution, Transform editing, GameObject update/delete, Component inspection and bounded mutation, Asset search/inspection, Prefab inspection/instantiation, create-only Prefab Asset authoring, bounded single-property Prefab override apply, direct scene-Prefab override recording, installed-package Test Runner discovery, bounded Script read, reload-safe CAS Script replace, reload-aware Play Mode control, and bounded asynchronous EditMode Test Runner control. The latest real Unity baseline is **98 passed / 0 failed** on Unity 6000.3.21f1, plus dedicated live MCP verification for Prefab property apply, Script read, Script replace, Play Mode control, and EditMode Test Runner control. See [`STATUS.md`](STATUS.md) for exact evidence and limitations.

Unity AI Bridge is intended to make AI-assisted Unity Editor control easy enough that users do not need to understand MCP, ports, networking, or Unity editor scripting just to get started.

Target beginner flow:

```text
Install Unity package
 -> click Connect AI
 -> pair
 -> use natural language to inspect and edit Unity
```

The control layer is deliberately **provider-neutral**. The same Unity-side implementation and MCP tool surface should be reusable by ChatGPT, Claude, Codex, Gemini, Cursor, Copilot, open-weight/local agents with an MCP-capable runtime, and other standards-compatible MCP hosts without reimplementing Unity control for each vendor or model family.

## License

The public `unity-ai-bridge` repository is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE).

This public core may be used, modified, distributed, and commercially used under Apache-2.0 terms. The separate private `unity-ai-mcp-infra` repository is managed-service infrastructure and is not automatically licensed under this repository's license.

The long-term product direction remains a public/self-hostable core plus an optional managed hosted service.

## Where to start

- [`STATUS.md`](STATUS.md) — what actually exists and what has been verified
- [`CODEMAP.md`](CODEMAP.md) — current repository structure and ownership
- [`DESIGN.md`](DESIGN.md) — detailed intended system behavior
- [`DECISIONS.md`](DECISIONS.md) — why major architecture choices were made
- [`ROADMAP.md`](ROADMAP.md) — public milestone/phase plan
- [`AGENTS.md`](AGENTS.md) — mandatory AI/contributor rules
- [`REFERENCES.md`](REFERENCES.md) — external research references; not incorporated code
- [`CHANGELOG.md`](CHANGELOG.md) — notable project changes
- [`docs/TESTING.md`](docs/TESTING.md) — repeatable verification gates
- [`docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md`](docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md) — deferred compatibility direction for local/open-weight agents
- [`LICENSE`](LICENSE) — Apache License 2.0 terms
- [`llms.txt`](llms.txt) — compact AI-agent entrypoint

[`ARCHITECTURE.md`](ARCHITECTURE.md) is the concise high-level architecture summary. `DESIGN.md` is the detailed design authority.

## Current source layout

```text
unity-package/      Unity Editor UPM package, reliability layer, commands, EditMode tests
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

Current direction:

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
- asynchronous Editor jobs such as tests: explicit selection, immediate run identity, current-session journal, bounded polling/results, and same-id no-duplicate scheduling
- client integrations: reuse the common MCP core; vendor-specific adapters/metadata should remain thin
- portable packaging: Agent Plugins 1.0 is a candidate distribution layer to evaluate, not a replacement for MCP and not a core runtime dependency
- open-weight/local models: later compatibility target through MCP-capable agent runtimes; the Unity core will not become an inference server/model manager

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

The latest real Unity EditMode verification is **98 passed / 0 failed** on Unity 6000.3.21f1. Script read additionally passed a live official-MCP-client reconstruction/identity/non-mutation gate. Script replace passed a live official-MCP-client CAS/write/compile/domain-reload/reconnect/replay/stale/restore gate and restored the exact original source SHA after verification. Play Mode control passed a live official-MCP-client `edit -> play -> edit` lifecycle gate with same-id replay, stale-precondition rejection, user Enter Play Mode setting preservation, and exact final stable Edit Mode restoration. EditMode Test Runner control passed a live official-MCP-client schedule/poll/completion/replay/conflict gate for one exact filtered test, with stable Unity `runGuid` and exact terminal count readback.

New write/lifecycle/job families must independently adopt and verify the relevant reliability contract before being marked Verified.

## Package tests and Test Runner

The package contains EditMode tests under `unity-package/Tests/Editor`.

Unity normally requires non-embedded packages to be listed in the consuming project's `Packages/manifest.json` `testables` array before their package tests appear in Test Runner. Unity AI Bridge includes a development-install bootstrap that adds itself automatically for Local, LocalTarball, and Git package sources. Embedded packages need no such entry. Registry installs are not automatically modified. When Test Framework does not immediately discover the newly testable package, the bootstrap performs one guarded package reimport.

This installed-package flow was reproduced on Unity 6000.3.21f1 on 2026-08-24. Historical package-suite milestones are 75/75, 80/80, 81/81, 85/85, 89/89, 93/93, 97/97 during the first Test Runner-control candidate, and the current **98/98** verified baseline after the terminal selected-count regression fix.

See [`unity-package/Tests/README.md`](unity-package/Tests/README.md) and [`docs/TESTING.md`](docs/TESTING.md).

## Near-term engineering direction

The bounded Script read/replace pair, reload-aware Play Mode control, and bounded asynchronous EditMode Test Runner control are now verified. Near-term Phase 3 work should strengthen the **test-fix-debug loop** with diagnostics/recovery extensions where they unlock concrete workflows, followed by separately bounded PlayMode Test Runner execution or explicit recovery controls as evidence justifies them.

The verified Script write path intentionally does not expose blind overwrite:

```text
read current Assets/*.cs
 -> expected GUID + contentSha256
 -> compare-and-swap precondition
 -> bounded complete-source replacement
 -> atomic persistent byte verification
 -> Unity import / compile / possible domain reload
 -> reconnect + same-id mutation reconciliation
 -> new SHA + compile diagnostics outcome
```

Package scripts remain read-only in the first write slice. Source-file writes are not Unity Undo, and compile failure is not the same thing as persistence failure, so recovery and result semantics remain explicit. Reload-bound operations also require enough client timeout headroom for slower machines and larger projects; timeout/disconnect ambiguity is reconciled with the same mutationId rather than retried as a fresh write.

Play Mode control similarly treats reload/reconnect as an observed lifecycle detail rather than proof of success. The terminal native `edit`/`play` state is authoritative, and the user's Enter Play Mode settings are not modified.

Test Runner control similarly avoids long synchronous MCP requests. `unity_start_editmode_tests` returns a bounded asynchronous run handle, while `unity_get_test_run` reads the current/terminal result journal. The first slice is EditMode-only and intentionally keeps selection explicit and small.

After the useful local core is strong enough, Phase 4 focuses on securely connecting cloud AI hosts to a user's local Unity Editor through remote MCP, outbound Unity connectivity, pairing/authentication, and editor routing.

Portable/plugin packaging and multi-provider/model compatibility come after the core and remote path are trustworthy.

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

The private repository should compose/deploy the public core instead of becoming a second private implementation of the same Unity/MCP logic.

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