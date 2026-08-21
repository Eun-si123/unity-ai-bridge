# Architecture

> **High-level target summary, not implementation evidence.**
>
> `STATUS.md` says what exists. `DESIGN.md` contains the detailed design. `DECISIONS.md` records why major choices were made.

## System boundary

```text
AI / MCP client
      |
      | MCP
      v
Public MCP/server core
  - tool schemas
  - validation/policy metadata
  - request/result correlation
  - reusable routing
      |
      | versioned bridge protocol
      v
Unity Editor Agent (C#)
  - connection lifecycle
  - command queue
  - main-thread dispatcher
  - target resolution
  - Undo/dirty handling
  - compile/reload handling
      |
      v
Unity Editor APIs
```

For the managed hosted service, private infrastructure adds production auth/identity, storage, policy/abuse controls, monitoring, and deployment around the public core. It should not become a second private implementation of the core.

## Architectural invariants

1. **Controlled Unity execution** — network callbacks do not directly mutate Unity state.
2. **Main-thread awareness** — Unity Editor API work is treated as main-thread-sensitive unless proven otherwise.
3. **Writes are conservative** — conflicting writes are serialized by default.
4. **Durable identity** — protocol targeting does not rely on Unity `InstanceID` alone.
5. **Reconnect is normal** — compilation/domain reload and network reconnect are expected lifecycle events.
6. **Recoverability matters** — use Undo where practical and report dirty/unsaved state.
7. **Observed result over delivery** — a successful transport round trip is not proof that the requested Unity state exists.
8. **Provider-neutral core** — vendor/client integration stays thin where practical.
9. **Public reusable behavior stays public** — managed infrastructure composes/deploys the core rather than privately forking it.
10. **Scope grows after reliability** — advanced Unity domains come after the local execution/recovery path is trustworthy.

## Early privileged capabilities

The following require explicit security/architecture review before public exposure:

- arbitrary C# execution,
- arbitrary filesystem/process control,
- broad destructive asset/project changes,
- signing/deployment credentials,
- unrestricted BYO/upstream server proxying.

A generic escape hatch is not an acceptable substitute for bounded, testable Unity tools.

## Hosted routing boundary

Future hosted routing should distinguish:

```text
Authenticated account/user
 -> authorized workspace/project
 -> authorized editor instance
 -> current live connection generation
```

A client-supplied editor ID is a selector, not authorization. Cross-user command delivery is a critical failure.

## Early non-goals

Until the minimal local path and reliability core are verified, do not prioritize:

- hundreds of tools,
- multi-agent orchestration,
- billing/monetization infrastructure,
- Unity Hub automation,
- arbitrary third-party EditorWindow automation,
- TeamForge integration.

## Architecture change rule

Significant boundary/technology changes belong in `DECISIONS.md` with the evidence and trade-offs that caused the change. Do not silently rewrite architecture history.
