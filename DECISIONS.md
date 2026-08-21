# Architecture Decisions

> This file records decisions that future contributors and AI agents should not silently re-litigate or reverse without new evidence.
>
> `STATUS.md` says what exists. `DESIGN.md` says how the system is intended to work. This file says **why key choices were made**.

## Decision status vocabulary

- **Proposed** — candidate direction; implementation may not rely on it yet.
- **Accepted** — current design baseline.
- **Superseded** — replaced by a later numbered decision.
- **Rejected** — explicitly considered and not selected.

---

## D-001 — Provider-neutral core

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

The Unity control core will use MCP-compatible/provider-neutral interfaces and must not embed ChatGPT-, Claude-, Gemini-, or other vendor-specific behavior into Unity command logic unless an interoperability constraint requires it.

### Why

The useful asset is reliable Unity control. Multiple AI clients can sit above the same core, and vendor capabilities can change independently.

### Consequence

Provider-specific integration code should remain thin and replaceable.

---

## D-002 — Public open core, private hosted operations

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

`unity-ai-bridge` is the public open-core repository. `unity-ai-mcp-infra` is reserved for managed-service deployment/auth/operations.

### Why

This preserves self-hostability and public trust while preventing production deployment state and sensitive operations from contaminating the public repository.

### Consequence

The private repository must consume/deploy the public core through a versioned interface rather than maintaining a private fork of core logic.

---

## D-003 — Unity side is a C# Editor package

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Unity-side automation will be implemented as a Unity Package Manager package written in C#, with Editor-side code responsible for Unity Editor API access.

### Why

Unity's editor APIs are native to C# and require lifecycle/main-thread awareness that belongs inside the Editor process.

### Consequence

Network/server code must not pretend it can safely manipulate Unity objects directly.

---

## D-004 — TypeScript for the initial MCP/server core

**Status:** Accepted for initial implementation  
**Date:** 2026-08-22

### Decision

Start the public MCP/server core in TypeScript using the official Model Context Protocol TypeScript SDK v2 line unless an implementation test demonstrates a concrete blocker.

Remote MCP should use Streamable HTTP. Exact runtime/minimum Node version will be pinned when source scaffolding is committed.

### Evidence considered

At the time of this decision, the official TypeScript SDK v2 documents support for the 2026-07-28 MCP revision and provides server/client packages for modern MCP. Official SDK documentation recommends Streamable HTTP for remote MCP servers.

### Why

- first-party MCP support,
- strong schema validation/tooling,
- practical remote deployment,
- easy separation from Unity C#,
- suitable for local/self-host and hosted gateway code.

### Revisit trigger

A concrete compatibility, deployment, performance, maintenance, or SDK limitation demonstrated by code/tests.

---

## D-005 — WebSocket first for Unity bridge transport

**Status:** Accepted for first implementation  
**Date:** 2026-08-22

### Decision

Define a transport-independent Unity bridge protocol and implement WebSocket first.

Hosted mode should use an **outbound** Unity connection to avoid requiring ordinary users to configure inbound ports or router forwarding.

### Why

The bridge needs bidirectional commands/results and connection presence. WebSocket is broadly deployable and works for both localhost and remote gateway scenarios.

### Consequence

Tool semantics and command schemas must not depend on WebSocket-specific behavior.

---

## D-006 — Main-thread command queue is mandatory

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Network callbacks parse/validate/enqueue only. Unity Editor API mutations execute through a controlled main-thread dispatcher.

### Why

Unity editor state is main-thread-sensitive, and blocking/network work on the Editor UI thread creates freezes and race conditions.

### Consequence

Every Unity command handler must fit the dispatcher/queue lifecycle or explicitly document why it is safe outside it.

---

## D-007 — Small stable tool surface before large tool count

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Begin with roughly 10–20 stable domain tools/tool families rather than exposing hundreds of tiny tools.

### Why

A giant tool surface increases schema context, maintenance, compatibility, review, and safety cost. Many Unity operations can share well-designed domain schemas.

### Consequence

Tool count is not a project success metric. Advanced domains are added after the underlying execution model is proven reliable.

---

## D-008 — No arbitrary C# execution in the early public core

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Do not use arbitrary C# execution as the default escape hatch for missing tools in early public releases.

### Why

It greatly expands capability, but also bypasses bounded schemas, permission boundaries, reviewability, and safety controls.

### Consequence

If arbitrary execution is added later it must be classified as privileged, explicitly gated, and reviewed separately.

---

## D-009 — Request identity and ambiguous-retry protection

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Mutation requests need request identity and operation-appropriate idempotency/deduplication behavior from the first real bridge protocol.

### Why

A timeout can occur after Unity performs a mutation but before the response reaches the caller. Blind retry could duplicate or repeat destructive state changes.

### Consequence

Transport retry logic cannot simply re-execute every write.

---

## D-010 — Stable target resolution, not InstanceID-only

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Do not use Unity `InstanceID` as the sole durable protocol identity across reloads, scene changes, or editor restarts.

### Direction

Use asset GUIDs, `GlobalObjectId` where appropriate, scene/hierarchy identity plus validation metadata, and component ownership/type information depending on target class.

### Consequence

Object resolution is a first-class subsystem rather than helper code hidden inside individual tools.

---

## D-011 — Domain reload and reconnection are normal lifecycle events

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Compilation/domain reload, editor restart, sleep/network transitions, and stale sockets are expected states. The connection protocol must recover without treating every reconnect as a new unrelated user/editor.

### Consequence

Pending work, connection generations, and compile state require explicit modeling.

---

## D-012 — Undo and dirty-state reporting are core behavior

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Where Unity supports it, mutations should integrate with Undo and report dirty/unsaved state. Saving is a distinct explicit action.

### Why

AI-generated editor mutations must be recoverable, and successful mutation is not equivalent to persistence on disk.

---

## D-013 — Easy Connect is the intended default UX, not the first engineering milestone

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

The product target is a beginner pairing flow with no port/MCP configuration, but engineering begins with a narrow local end-to-end path.

### Why

Remote auth/routing can hide bugs in the more fundamental Unity execution path. The local path should become trustworthy before hosted complexity is added.

---

## D-014 — TeamForge is not a dependency

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

Unity AI Bridge must not depend on or integrate with TeamForge during early development.

### Why

They are separate projects with different readiness and failure domains. Coupling them would increase scope and make debugging harder.

### Revisit trigger

Both projects are independently stable and there is a concrete user-facing integration requirement.

---

## D-015 — Roadmap dates are not promises

**Status:** Accepted  
**Date:** 2026-08-22

### Decision

The public roadmap uses capability/phase gates rather than invented completion dates.

### Why

This project is pre-alpha and technical unknowns are expected. False ETAs create pressure to mark unverified work complete.

---

## Adding or changing a decision

When a meaningful architecture decision changes:

1. do not rewrite the old entry to pretend the old choice never existed,
2. add a new numbered decision,
3. mark the old decision `Superseded`,
4. link the replacement,
5. explain the evidence that caused the change,
6. update `DESIGN.md`, `STATUS.md`, and code/tests where applicable.