# Unity AI Bridge

Provider-neutral MCP bridge for controlling the Unity Editor through a small, structured, safety-oriented tool surface.

> **Pre-alpha.** The repository is under active development. Current public behavior is intentionally narrow and should be treated as experimental until `STATUS.md` says otherwise.

## Why this exists

Unity AI Bridge is exploring a simple goal:

> Let an AI client inspect and edit Unity projects through explicit tools instead of arbitrary code execution or fragile GUI automation.

The project currently focuses on a trustworthy local execution core before expanding tool count or remote connectivity.

## Current status

See [`STATUS.md`](STATUS.md) for the canonical implementation and verification state.

Current development phase: **Phase 2 — Reliability Core**.

Verified local slices include:

- Unity 6000.3.21f1 package load/compile on Windows,
- local WebSocket bridge and MCP stdio status round-trip,
- domain-reload reconnect with stale-generation rejection,
- bounded active-scene hierarchy reads with `GlobalObjectId`,
- one bounded `gameObject.create` write with Undo/dirty metadata and duplicate-retry protection,
- bounded Console/compiler diagnostics,
- stable native object resolution and stale replay rejection,
- Agent capability/version preflight,
- common mutation preflight + Undo transaction grouping,
- forced failure rollback with native readback,
- stale-state epoch/revision rejection,
- same-session mutation lifecycle protection across domain reload,
- Unity EditMode reliability tests.

Do not infer broader support from roadmap items or examples.

## Architecture direction

```text
AI / MCP client
   -> MCP server
   -> local/remote bridge transport
   -> Unity Editor package
   -> main-thread command queue
   -> bounded Unity Editor API operations
   -> native readback / verification
   -> structured result
```

Reliability rules for write tools include:

- explicit mutation identity,
- main-thread execution,
- preflight validation,
- stable target identity,
- Undo integration,
- native readback,
- semantic verification,
- fail-closed retry behavior,
- rollback when verification fails,
- no implicit save.

## Repository layout

- `unity-package/` — Unity Editor package (`com.eunsung.unity-ai-bridge`)
- `mcp-server/` — TypeScript MCP/server and local bridge
- `bridge-protocol/` — transport schemas/fixtures
- `docs/` — implementation/testing notes
- `AGENTS.md` — mandatory grounding rules for AI/contributors
- `STATUS.md` — canonical implementation/verification state
- `ROADMAP.md` — direction/capability milestones
- `DECISIONS.md` — accepted architecture decisions
- `DESIGN.md` — detailed system design
- `CODEMAP.md` — source map
- `REFERENCES.md` — external research references, not incorporated code

## Development

Node runtime is pinned via `.nvmrc`.

From the repository root:

```bash
npm --prefix mcp-server ci
npm run build
npm test
```

Real Unity verification requires Unity 6000.3.21f1 and is documented in [`docs/TESTING.md`](docs/TESTING.md).

## Unity package

Install `unity-package/package.json` through Unity Package Manager -> **Add package from disk**.

The package targets Unity `6000.3.21f1` as the initial verified development environment.

If you want Unity Test Runner to load package EditMode tests from a non-embedded local package, add `com.eunsung.unity-ai-bridge` to the consuming project's top-level `Packages/manifest.json` `testables` array. See [`unity-package/Tests/README.md`](unity-package/Tests/README.md).

## MCP tools currently implemented

Current bounded public tools include:

- `unity_get_status`
- `unity_get_hierarchy`
- `unity_get_diagnostics`
- `unity_resolve_object`
- `unity_create_game_object`

The project deliberately does not expose arbitrary C# or shell execution as a fallback.

## Security / safety posture

This project treats editor mutation safety as core functionality, not polish.

- write tools use explicit mutation identity,
- write execution is routed to the Unity main thread,
- stale connection generations are rejected,
- unsupported Agent operations are rejected during capability preflight,
- state revision preconditions can reject stale writes,
- same-session ambiguous mutation lifecycles fail closed across domain reload,
- current create results are revalidated against native Unity state before replay,
- failed verified writes use Undo rollback where available,
- no write silently saves scenes or assets.

Remote authentication/pairing and multi-user routing are not implemented yet.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).

The separate private infrastructure repository is outside this repository's automatic license boundary.
