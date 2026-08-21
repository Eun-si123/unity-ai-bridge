# Architecture

> **Document state: target/proposed architecture.**
>
> Nothing in this document is proof that a component is implemented. `STATUS.md` is authoritative for implementation and verification status.

## 1. Problem statement

Unity AI Bridge aims to let an MCP-capable AI client inspect and safely modify a running Unity Editor project without requiring the user to manually understand the transport, Unity editor scripting, or MCP internals.

The project should remain useful with multiple AI providers rather than coupling its core to a single vendor.

## 2. Target high-level architecture

```text
+------------------------------+
| AI client / ChatGPT app      |
| MCP-capable client           |
+---------------+--------------+
                |
                | MCP
                v
+------------------------------+
| MCP server / gateway         |
| - tool schemas               |
| - auth/policy                |
| - routing                    |
| - request validation         |
+---------------+--------------+
                |
                | authenticated transport
                v
+------------------------------+
| Unity Editor package/agent   |
| - connection manager         |
| - command queue              |
| - object resolver            |
| - undo/dirty tracking        |
| - compile/reload handling    |
+---------------+--------------+
                |
                | Unity main thread
                v
+------------------------------+
| Unity Editor APIs            |
+------------------------------+
```

## 3. Architectural principles

### 3.1 Unity mutations happen through a controlled execution boundary

Network callbacks must not directly mutate Unity state. Commands should be validated, queued, and executed from an appropriate Unity main-thread context.

### 3.2 Read and write behavior are distinct

Read-only operations may eventually be parallelizable. Conflicting Unity mutations should be serialized unless proven safe by tests.

### 3.3 Stable identity over transient instance IDs

Do not build a protocol that depends only on Unity `InstanceID` values surviving reloads, scene changes, or editor restarts.

Preferred identity strategies may include:

- asset GUIDs,
- `GlobalObjectId` where appropriate,
- scene identity plus hierarchy path,
- component type plus validation metadata.

The exact resolver design is not yet selected.

### 3.4 Domain reload is a normal state transition

Script edits can trigger compilation and domain reload. Connection loss/recovery around reload must be treated as expected lifecycle behavior rather than a rare error.

### 3.5 Mutations should be recoverable

Where Unity supports it, editor mutations should integrate with Undo and return dirty/unsaved-state metadata.

### 3.6 Tools return evidence, not optimism

A successful transport round trip is not equivalent to a successful Unity operation. Tool results should distinguish validation, dispatch, Unity execution, compile/reload, and verification outcomes.

## 4. Proposed logical components

All components below are **Planned** until `STATUS.md` says otherwise.

### MCP core

Responsibilities:

- expose stable tool schemas,
- validate arguments,
- classify operation risk,
- convert Unity results into structured MCP responses,
- avoid provider-specific logic in the core.

### Unity agent/package

Responsibilities:

- maintain the connection to the MCP/gateway layer,
- queue commands,
- execute Unity API work safely,
- resolve targets,
- register Undo when practical,
- track scene/asset dirty state,
- handle compile/domain reload lifecycle,
- return structured errors/results.

### Gateway / remote connectivity

Responsibilities may eventually include:

- user authentication,
- pairing,
- per-user/per-project/per-editor routing,
- rate limits,
- connection presence,
- optional hosted access.

This is not required for the first local end-to-end milestone.

### Client/plugin adapters

ChatGPT/Claude/Gemini/other integrations should be thin adapters around the same MCP-compatible core where practical.

## 5. Tool strategy

The project should prioritize a small set of composable, well-tested tools instead of chasing a large tool count.

Candidate first tool families:

- editor/project status,
- scene/hierarchy read,
- GameObject lifecycle/transform,
- component inspection/mutation,
- console/compiler diagnostics,
- asset/prefab access,
- script operations,
- play mode/tests,
- Undo/recovery.

Advanced areas such as terrain, NavMesh, animation, lighting, VFX, Shader Graph, profiler/build tooling should be added based on proven demand and testability.

## 6. Privileged capabilities

The following should be considered high-risk and require explicit architecture/security review before public exposure:

- arbitrary C# execution,
- arbitrary filesystem access,
- shell/process execution,
- deleting/moving project assets,
- ProjectSettings changes,
- package installation,
- build/signing/deployment operations,
- arbitrary upstream/BYO MCP URLs.

A generic escape hatch can dramatically increase capability, but it also collapses safety boundaries. Do not add one merely to claim broad Unity coverage.

## 7. Multi-user / multi-editor model

Future hosted operation should distinguish at least:

```text
User
  -> Project/Workspace
      -> Unity Editor Instance
          -> Connection
```

Closing one Unity instance must not invalidate unrelated users or editor instances.

The detailed session model is not yet selected.

## 8. Public core vs hosted infrastructure

Target separation:

```text
unity-ai-bridge
  public/core protocol, Unity package, tool implementations, documentation

unity-ai-mcp-infra (or successor)
  hosted deployment/auth/operations where appropriate
```

Secrets and production data never belong in the public repository.

## 9. Non-goals for early milestones

Until the minimal path is verified, do not prioritize:

- hundreds of tools,
- multiple cloud providers,
- billing,
- marketplace monetization,
- multi-agent orchestration,
- full Unity Hub automation,
- arbitrary third-party EditorWindow UI automation,
- TeamForge integration,
- enterprise administration.

## 10. Architecture decision rule

When a design decision becomes real, record:

- the problem,
- alternatives considered,
- chosen approach,
- trade-offs,
- evidence/test implications.

Do not rewrite architectural history to make the current implementation look inevitable.
