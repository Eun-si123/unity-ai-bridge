# Changelog

All notable user-visible changes to this project should be documented in this file.

The project is pre-alpha; version numbers are not yet assigned.

## Unreleased

### Added

- Initial project README and scope.
- Mandatory AI/contributor guardrails in `AGENTS.md`.
- Canonical implementation/verification status tracking in `STATUS.md`.
- Proposed high-level architecture boundaries in `ARCHITECTURE.md`.
- Durable detailed system design in `DESIGN.md` so future contributors/AI agents can recover intended behavior without private chat history.
- Architecture decision history in `DECISIONS.md`, including provider-neutral core, public/private split, C# Unity agent, TypeScript MCP/server direction, Streamable HTTP, WebSocket-first Unity transport, main-thread dispatch, retry protection, stable object identity, Undo, and scope boundaries.
- Public capability-gated roadmap in `ROADMAP.md`.
- Repository/source layout tracking in `CODEMAP.md`.
- Third-party provenance and license tracking in `THIRD_PARTY_NOTICES.md`.
- Compact AI-agent entrypoint in `llms.txt`.

### Changed

- README now exposes the design, decision record, roadmap, repository split, and first engineering milestone directly.
- AI operating rules now require reading design/decision/roadmap documents and prohibit silently reversing accepted architecture decisions.
- Project status now explicitly distinguishes accepted design choices from implemented runtime functionality.

### Important

- No working Unity package, MCP server, bridge transport, remote gateway, pairing service, or ChatGPT plugin is claimed by this changelog entry.
- TypeScript/MCP SDK/WebSocket choices are design decisions for the initial implementation, not evidence that dependencies or runtime code already exist.
- Bootstrap documentation is intentionally designed to distinguish plans from verified implementation.
