# Unity AI Bridge — System Design

> **Document state: accepted design baseline, not implementation evidence.**
>
> This document records how the project intends to be built so that future contributors and AI agents can recover the design from the repository instead of relying on chat history or memory. `STATUS.md` remains authoritative for what is actually implemented and verified.

## 1. Product promise

Unity AI Bridge should make AI-assisted Unity Editor control usable by someone who does **not** know what MCP, ports, WebSockets, JSON-RPC, or Unity editor scripting are.

The desired beginner flow is eventually:

```text
Install Unity package
        ->
Click "Connect AI"
        ->
Receive a short pairing code
        ->
Connect from a supported AI client/app
        ->
Use natural language to inspect and edit Unity
```

Advanced users must still be able to self-host and inspect the open core.

## 2. Design priorities

In priority order:

1. **Correctness and recoverability** — a wrong mutation must not be disguised as success.
2. **Beginner usability** — the default path should hide infrastructure details.
3. **Safety** — remote editor control is privileged and must fail closed.
4. **Provider neutrality** — core Unity control must not depend on one LLM vendor.
5. **Open-core self-hostability** — core behavior should remain inspectable and runnable without the hosted service where practical.
6. **Extensibility** — advanced Unity domains can be added without destabilizing the core.
7. **Tool quality over tool count** — 15 reliable tools are better than 300 fragile ones.

## 3. Accepted high-level architecture

```text
+---------------------------------------------------------+
| AI client                                               |
| ChatGPT / Claude / Codex / Gemini / other MCP clients  |
+-----------------------------+---------------------------+
                              |
                              | MCP
                              | Streamable HTTP for remote
                              v
+---------------------------------------------------------+
| Public MCP Core / Gateway                               |
|                                                         |
|  Tool Registry      Validation       Risk Policy        |
|       |                 |                |              |
|       +-----------------+----------------+              |
|                         |                               |
|                   Session Router                        |
|                         |                               |
|              Request / Result Correlator                |
+-----------------------------+---------------------------+
                              |
                              | versioned bridge protocol
                              | WebSocket first implementation
                              v
+---------------------------------------------------------+
| Unity Editor Agent (C# package)                         |
|                                                         |
| Connection Manager  -> Command Queue -> Main Thread     |
|                              |                          |
|      Object Resolver   Undo/Dirty   Compile Watcher     |
|                              |                          |
|                       Unity Tool Handlers                |
+-----------------------------+---------------------------+
                              |
                              v
+---------------------------------------------------------+
| Unity Editor APIs                                       |
+---------------------------------------------------------+
```

Hosted production authentication, databases, deployment configuration, operational dashboards, and private service administration belong in the separate private infrastructure repository. The public repository owns the protocol and core behavior whenever practical.

## 4. Initial technology direction

### 4.1 Unity side

- Language: **C#**.
- Form: Unity Package Manager package, primarily Editor-side code for editor automation.
- Unity API mutations: dispatched on the Unity editor main thread.
- Network callbacks: never directly mutate Unity objects.

The exact Unity support matrix is not yet accepted. Do not infer support from the developer's currently installed Unity version.

### 4.2 MCP/server side

Initial implementation direction:

- Language: **TypeScript**.
- MCP implementation: official Model Context Protocol TypeScript SDK, modern v2 line unless repository testing identifies a blocker.
- Remote MCP transport: **Streamable HTTP**.
- Runtime: web-standard-compatible server code where practical, with Node/self-host support. The exact minimum Node version will be pinned when source scaffolding is created.

Why TypeScript initially:

- official MCP SDK support,
- strong schema/validation ecosystem,
- straightforward remote HTTP deployment,
- good compatibility with both self-hosted Node environments and web/serverless-style runtimes,
- keeps provider-specific integration code outside Unity C#.

Changing this choice requires a recorded decision in `DECISIONS.md` rather than an undocumented rewrite.

### 4.3 Unity <-> gateway transport

The first implementation should use a **transport abstraction with WebSocket as the first concrete transport**.

Local mode may connect over localhost WebSocket. Easy/hosted mode should use an outbound secure WebSocket from Unity to the gateway so normal users do not need router port forwarding or inbound firewall configuration.

The bridge protocol must not depend on raw WebSocket details so another transport can be added later if evidence justifies it.

## 5. Public open core vs private hosted infrastructure

### Public repository: `unity-ai-bridge`

Intended ownership:

- Unity package/agent,
- public bridge protocol,
- MCP tool schemas and handlers,
- validation and risk metadata,
- local/self-host server mode,
- reusable routing abstractions,
- tests,
- provider-neutral documentation,
- thin public integration metadata/adapters where appropriate.

### Private repository: `unity-ai-mcp-infra`

Intended ownership:

- production deployment configuration,
- production identity/auth integration,
- database provisioning/migrations specific to the hosted service,
- secret references and secret-manager wiring (never secret values),
- hosted rate limits/abuse controls,
- private operational dashboards/alerts/runbooks,
- production-only administration.

**Rule:** do not copy the public core into the private repository and allow two implementations to diverge. The private service should consume or deploy the public core through an explicit interface/version.

## 6. Operating modes

### Mode A — Local / developer mode

Purpose: fastest development and self-host testing.

```text
Local MCP client
   -> local public MCP server
   -> localhost bridge transport
   -> Unity Editor Agent
```

No hosted account should be required for this mode once implemented.

### Mode B — Easy Connect / hosted mode

Purpose: beginner-friendly use from cloud AI clients.

```text
AI client
   -> hosted MCP endpoint
   -> authenticated route
   -> outbound Unity connection
   -> Unity Editor Agent
```

The user should not need to configure ports or manually edit MCP JSON files in the intended final UX.

### Mode C — Self-hosted remote mode

Purpose: teams or advanced users who do not want the managed service.

The public gateway/core should be deployable by the user where practical. Exact packaging is a later milestone.

### Mode D — BYO MCP / adapter mode

Possible future mode only. This must not become a generic unrestricted proxy to arbitrary URLs. Security review, SSRF protection, capability restrictions, and explicit policy are required before implementation.

## 7. Bridge protocol

The MCP-facing tool call and the Unity-facing command are separate contracts.

A Unity command envelope should contain at least concepts equivalent to:

```text
protocolVersion
requestId
editorInstanceId or routed connection identity
operation
arguments
deadline/timeout metadata
risk metadata where needed
```

A result should contain at least:

```text
protocolVersion
requestId
ok
result
warnings
changedObjects / changedAssets when known
sceneOrAssetDirtyState
undoMetadata when applicable
compileState when applicable
error { category, code, message, details }
```

Exact JSON field names are not accepted until schemas are added to the repository.

### 7.1 Request correlation and idempotency

Every mutation must have a unique request identity.

The design must account for ambiguous retries. Example: if a network timeout occurs after Unity created a Cube but before the response reaches the server, blindly retrying `create GameObject` can create a second Cube.

Therefore mutation handling should support deduplication/idempotency semantics appropriate to the operation. A transport retry must not automatically mean "execute the Unity mutation again."

## 8. Unity command execution model

### 8.1 Main-thread dispatcher

Expected flow:

```text
network receive
   -> parse
   -> validate envelope
   -> enqueue command
   -> Unity main-thread dispatcher
   -> validate current target/state again
   -> register Undo if applicable
   -> execute Unity API
   -> collect observed result
   -> return structured response
```

Do not hold the Unity main thread while waiting on network I/O.

### 8.2 Write serialization

Conflicting writes are serialized by default. Parallel write execution is an optimization that must be justified by tests, not an initial assumption.

Reads may later be parallelized where the Unity API and state model make that safe.

### 8.3 Long-running operations

Builds, tests, asset imports, compilation, baking, and similar operations require explicit lifecycle states rather than one giant blocking tool call.

Possible states include:

```text
accepted -> queued -> running -> waiting_for_unity -> completed
                                      |             -> failed
                                      +------------- -> cancelled/timeout
```

The exact task API is a later design decision.

## 9. Object identity and resolution

Unity `InstanceID` alone is not a durable protocol identity.

The resolver should use the strongest available identity depending on target type:

- asset GUID for assets,
- `GlobalObjectId` where suitable,
- scene identity + hierarchy path + validation metadata for scene objects when needed,
- component type + owning object identity for components,
- optional transient InstanceID only as a hint/optimization.

Before a mutation, the resolved object must be checked against expected identity metadata to reduce stale-target mistakes.

## 10. Compilation and domain reload

Script editing is a multi-step workflow, not a normal synchronous write.

Target lifecycle:

```text
write script
  -> Unity imports/compiles
  -> possible domain reload
  -> bridge connection may disappear
  -> agent reconnects
  -> compile watcher reports final state
  -> caller inspects compiler errors
  -> continuation is allowed only with current evidence
```

Connection identity and pending task recovery must explicitly account for domain reload.

## 11. Undo, dirty state, and saving

For editor mutations where Unity supports it:

- register Undo before mutation,
- return whether a scene/asset became dirty,
- do not silently save user work unless the tool contract explicitly requests save,
- distinguish "mutation succeeded" from "persisted to disk."

A later transaction/grouping mechanism may allow several AI operations to be undone as one logical action.

## 12. Tool API strategy

The project will **not** begin by exposing hundreds of independent tools.

Initial target is roughly 10–20 stable domain tools or tool families. A likely direction is:

1. `unity_status`
2. `unity_scene`
3. `unity_hierarchy`
4. `unity_gameobject`
5. `unity_component`
6. `unity_console`
7. `unity_asset`
8. `unity_prefab`
9. `unity_script`
10. `unity_playmode`
11. `unity_test`
12. `unity_undo`
13. package/build tools later

Names and schemas are not accepted API until implemented and versioned.

Tool design principles:

- prefer a stable domain tool with explicit typed actions when that reduces tool explosion,
- avoid one giant `do_anything` tool,
- avoid arbitrary C# execution in early public releases,
- promote frequently needed, safely testable workflows into dedicated actions,
- allow advanced capabilities to be discovered/loaded without forcing every client to ingest hundreds of schemas at once.

## 13. Risk model

Every operation should eventually carry one of these conceptual risk classes:

### READ

No intended Unity/project mutation.

Examples: status, hierarchy read, console read.

### WRITE

Reversible or bounded project/editor mutation.

Examples: transform change, component property edit.

### DESTRUCTIVE

Can delete/overwrite or cause broad project changes.

Examples: delete asset, replace scene contents, package changes.

### PRIVILEGED

Escapes normal bounded Unity tool semantics or affects external systems.

Examples: arbitrary C# execution, filesystem access outside project scope, shell/process execution, signing/deployment credentials.

Privileged capabilities are not part of the early core merely to increase apparent feature coverage.

## 14. Result and error model

The bridge should distinguish at least:

- schema/validation error,
- authentication/authorization error,
- no matching editor connection,
- stale/ambiguous object target,
- queued/running timeout,
- Unity API exception,
- compile/import/domain-reload state,
- disconnected editor,
- policy/confirmation rejection,
- unsupported Unity/version capability,
- internal gateway/transport failure.

`success: true` must mean the requested contract was observed as completed, not merely that a message was delivered.

## 15. Multi-user and multi-editor routing

Hosted routing must model at least:

```text
Account/User
  -> Workspace/Project binding
      -> Editor instance
          -> live connection
```

Security invariants:

- an authenticated user can route only to editor instances they own or were explicitly granted,
- editor IDs supplied by a client are selectors, not authorization,
- server-side ownership checks are mandatory,
- closing one editor connection must not stop unrelated connections,
- reconnecting one editor must not steal another editor's route,
- cross-user command delivery is a critical-severity failure.

## 16. Pairing design target

Easy Connect should eventually use a short-lived human-friendly pairing flow.

Target concept:

1. Unity Agent establishes an outbound unaffiliated/limited connection.
2. Gateway issues a short-lived pairing code/challenge.
3. User approves/binds that connection from the AI/app/account side.
4. Gateway replaces pairing authority with scoped long-lived connection credentials.
5. Pairing code expires and cannot be used as a permanent credential.

Exact cryptography, credential storage, account system, and expiration values are **not yet selected**.

## 17. Reconnection model

Reconnection is expected, not exceptional.

The connection manager must account for:

- Unity domain reload,
- editor restart,
- laptop sleep/network changes,
- hosted gateway restart,
- stale sockets,
- duplicate simultaneous connection attempts.

Use explicit connection epochs/generations so a delayed message from an old connection cannot mutate a newly reconnected editor session.

## 18. Testing architecture

Each layer should be testable without requiring the entire product stack.

### Protocol/schema tests

- valid/invalid tool arguments,
- serialization round-trips,
- version compatibility,
- request deduplication behavior,
- error normalization.

### Server/router tests

- tool registration,
- authorization boundaries,
- route selection,
- timeout/cancellation,
- disconnect/reconnect,
- two users/two editors isolation.

### Unity EditMode tests

- command dispatcher,
- object resolver,
- Undo registration,
- dirty-state reporting,
- GameObject/component operations,
- compile-state helpers where testable.

### End-to-end tests

First required path:

```text
MCP call
 -> server
 -> bridge transport
 -> Unity main thread
 -> Unity API
 -> structured result
 -> state re-read proves requested effect
```

A feature is not `Verified` solely because a unit test mocks the Unity side.

## 19. Compatibility and versioning

There are three independent compatibility surfaces:

1. MCP protocol/client compatibility,
2. bridge protocol compatibility,
3. Unity version/API compatibility.

Do not tie all three to one implicit version number.

The bridge protocol should be explicitly versioned from the first real implementation.

Tool schemas should evolve conservatively. Breaking public changes require migration notes.

## 20. Expansion strategy

After the reliable core works, advanced domains may include:

- Terrain,
- NavMesh,
- Animation/Animator,
- UI/UI Toolkit,
- Lighting,
- particles/VFX,
- Shader Graph,
- profiler/memory/frame debugging,
- builds and package management,
- Multiplayer Play Mode,
- screenshots/GameView inspection,
- custom extension tools.

New domains should be added because they are useful and testable, not to reach a marketing tool count.

## 21. Explicit early non-goals

Not early milestones:

- reproducing every feature of another Unity MCP repository,
- 300+ direct tools,
- arbitrary operating-system GUI automation,
- Unity Hub account automation,
- arbitrary third-party EditorWindow automation,
- billing/monetization infrastructure,
- TeamForge integration,
- multi-agent orchestration.

## 22. How future agents should use this document

When returning to this project after losing conversation context:

1. read `AGENTS.md`,
2. read `STATUS.md`,
3. read `DESIGN.md`,
4. read `DECISIONS.md`,
5. read `ROADMAP.md`,
6. inspect `CODEMAP.md` and current source/tests,
7. continue only from repository evidence.

If the implementation proves a design assumption wrong, **do not silently edit history**. Add a new decision entry explaining what changed and why, then update this document.