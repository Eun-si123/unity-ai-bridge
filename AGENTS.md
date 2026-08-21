# AGENTS.md

Mandatory operating rules for AI agents and automated contributors working in this repository.

## 0. Prime directive

**Never convert an assumption into a repository fact.**

Repository evidence has priority over:

1. chat history,
2. model memory,
3. plans and roadmaps,
4. other repositories,
5. intuition about how Unity/MCP "probably" works.

If evidence is missing, say **unknown / not verified** and investigate before changing status documentation.

## 1. Source-of-truth order

Use this order when deciding what is true:

1. Current repository files and git history.
2. Reproducible runtime/test output from the current revision.
3. `STATUS.md` verified entries.
4. `DECISIONS.md` accepted architecture decisions.
5. `DESIGN.md` accepted design baseline.
6. `ARCHITECTURE.md` high-level architecture/boundaries.
7. `README.md` overview.
8. `ROADMAP.md` future direction only.
9. Issues, discussions, chat history, external documentation.

If these disagree, do not silently choose one. Reconcile the conflict and update stale documentation.

**Important:** `DESIGN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `ROADMAP.md` can describe things that do not exist yet. They are not implementation evidence.

## 2. Implementation status vocabulary

Use only these meanings:

- **Planned** — desired, but no implementation should be assumed.
- **In progress** — implementation exists but is incomplete or unverified.
- **Implemented** — code exists, but runtime behavior may still be unverified.
- **Verified** — exercised with reproducible evidence on the current or explicitly named revision.
- **Blocked** — cannot proceed because a named dependency/problem is unresolved.

Never write "works", "done", "fixed", "supported", or "passed" unless the evidence meets the **Verified** definition or the sentence clearly says it is only implemented/not yet tested.

## 3. Before modifying anything

An agent must read, in this order:

1. `AGENTS.md`
2. `STATUS.md`
3. `DESIGN.md`
4. `DECISIONS.md`
5. `ROADMAP.md`
6. `ARCHITECTURE.md`
7. `CODEMAP.md`
8. `THIRD_PARTY_NOTICES.md`

Then:

1. inspect the files it plans to change,
2. check whether the same feature already exists under another name,
3. check relevant tests and recent commits when available,
4. identify third-party provenance before copying or adapting external code.

Do not create duplicate systems because an existing implementation was overlooked.

## 4. Do not silently reverse accepted design decisions

`DECISIONS.md` exists so that future contributors do not repeatedly redesign the project from memory.

If current evidence suggests an accepted decision is wrong:

1. gather the evidence,
2. add a new numbered decision,
3. mark the old decision `Superseded`,
4. explain the trade-off and migration impact,
5. update `DESIGN.md` and relevant code/tests.

Do not simply delete or rewrite the old rationale to make the new architecture look inevitable.

## 5. No hallucinated APIs, files, tools, or test results

Do not invent:

- Unity APIs or signatures,
- MCP methods, transports, schemas, or capabilities,
- package names/versions,
- directories or files that do not exist,
- environment variables,
- server endpoints,
- plugin capabilities,
- test commands,
- CI jobs,
- benchmark results,
- successful runtime behavior.

When an API or version is uncertain, verify it against authoritative documentation or the dependency actually used by the repository.

## 6. Plans are not implementation

`DESIGN.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, issues, TODOs, examples, and code blocks may describe future behavior. Their existence does not mean the feature exists.

When documenting proposed structures, label them **Planned**, **Proposed**, **Target architecture**, or otherwise make the status explicit.

`STATUS.md` is the canonical list of what actually exists.

## 7. Verification requirements

For every functional change, perform the strongest available verification and record what was actually run.

Preferred order:

1. automated unit/integration tests,
2. compile/build checks,
3. Unity EditMode/PlayMode tests,
4. protocol/tool-call integration checks,
5. manual reproduction with captured output.

If verification cannot be performed, state that explicitly. Never substitute code inspection for runtime verification without saying so.

A verification record should include, when relevant:

- date,
- revision/commit,
- environment (OS, Unity version, runtime version),
- exact command/action,
- expected result,
- observed result,
- known limitations.

## 8. Unity-specific safety rules

Unless a verified implementation proves otherwise:

- Treat Unity Editor API calls as main-thread-sensitive.
- Route network callbacks through a main-thread command queue before touching Unity objects.
- Expect script changes to trigger compilation/domain reload and possible reconnection.
- Do not rely only on transient instance IDs across reloads/scenes.
- Use stable identifiers where possible (asset GUIDs, `GlobalObjectId`, hierarchy identity plus validation).
- Register Undo for editor mutations where practical.
- Report dirty scenes/assets and do not silently save user work unless the tool contract explicitly permits it.
- Avoid blocking network I/O on `OnGUI`, `EditorApplication.update`, or other editor UI/main-thread paths.
- Serialize conflicting write operations unless the operation is explicitly designed and tested for concurrency.
- Treat arbitrary C# execution as a privileged/high-risk capability, not a normal fallback.
- Treat reconnect/domain reload as normal lifecycle, not a rare exceptional path.
- Protect mutations against ambiguous retries/duplicate request execution.

## 9. MCP/tool design rules

Every public tool should have:

- one clear responsibility,
- explicit input schema,
- validation before Unity mutation,
- structured success/error output,
- deterministic behavior where practical,
- cancellation/timeout behavior for long operations,
- documented side effects,
- explicit destructive-risk classification where applicable.

Follow the design baseline in `DESIGN.md` and accepted choices in `DECISIONS.md`.

Prefer composable high-quality tools over inflating the tool count.

Do not expose hundreds of tools merely to match another project. Add tools because they improve reliability, safety, or usability.

Do not replace missing bounded tools with arbitrary code execution unless a later accepted decision explicitly introduces and gates that privileged capability.

## 10. Security rules

Never commit:

- API keys,
- OAuth secrets,
- pairing tokens,
- private certificates/keys,
- service credentials,
- user project contents or logs containing secrets.

Remote control is privileged. Authentication must fail closed.

Do not let a user-selected upstream MCP URL become an unrestricted server-side request primitive. BYO-MCP/gateway features require allowlisting/validation, authentication boundaries, request limits, and SSRF protections before public release.

Destructive operations must be clearly marked and should support confirmation/policy controls at the client or gateway layer.

In hosted routing, a client-provided editor/workspace identifier is a selector, **not authorization**. Server-side ownership checks are mandatory.

Cross-user command delivery is a critical-severity failure.

## 11. Third-party code and licensing

Before copying, porting, translating, or substantially adapting code from another repository:

1. identify the exact repository and revision,
2. read its license,
3. record it in `THIRD_PARTY_NOTICES.md`,
4. preserve required copyright/license notices,
5. confirm that the intended distribution/commercial model is permitted.

Feature ideas and interoperability requirements may be studied, but do not copy implementations whose license is incompatible or unclear.

Do not describe independently written code as copied from an upstream project, and do not describe copied/adapted code as fully original.

## 12. Public vs infrastructure separation

This repository is intended to hold the public/core implementation.

Do not add production secrets, private deployment state, user databases, or sensitive hosted-service internals here merely because a related infrastructure repository exists.

When the project uses a separate infrastructure repository, keep the interface between the two documented and minimal.

Do not duplicate the public core into the private infrastructure repository and allow the copies to diverge.

## 13. Documentation maintenance

After a meaningful change:

- update `STATUS.md` if implementation/verification status changed,
- update `CHANGELOG.md` for user-visible changes,
- update `CODEMAP.md` when paths/responsibilities change,
- update `DESIGN.md` when detailed design changes,
- update `DECISIONS.md` for significant architecture choices/reversals,
- update `ROADMAP.md` when milestone scope/status changes,
- update `ARCHITECTURE.md` for high-level boundaries,
- update `THIRD_PARTY_NOTICES.md` when provenance changes.

Documentation must not get ahead of the code.

## 14. Scope control

The project should not become large merely to look complete.

Before adding a subsystem, ask:

1. Is it needed for the current roadmap phase/exit gate?
2. Can an existing safe generic primitive cover it?
3. Does it create a new security/maintenance burden?
4. Can it be postponed until actual users need it?

Prefer finishing one end-to-end path over starting many incomplete systems.

`ROADMAP.md` deliberately puts remote hosting and advanced Unity domains after the local reliability core. Do not skip those gates merely because later work is more exciting.

## 15. Error handling philosophy

- Fail explicitly rather than pretending success.
- Return enough context to diagnose the failure, but redact secrets.
- Distinguish validation errors, Unity errors, transport errors, timeouts, disconnected editor state, compile/reload state, stale target state, and permission errors.
- Never convert an exception into `success: true` because the requested final state "probably" happened.
- Delivery of a command is not proof of Unity-side completion.

## 16. When uncertain

Stop the assumption, not the project.

Use one of these forms:

- `Unknown: needs repository inspection.`
- `Implemented but not runtime-verified.`
- `Proposed only; no implementation exists yet.`
- `External behavior may have changed; verify current documentation.`
- `License compatibility has not been confirmed; do not copy code yet.`
- `This conflicts with an accepted decision; add/supersede a decision before changing architecture.`

That is preferable to a confident hallucination.
