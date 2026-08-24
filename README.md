# Unity AI Bridge

> **Status: pre-alpha / Phase 3 — Useful Unity Editing Core in progress**
>
> Phases 0, 1, and 2 are verified milestones. The current verified Unity surface includes status/hierarchy/diagnostics/object resolution, Transform editing, GameObject update/delete, Component inspection and bounded mutation, Asset search/inspection, Prefab inspection/instantiation, and create-only Prefab Asset authoring. See [`STATUS.md`](STATUS.md) for exact evidence and limitations.

Unity AI Bridge is intended to make AI-assisted Unity Editor control easy enough that users do not need to understand MCP, ports, networking, or Unity editor scripting just to get started.

Target beginner flow:

```text
Install Unity package
 -> click Connect AI
 -> pair
 -> use natural language to inspect and edit Unity
```

The control layer is deliberately **provider-neutral**. The same Unity-side implementation and MCP tool surface should be reusable by ChatGPT, Claude, Codex, Gemini, Cursor, Copilot, and other standards-compatible MCP hosts without reimplementing Unity control for each vendor.

## License

The public `unity-ai-bridge` repository is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE).

Apache-2.0 permits use, modification, distribution, and commercial use subject to its terms, including preservation of required notices. It also includes an explicit patent license and does not grant permission to use project trademarks beyond the license's limited terms.

This license applies to this public repository. The separate private `unity-ai-mcp-infra` repository is managed-service infrastructure and is not automatically licensed under this repository's Apache-2.0 license.

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
- [`LICENSE`](LICENSE) — Apache License 2.0 terms for this public repository
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
- **Provider-neutral:** Unity command logic must not depend on one LLM vendor.
- **MCP-native:** MCP is the canonical AI-client/tool boundary; vendor integrations stay thin.
- **Reliable before broad:** prefer a small set of dependable, composable tool families over hundreds of fragile tools.
- **Safe by default:** remote editor control, destructive actions, credentials, and arbitrary execution need explicit boundaries.
- **Recoverable:** use Unity Undo where practical and report dirty/unsaved state.
- **Reconnect-aware:** compilation/domain reload, editor restart, and network interruption are normal lifecycle events.
- **Retry-safe:** ambiguous retries must not silently repeat Unity mutations.
- **Verifiable:** transport success is not proof that the requested Unity state change happened.
- **Self-hostable target:** managed convenience should not require a permanently divergent private copy of the core.

## Accepted technical direction

```text
ChatGPT / Claude / Codex / Gemini / Cursor / other MCP host
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
- mutations: request identity/retry protection, optimistic state preconditions, Undo where practical, semantic readback, rollback/rollback verification where applicable, dirty-state reporting
- client integrations: reuse the common MCP core; vendor-specific adapters/metadata should remain thin
- portable packaging: Agent Plugins 1.0 is a candidate distribution layer to evaluate, not a replacement for MCP and not a core runtime dependency

## Current verified engineering surface

The latest verified Phase 3 slices include:

- Transform read/update
- GameObject update/delete
- Component inspection
- Component add/remove
- bounded Component serialized-property editing
- Asset search/inspection
- Prefab inspection and linked instantiation
- create-only Prefab Asset creation

The latest recorded Unity EditMode verification in `STATUS.md` is **62 passed / 0 failed** before later unverified changes. New write families must independently adopt and verify the Phase 2 reliability contract before being marked Verified.

## Package tests and Test Runner

The package contains EditMode tests under `unity-package/Tests/Editor`.

Unity normally requires non-embedded packages to be listed in the consuming project's `Packages/manifest.json` `testables` array before their package tests appear in Test Runner. Unity AI Bridge includes a development-install bootstrap that attempts to add itself automatically for Local, LocalTarball, and Git package sources. Embedded packages need no such entry. Registry installs are not automatically modified.

See [`unity-package/Tests/README.md`](unity-package/Tests/README.md) for the exact behavior and manual fallback.

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

## Near-term engineering direction

Phase 3 continues expanding a small, useful Unity editing surface while carrying forward the verified reliability contract. After that, Phase 4 focuses on the difficult product boundary that local MCP clients do not solve by themselves: securely connecting cloud AI hosts to a user's local Unity Editor through remote MCP, outbound Unity connectivity, pairing/authentication, and editor routing.

Portable/plugin packaging and multi-provider compatibility come after the core and remote path are trustworthy.

## Why not start with 300 tools?

The hard parts are not the tool count. They are safe Unity main-thread execution, object identity, retries, Undo, compilation/domain reload, reconnection, permission boundaries, semantic verification, rollback behavior, and multi-editor routing.

The project prefers stable domain tools/tool families over a giant surface whose behavior cannot be trusted.

Arbitrary C# execution is intentionally not an early default escape hatch.

## External projects

Other Unity MCP projects may be studied for requirements, UX, interoperability, feature coverage, and known failure modes. That does **not** mean their implementation is incorporated here.

Research references are tracked in [`REFERENCES.md`](REFERENCES.md). If copyrighted third-party code or other material is ever actually incorporated, its exact source revision and license obligations must be reviewed and recorded at that time.

## Core truth rule

> **Repository evidence beats memory, assumptions, chat history, and plans.**

`STATUS.md` is authoritative for implementation/verification. Design and roadmap documents may describe future behavior and are not proof that functionality exists.
