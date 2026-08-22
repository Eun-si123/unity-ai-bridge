# Changelog

All notable project changes are recorded here by implementation phase.

The project is pre-alpha. Internal package version `0.0.1` does not represent a public release.

## Unreleased

No post-Phase-0 changes are recorded on this branch. New work should be added as its own phase/change section instead of being mixed into the Phase 0 history below.

## Phase 0 — Foundation Runtime Scaffold — 2026-08-22

### Added

- Initial project README and scope.
- Mandatory AI/contributor guardrails in `AGENTS.md`.
- Canonical implementation/verification tracking in `STATUS.md`.
- High-level architecture summary in `ARCHITECTURE.md`.
- Durable detailed system design in `DESIGN.md`.
- Architecture decision history in `DECISIONS.md`.
- Public capability-gated roadmap in `ROADMAP.md`.
- Repository/source layout tracking in `CODEMAP.md`.
- Compact AI-agent entrypoint in `llms.txt`.
- `REFERENCES.md` for external research influences that are not incorporated code.
- Initial `unity-package/` UPM scaffold targeting Unity 6000.3.21f1.
- Initial bridge protocol v0 command/result JSON Schemas and editor-status fixtures.
- Bridge protocol v0 C# and TypeScript version/type definitions.
- Initial `mcp-server/` TypeScript MCP v2 stdio bootstrap.
- Strict TypeScript build configuration and Node test-runner protocol smoke tests.
- Root build/test delegation, Node 24.19.0 runtime pin, and repository ignore rules.
- GitHub Actions Node verification workflow.
- Generated `mcp-server/package-lock.json` dependency lockfile.

### Changed

- Moved the project from documentation-only foundation work to an initial runtime/source scaffold.
- Pinned the initial direct MCP/server toolchain to Node 24.19.0, `@modelcontextprotocol/server` 2.0.0, TypeScript 7.0.2, and `@types/node` 24.13.3.
- Recorded successful CI verification for lockfile generation, `npm ci`, TypeScript build, and protocol smoke tests.
- Clarified that a public GitHub repository is **not** an open-source license; the project license remains undecided.
- Separated accepted design decisions from implementation status in `STATUS.md`.
- Reduced mandatory AI reading overhead: new/lost-context sessions load the core truth/design context, while routine changes load only relevant documents.
- Clarified that external Unity MCP projects are research references unless exact third-party material is deliberately incorporated.
- Clarified the intended public-core/private-managed-service boundary.

### Removed

- Premature `THIRD_PARTY_NOTICES.md` reference log. A real third-party notice/license file should be added only when incorporated dependencies/material actually require one.

### Verification

- Node/MCP dependency install, TypeScript build, and protocol smoke tests: **Verified by GitHub Actions**.
- Unity 6000.3.21f1 package load/compile: **Not yet verified**.
- Project license: **Not yet selected**.

### Scope at Phase 0

Phase 0 does **not** claim a working Unity WebSocket bridge, Unity command dispatcher, Unity tool handlers, remote gateway, pairing service, or ChatGPT integration. Those belong to later phases.
