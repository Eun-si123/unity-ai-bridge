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

### Important terminology note

A public GitHub repository is **not automatically open source**. The project license is still undecided. Until a `LICENSE` file is intentionally selected, describe this as a **public core / self-hostable design target**, not as a licensed open-source/open-core release.

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

On 2026-08-22, official MCP TypeScript SDK v2 documentation identified v2 as the stable line for the 2026-07-28 protocol generation and documented Streamable HTTP support. Exact package/runtime versions are still to be pinned in source/lockfiles.

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

## Changing a decision

When a meaningful choice changes:

1. gather the new evidence,
2. add a new numbered decision,
3. mark the old decision `Superseded` when appropriate,
4. explain the trade-off/migration impact,
5. update `DESIGN.md`, `STATUS.md`, code/tests, and other affected docs consistently.

Do not rewrite history merely to make the latest architecture look inevitable.
