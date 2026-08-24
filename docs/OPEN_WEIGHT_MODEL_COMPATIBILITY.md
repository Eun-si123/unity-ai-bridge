# Open-Weight / Local Model Compatibility

Status: **Deferred compatibility target**  
Last reviewed: **2026-08-24**

This note records how Unity AI Bridge should think about users who run open-weight or self-hosted models locally.

## Decision summary

Open-weight and local-model users are part of the intended long-term compatibility surface, but Unity AI Bridge should **not** add model-specific runtimes, inference servers, prompt stacks, or duplicated Unity integrations during the current core phases.

The canonical boundary remains MCP.

```text
open-weight model
      |
local agent/runtime/harness
      |
      | MCP
      v
Unity AI Bridge MCP core
      |
bridge protocol
      |
Unity Editor Agent
```

If a local agent/runtime can act as an MCP host and use the public Unity AI Bridge tool contract, it should reuse the same Unity implementation as ChatGPT, Claude, Codex, Gemini, Cursor, or other hosts.

A raw model endpoint by itself is not considered an integration target. For example, an inference API that only exposes text/chat completion does not automatically provide tool discovery, tool invocation, approval behavior, retries, structured-result handling, or the agent loop required to operate Unity safely.

## Why this is deferred

Supporting open-weight models directly can quickly expand into several independent problems:

- model serving and hardware/runtime compatibility,
- agent-loop implementation,
- tool-call formatting differences,
- context-window and reasoning-capability differences,
- structured-output reliability,
- approval and destructive-action UX,
- local process/network lifecycle,
- model-specific prompting and recovery behavior,
- performance differences across small and large models.

Those concerns are important, but they are not Unity-control semantics. Pulling them into the current Unity core would make the project harder to verify and could create separate behavior for each model family.

The current priority is therefore:

1. make the provider-neutral Unity/MCP core reliable,
2. finish a useful bounded Unity editing surface,
3. build secure Remote MCP / Easy Connect,
4. prove portable integration and multi-client compatibility,
5. then evaluate local/open-weight agent runtimes against the same compatibility contract.

## Compatibility principle

The project should optimize for **capabilities, not model names**.

Future compatibility work should describe what an agent can reliably do, for example:

- discover and invoke MCP tools,
- follow JSON/structured schemas,
- preserve mutation IDs and state preconditions,
- recover from stale-state and replay errors,
- reason over bounded Unity observations,
- request confirmation for risky actions when required,
- complete multi-step workflows without silently bypassing safety contracts.

Do not hardcode behavior such as `if model == ...` into the Unity core.

## Future adaptive tool-surface idea

A later compatibility layer may expose different levels of abstraction according to host/model capabilities while keeping one underlying Unity command implementation:

```text
Workflow tools   -> smaller / less reliable agents
Semantic tools   -> general-purpose agents
Primitive tools  -> strong reasoning agents
```

Any such Adaptive Router should use explicit capability/profile information or observed compatibility evidence, not vendor/model-name branching.

This is a future design direction, not an implemented feature.

## What should stay out of the public Unity core

Unless a later architecture decision explicitly changes the boundary, the public Unity execution core should not become:

- an inference server,
- a model downloader/manager,
- a GPU scheduler,
- a general local-agent framework,
- a prompt framework duplicated for every model family,
- a compatibility shim that forks Unity semantics per model.

Optional adapters, examples, skills, or integration metadata may live outside the Unity execution core when real interoperability requirements justify them.

## Revisit trigger

Revisit this topic during the portable integration / multi-client compatibility phases when all of the following are true:

- the useful Unity editing core is stable enough to serve as a compatibility target,
- Remote MCP / Easy Connect has a trustworthy architecture,
- at least one production AI-host integration has been exercised end-to-end,
- there is a concrete local/open-weight agent runtime to test rather than a hypothetical model API,
- compatibility can be measured with a representative Unity workflow suite.

At that point, add a compatibility matrix for local/open-weight runtimes and decide whether optional adapters or an Adaptive Router are justified.

## Non-goal

This deferral does **not** mean open-weight models are unsupported in principle. It means Unity AI Bridge should avoid owning model-runtime complexity until the provider-neutral MCP/Unity core is strong enough to be a stable target for those runtimes.
