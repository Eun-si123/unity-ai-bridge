# Unity AI Bridge

> **Status: pre-alpha / repository bootstrap**
>
> This repository is currently a project scaffold. A working Unity package, MCP server, remote gateway, or ChatGPT plugin **must not be assumed to exist unless `STATUS.md` explicitly says it is implemented and verified**.

Unity AI Bridge is an experimental project intended to make AI-assisted Unity Editor control easy enough that users do not need to understand MCP, local networking, or editor scripting to get started.

The long-term goal is a provider-neutral bridge that can expose safe, well-tested Unity Editor capabilities to MCP-capable AI clients and, where supported, ChatGPT plugins/apps and other AI ecosystems.

## Design goals

- **Easy for beginners:** installation and pairing should require as little manual configuration as practical.
- **Provider-neutral:** the core should not depend on one LLM vendor.
- **High-quality core tools:** prefer a smaller set of reliable, composable tools over a large count of fragile tools.
- **Safe by default:** destructive operations, arbitrary code execution, remote access, and credentials require explicit safeguards.
- **Recoverable:** Unity changes should use Undo where practical and report dirty/unsaved state.
- **Observable:** every tool call should return useful structured results and errors.
- **Verifiable:** an AI must not claim a feature works unless it has evidence from code, tests, or runtime output.
- **License-conscious:** third-party code must not be copied until its license and attribution requirements are documented.

## Intended architecture

This is a **target architecture**, not a statement of currently implemented functionality:

```text
AI client / ChatGPT app / MCP client
                |
                | MCP
                v
        MCP / Gateway layer
                |
          authenticated route
                |
                v
        Unity Editor package
                |
      main-thread command queue
                |
                v
          Unity Editor API
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the proposed architecture and [`STATUS.md`](STATUS.md) for what actually exists today.

## AI and contributor rules

Any AI agent or contributor working on this repository must read [`AGENTS.md`](AGENTS.md) before modifying code or documentation.

The most important rule is simple:

> **Repository evidence beats memory, assumptions, chat history, and plans.**

If documentation and code disagree, investigate and update the stale document rather than inventing an explanation.

## First milestone

The first usable milestone is intentionally small:

1. Connect one Unity Editor instance.
2. Expose a minimal MCP endpoint.
3. Read Unity/editor status.
4. Read the active scene/hierarchy.
5. Create or modify a simple GameObject.
6. Read Console/compiler errors.
7. Verify the result from Unity.

Only after this path is stable should the project expand into scripts, prefabs, assets, play mode, tests, profiler tooling, remote pairing, multi-user routing, or public plugin distribution.

## Third-party projects

Other Unity MCP projects may be studied for interoperability, requirements, UX ideas, and known failure modes. Reuse of source code is governed by the original project's license and must be recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Do **not** assume that a project's feature list or open-source availability grants permission to copy its implementation.

## Repository map

See [`CODEMAP.md`](CODEMAP.md). Planned paths are explicitly marked as planned until they exist.

## Project state and history

- [`STATUS.md`](STATUS.md) — source of truth for implementation status and verification
- [`CHANGELOG.md`](CHANGELOG.md) — user-visible changes
- [`AGENTS.md`](AGENTS.md) — mandatory AI/contributor operating rules
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — architectural decisions and proposed boundaries
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — third-party provenance and license tracking

## License

A project license has **not yet been selected**. Do not assume permission terms beyond GitHub's default copyright rules until a `LICENSE` file is intentionally added.
