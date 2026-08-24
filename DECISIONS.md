# Architecture Decisions

This file records important choices so future contributors and AI agents do not silently redesign the project from memory.

`STATUS.md` says what exists. `DESIGN.md` says how the system is intended to work. This file says **why major choices were made**.

## Decision status

- **Proposed** — candidate direction
- **Accepted** — current design baseline
- **Superseded** — replaced by a later decision
- **Rejected** — considered and intentionally not selected

---

## D-001 — Provider-neutral core

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Unity command logic should use MCP-compatible/provider-neutral boundaries and avoid embedding ChatGPT-, Claude-, Gemini-, or other vendor-specific behavior unless interoperability requires it.

### Why

Reliable Unity control is the reusable asset; AI-client ecosystems can change independently.

---

## D-002 — Public reusable core, private managed-service operations

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

`unity-ai-bridge` is the public repository for reusable Unity/MCP behavior. `unity-ai-mcp-infra` is for managed-service-specific deployment, production provider wiring, policy, and operations.

The private repository must consume/deploy the public core through explicit interfaces/versioning rather than maintain a second private copy.

### Licensing boundary

The public `unity-ai-bridge` repository is licensed under Apache License 2.0 by D-017. That license applies to the contents of this public repository and does not automatically license the separate private `unity-ai-mcp-infra` repository.

---

## D-003 — Unity side is a C# Editor package

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Unity-side automation will be implemented as a Unity Package Manager package in C#, with Editor-side code responsible for Unity Editor API access.

### Why

Unity Editor APIs and lifecycle/main-thread behavior belong inside the Editor process.

---

## D-004 — TypeScript for the initial MCP/server core

**Status:** Accepted for initial implementation  
**Date:** 2026-08-22

### Decision

Start the public MCP/server core in TypeScript using the official Model Context Protocol TypeScript SDK v2 line unless implementation evidence shows a concrete blocker.

Use Streamable HTTP for remote MCP.

### Evidence at decision time

On 2026-08-22, official MCP TypeScript SDK v2 documentation identified v2 as the stable line for the 2026-07-28 protocol generation and documented Streamable HTTP support. Exact package/runtime versions are pinned in source and lockfiles.

### Revisit trigger

A demonstrated compatibility, deployment, performance, maintenance, or SDK limitation.

---

## D-005 — WebSocket first for the Unity bridge

**Status:** Accepted for first implementation  
**Date:** 2026-08-22

### Decision

Define a transport-independent Unity bridge protocol and implement WebSocket first.

Hosted mode should use an outbound Unity connection so ordinary users do not need inbound port forwarding.

### Consequence

Tool semantics/command schemas must not depend on WebSocket-specific details.

---

## D-006 — Main-thread command queue is mandatory

**Status:** Accepted  
**Date:** 2026-08-22

Network callbacks may parse/validate/enqueue, but Unity Editor API mutation must execute through a controlled Unity main-thread boundary unless a specific operation is proven safe elsewhere.

---

## D-007 — Small stable tool surface before large tool count

**Status:** Accepted  
**Date:** 2026-08-22

Begin with roughly 10–20 stable domain tools/tool families rather than hundreds of tiny tools.

Tool count is not a success metric. Reliability, schema quality, recovery, and usefulness are.

---

## D-008 — No arbitrary C# execution as an early default escape hatch

**Status:** Accepted  
**Date:** 2026-08-22

Arbitrary C# execution is not part of the early default public surface.

If introduced later it must be a separately reviewed/gated privileged capability because it bypasses bounded schemas and greatly expands authority.

---

## D-009 — Mutation request identity and ambiguous-retry protection

**Status:** Accepted  
**Date:** 2026-08-22

Mutation requests require request identity plus operation-appropriate deduplication/idempotency behavior.

A timeout after Unity changed state but before the response arrived must not cause a blind retry to duplicate the mutation.

---

## D-010 — Durable target resolution, not `InstanceID` alone

**Status:** Accepted  
**Date:** 2026-08-22

Do not use Unity `InstanceID` as the sole durable protocol identity across reloads, scene changes, or restarts.

Use stronger identity appropriate to the target, such as asset GUIDs, `GlobalObjectId` where suitable, scene/hierarchy identity plus validation metadata, and component ownership/type information.

---

## D-011 — Domain reload and reconnect are normal lifecycle

**Status:** Accepted  
**Date:** 2026-08-22

Compilation/domain reload, editor restart, sleep/network changes, stale sockets, and reconnects are expected states.

Pending work and connection generations must be modeled explicitly enough that stale connections cannot act as current ones.

---

## D-012 — Undo and dirty-state reporting are core behavior

**Status:** Accepted  
**Date:** 2026-08-22

Where Unity supports it, mutations should integrate with Undo and report dirty/unsaved state. Saving is a distinct explicit operation.

---

## D-013 — Easy Connect is the product UX target, not the first engineering milestone

**Status:** Accepted  
**Date:** 2026-08-22

Begin with a narrow local end-to-end path. Add hosted pairing/auth/routing only after the Unity execution path is trustworthy.

The eventual default user experience should hide ports/MCP configuration where platform support permits it.

---

## D-014 — TeamForge is not an early dependency

**Status:** Accepted  
**Date:** 2026-08-22

Unity AI Bridge must develop independently of TeamForge during early phases.

### Revisit trigger

Both projects are independently stable and a concrete user-facing integration requirement exists.

---

## D-015 — Roadmap uses capability gates, not invented ETAs

**Status:** Accepted  
**Date:** 2026-08-22

Roadmap phases advance based on reproducible capability/verification gates rather than arbitrary completion dates.

---

## D-016 — Research references are separate from incorporated third-party material

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Use `REFERENCES.md` to record external projects/materials that influence research, requirements, interoperability thinking, or known-failure analysis.

Do not create or populate a `THIRD_PARTY_NOTICES.md` merely because another repository was studied.

If third-party implementation/code/docs/assets are actually incorporated later, review the exact source/revision/license and add whatever license/notice files are genuinely required by that incorporated material.

### Why

A reference list and a legal redistribution notice serve different purposes. Mixing them can falsely imply that external code is included in this project.

---

## D-017 — Apache-2.0 for the public core

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

License the public `unity-ai-bridge` repository under the **Apache License 2.0**.

The separate private `unity-ai-mcp-infra` repository is outside this repository's license boundary unless it is separately and explicitly licensed later.

### Why

The public core is intended to be reusable and self-hostable, including in commercial environments. Apache-2.0 keeps a permissive adoption model while providing explicit patent-license terms and redistribution/notice requirements that are useful for a growing infrastructure/tooling project.

The project can still operate a separate managed hosted service using private infrastructure around the public core.

### Consequences

- commercial use, modification, and redistribution of the public core are allowed subject to Apache-2.0 terms,
- forks may be used in proprietary/commercial products subject to those terms,
- project trademarks are not granted by the software license except as the license itself permits,
- private managed-service code is not made public merely because it consumes or deploys the Apache-2.0 core.

### Revisit trigger

A future licensing change would require an explicit new decision plus review of contributor/copyright implications; do not silently replace the license text.

---

## D-018 — MCP remains canonical; portable agent packaging stays optional

**Status:** Accepted  
**Date:** 2026-08-24

### Decision

MCP remains the canonical AI-client/tool boundary for Unity AI Bridge.

Portable agent-plugin packaging such as **Agent Plugins 1.0** may be adopted to package MCP server declarations, reusable skills, and shared integration metadata, but it must remain an outer distribution layer rather than a replacement for MCP or a dependency of Unity execution semantics.

Vendor-specific integration code should be thin and should not fork or duplicate Unity command logic.

### Why

The reusable asset is the provider-neutral Unity control/reliability core. AI hosts and plugin marketplaces can change independently. A portable package can reduce duplicated metadata and skills while preserving the ability for any standards-compatible MCP host to consume the same tools directly.

### Consequences

- ChatGPT can be the first production integration target without becoming the architectural owner of the project,
- Claude, Codex, Gemini, Cursor, Copilot, and other MCP hosts should reuse the same public core,
- `integrations/<vendor>` directories are created only for real host-specific requirements,
- Agent Plugins support must be re-verified against the current specification and host adoption state when Phase 5 implementation begins.

### Revisit trigger

A future portable standard supersedes MCP as the actual tool protocol, or major hosts require incompatible semantics that cannot be represented by thin adapters.

---

## D-019 — Auto-enable package tests only for development-style installs

**Status:** Accepted  
**Date:** 2026-08-24

### Decision

The Unity package may automatically add `com.eunsung.unity-ai-bridge` to the consuming project's top-level `Packages/manifest.json` `testables` array when the package source is Local, LocalTarball, or Git.

Embedded packages need no manifest change. Registry, BuiltIn, and Unknown sources are not automatically modified. A manual `Tools > Unity AI Bridge > Enable Package Tests` fallback remains available.

The updater must:

- make no write when the package is already testable,
- preserve existing dependencies and existing `testables` entries,
- fail without rewriting when the existing `testables` value is malformed or not a string array,
- surface a warning and manual fallback if the project manifest cannot be updated.

### Why

Unity requires non-embedded package dependencies to be listed in the project manifest's `testables` array before package tests appear in Test Runner. Requiring every developer to remember this hidden project-level step made the installed package appear to have no tests even though the test assembly was present.

Automatic mutation is deliberately limited to development-style package sources so a future registry consumer is not forced to compile the package's development tests merely by installing the product.

### Verification rule

Implementation alone does not make this behavior Verified. It must be tested in a fresh Unity project using at least one non-embedded development-style install and confirmed to cause `EunSung.UnityAiBridge.Editor.Tests` to appear in Test Runner after Package Manager resolution/recompile.

---

## Changing a decision

When a meaningful choice changes:

1. gather the new evidence,
2. add a new numbered decision,
3. mark the old decision `Superseded` when appropriate,
4. explain the trade-off/migration impact,
5. update `DESIGN.md`, `STATUS.md`, code/tests, and other affected docs consistently.

Do not rewrite history merely to make the latest architecture look inevitable.
