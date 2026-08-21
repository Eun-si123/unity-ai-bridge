# Changelog

All notable user-visible/project changes should be documented here.

The project is pre-alpha; version numbers are not yet assigned.

## Unreleased

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

### Changed

- Clarified that a public GitHub repository is **not** an open-source license; the project license remains undecided.
- Separated accepted design decisions from implementation status in `STATUS.md`.
- Reduced mandatory AI reading overhead: new/lost-context sessions load the core truth/design context, while routine changes load only relevant documents.
- Clarified that external Unity MCP projects are research references unless exact third-party material is deliberately incorporated.
- Clarified the intended public-core/private-managed-service boundary.

### Removed

- Premature `THIRD_PARTY_NOTICES.md` reference log. A real third-party notice/license file should be added only when incorporated dependencies/material actually require one.

### Important

- No working Unity package, MCP server, bridge transport, remote gateway, pairing service, or ChatGPT integration is claimed by this changelog.
- TypeScript/MCP SDK/WebSocket choices are design directions, not evidence that dependencies or runtime code already exist.
