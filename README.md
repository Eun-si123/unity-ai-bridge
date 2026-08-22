# Unity AI Bridge

> **Status: pre-alpha / Phase 0 foundation scaffold**
>
> The repository now contains an initial Unity package scaffold, bridge protocol v0 schemas/types, and a minimal TypeScript MCP server bootstrap. These pieces are **implemented but not yet runtime-verified**. No working MCP-to-Unity connection, Unity tool surface, remote gateway, or ChatGPT integration should be assumed unless [`STATUS.md`](STATUS.md) says so.

Unity AI Bridge is intended to make AI-assisted Unity Editor control easy enough that users do not need to understand MCP, ports, networking, or Unity editor scripting just to get started.

Target beginner flow:

```text
Install Unity package
 -> click Connect AI
 -> pair
 -> use natural language to inspect and edit Unity
```

The control layer is intended to remain provider-neutral so the same Unity-side implementation can work with multiple MCP-capable AI clients.

## License

The public `unity-ai-bridge` repository is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE).

Apache-2.0 permits use, modification, distribution, and commercial use subject to its terms, including preservation of required notices. It also includes an explicit patent license and does not grant permission to use project trademarks beyond the license's limited terms.

This license applies to this public repository. The separate private `unity-ai-mcp-infra` repository is managed-service infrastructure and is not automatically licensed under this repository's Apache-2.0 license.

The long-term product direction remains a public/self-hostable core plus an optional managed hosted service.

## Where to start

- [`STATUS.md`](STATUS.md) — what actually exists and what has been verified
- [`CODEMAP.md`](CODEMAP.md) — current and planned repository structure
- [`DESIGN.md`](DESIGN.md) — detailed intended system behavior
- [`DECISIONS.md`](DECISIONS.md) — why major architecture choices were made
- [`ROADMAP.md`](ROADMAP.md) — public milestone/phase plan
- [`AGENTS.md`](AGENTS.md) — mandatory AI/contributor rules
- [`REFERENCES.md`](REFERENCES.md) — external research references; not incorporated code
- [`CHANGELOG.md`](CHANGELOG.md) — notable project changes
- [`LICENSE`](LICENSE) — Apache License 2.0 terms for this public repository
- [`llms.txt`](llms.txt) — compact AI-agent entrypoint

[`ARCHITECTURE.md`](ARCHITECTURE.md) is a shorter high-level architecture summary. `DESIGN.md` is the detailed design authority.

## Current source scaffold

```text
unity-package/      Unity Editor UPM package scaffold
bridge-protocol/    versioned Unity-facing command/result schemas + fixtures
mcp-server/         TypeScript MCP v2 stdio bootstrap + bridge types/tests
```

Current initial pins:

- Unity: **6000.3.21f1** initial development target
- Node.js: **24.19.0 LTS**
- `@modelcontextprotocol/server`: **2.0.0**
- TypeScript: **7.0.2**
- `@types/node`: **24.13.3**
- Unity bridge protocol: **v0**

The direct dependency versions and generated lockfile are committed. Node dependency install, TypeScript build, and protocol smoke tests have passed in GitHub Actions; see `STATUS.md` for exact evidence and remaining Unity verification gaps.

## Design goals

- **Beginner-friendly:** eventually package install -> Connect AI -> pairing, with no manual MCP configuration for the default hosted path.
- **Provider-neutral:** Unity command logic should not depend on one LLM vendor.
- **Reliable before broad:** prefer a small set of dependable, composable tool families over hundreds of fragile tools.
- **Safe by default:** remote editor control, destructive actions, credentials, and arbitrary execution need explicit boundaries.
- **Recoverable:** use Unity Undo where practical and report dirty/unsaved state.
- **Reconnect-aware:** compilation/domain reload, editor restart, and network interruption are normal lifecycle events.
- **Retry-safe:** ambiguous retries must not silently repeat Unity mutations.
- **Verifiable:** transport success is not proof that the requested Unity state change happened.
- **Self-hostable target:** managed convenience should not require a permanently divergent private copy of the core.

## Accepted technical direction

```text
ChatGPT / Claude / Codex / Gemini / other MCP client
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
- remote MCP transport: Streamable HTTP
- Unity bridge: transport-independent protocol, WebSocket first
- conflicting writes: serialized by default
- target identity: not dependent on Unity `InstanceID` alone
- mutations: request identity/retry protection, Undo where practical, dirty-state reporting

Only the initial package/protocol/server scaffold exists on `main` today. WebSocket bridging, command dispatch, Unity API handlers, and public tools are later-phase work unless `STATUS.md` records otherwise.

## Repository split

```text
unity-ai-bridge        (PUBLIC, Apache-2.0)
  reusable Unity package, MCP/server core, bridge protocol,
  local/self-host path, reusable routing abstractions, tests/docs

unity-ai-mcp-infra     (PRIVATE)
  managed-service deployment, production auth/database wiring,
  rate limits/abuse controls, monitoring and private operations
```

The private repository should compose/deploy the public core instead of becoming a second private implementation of the same Unity/MCP logic.

## First engineering milestone

The first runtime milestone is intentionally narrow:

1. Connect one Unity Editor locally.
2. Expose a minimal MCP endpoint.
3. Read editor/status information.
4. Read active scene/hierarchy.
5. Create a simple GameObject.
6. Read Console/compiler errors.
7. Return structured results/errors.
8. Re-read Unity state to verify the requested effect.

Only after this path is reliable should the project expand into components, scripts, assets, prefabs, Play Mode, remote pairing, multi-user routing, or public AI-client integrations.

## Why not start with 300 tools?

The hard parts are not the tool count. They are safe Unity main-thread execution, object identity, retries, Undo, compilation/domain reload, reconnection, permission boundaries, and multi-editor routing.

The initial goal is roughly 10–20 stable domain tools/tool families. Advanced Unity areas can be added after the execution core is proven trustworthy.

Arbitrary C# execution is intentionally not an early default escape hatch.

## External projects

Other Unity MCP projects may be studied for requirements, UX, interoperability, feature coverage, and known failure modes. That does **not** mean their implementation is incorporated here.

Research references are tracked in [`REFERENCES.md`](REFERENCES.md). If copyrighted third-party code or other material is ever actually incorporated, its exact source revision and license obligations must be reviewed and recorded at that time.

## Core truth rule

> **Repository evidence beats memory, assumptions, chat history, and plans.**

`STATUS.md` is authoritative for implementation/verification. Design and roadmap documents may describe future behavior and are not proof that functionality exists.
