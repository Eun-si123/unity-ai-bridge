# Unity AI Bridge

> **Status: pre-alpha / repository bootstrap**
>
> This repository is currently a project scaffold. A working Unity package, MCP server, remote gateway, or ChatGPT plugin **must not be assumed to exist unless `STATUS.md` explicitly says it is implemented and verified**.

Unity AI Bridge is an experimental open-core project intended to make AI-assisted Unity Editor control easy enough that users do not need to understand MCP, ports, local networking, or editor scripting to get started.

The long-term product goal is simple:

```text
Install Unity package
 -> click Connect AI
 -> pair
 -> use natural language to inspect and edit Unity
```

The engineering core is provider-neutral so the same Unity control layer can work with multiple MCP-capable AI clients rather than being permanently coupled to one vendor.

## Where to start

### If you want to know what works today

Read [`STATUS.md`](STATUS.md).

### If you want to know how we intend to build it

Read [`DESIGN.md`](DESIGN.md).

### If you want to know why major choices were made

Read [`DECISIONS.md`](DECISIONS.md).

### If you want to know what comes next

Read the public [`ROADMAP.md`](ROADMAP.md).

### If you are an AI agent or contributor

Read [`AGENTS.md`](AGENTS.md) **before modifying anything**.

## Design goals

- **Easy for beginners:** the intended default should eventually be package install -> Connect AI -> pairing, without manual MCP configuration.
- **Provider-neutral:** the Unity control core must not depend on one LLM vendor.
- **High-quality core tools:** prefer a smaller set of reliable, composable tools over a large count of fragile tools.
- **Safe by default:** destructive operations, arbitrary code execution, remote access, and credentials require explicit safeguards.
- **Recoverable:** Unity changes should use Undo where practical and report dirty/unsaved state.
- **Observable:** every tool call should return useful structured results and errors.
- **Reconnect-aware:** compilation/domain reload, editor restarts, and network interruptions are normal lifecycle events.
- **Retry-safe:** ambiguous network retries must not silently repeat Unity mutations.
- **Verifiable:** an AI must not claim a feature works unless it has evidence from code, tests, or runtime output.
- **License-conscious:** third-party code must not be copied until its license and attribution requirements are documented.
- **Self-hostable core:** hosted convenience should not require a secret private fork of the Unity/MCP core.

## Accepted design direction

This is a **target design**, not a statement of currently implemented functionality:

```text
ChatGPT / Claude / Codex / Gemini / other MCP client
                         |
                         | MCP / Streamable HTTP (remote)
                         v
              Public MCP Core / Gateway
                         |
                         | versioned bridge protocol
                         | WebSocket first implementation
                         v
                 Unity Editor Agent
                    (C# package)
                         |
              main-thread command queue
                         |
                         v
                  Unity Editor APIs
```

Initial technical direction is:

- Unity Agent: C# Unity Editor package,
- MCP/server core: TypeScript using the official MCP TypeScript SDK v2 line unless implementation evidence requires a change,
- remote MCP: Streamable HTTP,
- Unity bridge transport: transport abstraction with WebSocket first,
- writes: serialized by default,
- target identity: not dependent on Unity `InstanceID` alone,
- mutations: request identity/retry protection, Undo where practical, and dirty-state reporting.

The detailed design is in [`DESIGN.md`](DESIGN.md). Architectural choices and their rationale are recorded in [`DECISIONS.md`](DECISIONS.md) so future contributors do not silently reverse them based on memory or guesswork.

## Public core and hosted infrastructure

```text
unity-ai-bridge        (PUBLIC)
  Unity package
  MCP/tool core
  bridge protocol
  local/self-host path
  reusable routing abstractions
  tests and documentation

unity-ai-mcp-infra     (PRIVATE)
  managed-service deployment
  production auth integration
  database/deployment operations
  rate limits/abuse controls
  private operational tooling
```

The private infrastructure repository must not become a divergent private fork of the public core.

## AI and contributor rules

The most important rule is:

> **Repository evidence beats memory, assumptions, chat history, and plans.**

If documentation and code disagree, investigate and update the stale document rather than inventing an explanation.

`STATUS.md` is the authority for implementation/verification. `DESIGN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `ROADMAP.md` may describe future behavior and must never be used alone as proof that a feature exists.

## First engineering milestone

The first usable engineering milestone is intentionally small:

1. Connect one Unity Editor instance locally.
2. Expose a minimal MCP endpoint.
3. Read Unity/editor status.
4. Read the active scene/hierarchy.
5. Create a simple GameObject.
6. Read Console/compiler errors.
7. Return structured results/errors.
8. Re-read Unity state to prove the requested effect actually happened.

Only after this path is stable should the project expand into components, scripts, prefabs, assets, play mode, tests, remote pairing, multi-user routing, or public app/plugin distribution.

See [`ROADMAP.md`](ROADMAP.md) for the phase gates.

## Why not start with 300 tools?

Tool count is not the goal. The difficult parts are reliable execution, object identity, retries, Undo, compilation/domain reload, reconnection, permissions, and multi-editor routing.

The project will start with roughly 10–20 stable domain tools/tool families and expand advanced Unity domains only when the execution core is trustworthy.

Arbitrary C# execution is intentionally **not** an early default escape hatch.

## Third-party projects

Other Unity MCP projects may be studied for interoperability, requirements, UX ideas, and known failure modes. Reuse of source code is governed by the original project's license and must be recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Do **not** assume that a project's feature list or open-source availability grants permission to copy its implementation.

## Repository documentation map

- [`STATUS.md`](STATUS.md) — canonical source of truth for what is implemented and verified
- [`DESIGN.md`](DESIGN.md) — durable detailed system design / memory anchor
- [`DECISIONS.md`](DECISIONS.md) — architecture decision history and rationale
- [`ROADMAP.md`](ROADMAP.md) — public future milestones and phase gates
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — high-level architecture and boundaries
- [`AGENTS.md`](AGENTS.md) — mandatory AI/contributor operating rules
- [`CODEMAP.md`](CODEMAP.md) — existing vs planned repository paths
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — third-party provenance and license tracking
- [`CHANGELOG.md`](CHANGELOG.md) — user-visible changes
- [`llms.txt`](llms.txt) — short AI-agent entrypoint

## License

A project license has **not yet been selected**. Do not assume permission terms beyond GitHub's default copyright rules until a `LICENSE` file is intentionally added.
