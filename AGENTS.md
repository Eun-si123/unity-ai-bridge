# AGENTS.md

Mandatory operating rules for AI agents and automated contributors working in this repository.

## 0. Prime directive

**Never convert an assumption into a repository fact.**

Repository evidence has priority over chat history, model memory, plans, other repositories, and intuition about how Unity/MCP probably works.

If evidence is missing, say **Unknown / Not verified / Planned** and continue only from what can be established.

## 1. Source-of-truth order

When deciding what is true:

1. current repository files and git history,
2. reproducible runtime/test output from the relevant revision,
3. `STATUS.md`,
4. accepted entries in `DECISIONS.md`,
5. `DESIGN.md`,
6. `ARCHITECTURE.md`,
7. `README.md`,
8. `ROADMAP.md`, issues, discussions, chat history, external sources.

Design/roadmap documents can describe things that do not exist yet. They are not implementation evidence.

## 2. What to read

### At the start of a new session or after losing project context

Read:

1. `AGENTS.md`
2. `STATUS.md`
3. `CODEMAP.md`
4. relevant parts of `DESIGN.md`
5. relevant accepted entries in `DECISIONS.md`

Read `ROADMAP.md` when planning milestone work, `ARCHITECTURE.md` when changing high-level boundaries, and `REFERENCES.md` when external projects/materials are relevant.

### Before a routine change

Do **not** reload every project document mechanically. Inspect the files/tests being changed plus the smallest relevant design/decision/status context needed to avoid contradiction.

The goal is grounding, not wasting context on unrelated documentation.

## 3. Status vocabulary

Use these meanings:

- **Planned** — desired, no implementation should be assumed.
- **In progress** — partial/incomplete implementation exists.
- **Implemented** — implementation exists but relevant runtime behavior may still be unverified.
- **Verified** — reproduced with evidence on a named revision/environment.
- **Blocked** — a named unresolved dependency/problem prevents progress.

Do not use `Implemented` for a design choice merely because it is written in a document. Use **Accepted design decision** instead.

Never write `works`, `done`, `fixed`, `supported`, or `passed` unless the claim is backed by the required verification or clearly qualified.

## 4. Before modifying code or architecture

- inspect the actual files involved,
- check whether the same capability already exists under another name,
- inspect relevant tests/recent commits when available,
- check accepted decisions before changing architecture,
- verify external provenance/license before copying or substantially adapting outside material.

Do not create duplicate subsystems because existing work was overlooked.

## 5. Architecture history

Do not silently reverse an accepted decision.

If new evidence changes a significant architecture choice:

1. collect the evidence,
2. add a new decision entry,
3. mark the old decision superseded where appropriate,
4. explain trade-offs/migration impact,
5. update design/status/code/tests consistently.

## 6. No hallucinated APIs, files, capabilities, or tests

Do not invent:

- Unity APIs/signatures,
- MCP methods/transports/schemas,
- package/runtime versions,
- files/directories,
- environment variables/endpoints,
- client/plugin capabilities,
- test commands/CI jobs,
- benchmark or runtime results.

Verify uncertain external behavior against current authoritative documentation and uncertain internal behavior against the repository/runtime.

## 7. Unity execution safety

Unless verified otherwise for a specific operation:

- treat Unity Editor API access as main-thread-sensitive,
- do not mutate Unity objects directly from network callbacks,
- route mutations through a controlled main-thread dispatcher,
- expect compilation/domain reload and reconnects,
- do not use transient `InstanceID` as the only durable identity,
- use stable identifiers/validation where practical,
- register Undo for editor mutations where practical,
- report dirty/unsaved state,
- do not silently save unless the tool contract requests it,
- do not block Unity's UI/main thread on network I/O,
- serialize conflicting writes by default,
- protect mutations against ambiguous retry/duplicate execution.

Arbitrary C# execution is a privileged capability, not a normal fallback.

## 8. Tool design

Every public tool/action should have, where applicable:

- a clear responsibility,
- explicit input schema,
- validation before mutation,
- structured success/error output,
- documented side effects,
- timeout/cancellation semantics for long operations,
- risk classification,
- verification behavior that distinguishes delivery from observed Unity completion.

Prefer a small reliable/composable surface over tool-count inflation. Do not introduce a giant `do_anything` escape hatch merely to claim broad coverage.

## 9. Security

Never commit real:

- API/OAuth keys or secrets,
- pairing/session tokens,
- private keys/certificates,
- service/database/cloud credentials,
- user project data or logs containing secrets.

Remote editor control is privileged and must fail closed.

For hosted routing:

- client-supplied editor/workspace IDs are selectors, not authorization,
- server-side ownership checks are mandatory,
- cross-user command delivery is a critical failure.

A future BYO-MCP feature must not become an unrestricted SSRF/arbitrary-server proxy.

## 10. External references, code reuse, and licenses

`REFERENCES.md` records projects/materials that influenced research. **Being listed there does not mean their source is incorporated.**

Before copying, porting, translating, or substantially adapting third-party implementation/material:

1. identify exact source and revision,
2. read the applicable license,
3. verify intended redistribution/commercial use is permitted,
4. preserve required notices/attribution,
5. record exact provenance and affected paths in the same change.

If an actual third-party notice/license file becomes required, add it **because incorporated material requires it**, not merely because another project was studied.

Feature ideas, public interoperability requirements, and known failure modes may be studied and independently implemented using authoritative Unity/MCP documentation where practical.

## 11. Public vs private repository boundary

This public repository is intended to hold the Unity/MCP core and self-hostable path.

Do not add production secrets, private deployment state, user databases, or sensitive hosted-service operations here.

The private infrastructure repository should compose/deploy the public core rather than maintain a divergent copy of it.

## 12. Documentation maintenance

After a meaningful change, update only the documents actually affected:

- `STATUS.md` — implementation/verification state,
- `CHANGELOG.md` — notable user-visible/project changes,
- `CODEMAP.md` — paths/responsibilities,
- `DESIGN.md` — detailed design,
- `DECISIONS.md` — significant architecture decisions/reversals,
- `ROADMAP.md` — milestone scope/status,
- `ARCHITECTURE.md` — high-level boundaries,
- `REFERENCES.md` — material external research/provenance context.

Documentation must not get ahead of the code.

## 13. Scope control

Before adding a subsystem, ask:

1. Is it needed for the current phase/exit gate?
2. Can an existing bounded primitive cover it safely?
3. Does it create a new security/maintenance burden?
4. Can it wait until there is a concrete need?

Prefer finishing one verified end-to-end path over starting many incomplete systems.

## 14. Error handling

- fail explicitly rather than pretending success,
- redact secrets while returning useful diagnostics,
- distinguish validation, policy/auth, transport, disconnect, timeout, stale-target, Unity API, and compile/reload failures,
- never turn an exception into success because the requested state probably happened,
- message delivery is not proof of Unity-side completion.

## 15. When uncertain

Use explicit wording such as:

- `Unknown: needs repository inspection.`
- `Implemented but not runtime-verified.`
- `Proposed only; no implementation exists yet.`
- `External behavior may have changed; verify current documentation.`
- `License compatibility has not been confirmed; do not copy code yet.`

Stop the unsupported claim, not the work.
