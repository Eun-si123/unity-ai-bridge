# Third-Party Notices and Provenance Log

This file tracks external projects, code, schemas, documentation, and other materials considered or incorporated by Unity AI Bridge.

## Mandatory rule

**Do not copy, port, translate, or substantially adapt external implementation code until its exact license and attribution requirements have been reviewed and recorded here.**

A GitHub repository being public does not automatically mean its code may be reused under our preferred terms.

## Status meanings

- **Reference only** — may be studied for ideas, interoperability, UX, feature coverage, or known bugs; no implementation code is intentionally incorporated.
- **Approved for reuse** — license reviewed for the intended use; exact obligations recorded.
- **Incorporated** — code or other copyrightable material is present in this repository; affected paths/revision must be listed.
- **Blocked** — license/provenance is unclear or incompatible with intended distribution.

## Candidate references

The projects below have been discussed as useful references. At repository bootstrap they are **Reference only** unless a later entry explicitly changes status.

### CoplayDev — MCP for Unity

- Repository: `https://github.com/CoplayDev/unity-mcp`
- Status: **Reference only**
- Potential reference areas: Unity/MCP architecture, tool design, remote/multi-instance behavior, compilation/reload handling, known issues.
- License for reuse: **must be re-verified at the exact revision before copying code.**
- Incorporated paths: none recorded.

### IvanMurzak — Unity-MCP

- Repository: `https://github.com/IvanMurzak/Unity-MCP`
- Status: **Reference only**
- Potential reference areas: Unity transport architecture, tool/prompt design, extensibility, main-thread execution patterns.
- License for reuse: **must be re-verified at the exact revision before copying code.**
- Incorporated paths: none recorded.

### AnkleBreaker Studio — Unity MCP projects

- Repository/project location: **verify exact repository before use**
- Status: **Reference only**
- Potential reference areas: breadth of Unity feature coverage, tool categorization, lazy/advanced tool exposure, multi-agent concepts.
- License for reuse: **not approved here; verify exact custom/current license before any implementation reuse.**
- Incorporated paths: none recorded.

## Provenance entry template

When external material is actually reused, add an entry like:

```text
Project:
Repository/URL:
Exact revision/tag:
License:
Status: Approved for reuse / Incorporated / Blocked
Material used:
Our affected paths:
Required notices/attribution:
Modifications made:
Reviewed by/date:
Notes:
```

## Independent implementation notes

It is acceptable to study public feature lists, interoperability requirements, public protocols, and known failure modes, then independently implement functionality using authoritative Unity/MCP documentation.

When doing so:

- do not copy distinctive source structure or documentation text,
- document when an external project materially influenced a design decision,
- use official Unity/MCP documentation as the implementation reference where practical,
- keep commit history clear enough to distinguish imported/adapted code from independently written code.

## Commercialization safety

Do not assume that "free to download" or "open source" means "safe for commercial redistribution." Before introducing a dependency or copied implementation, verify that its license is compatible with the project's intended ability to offer free, hosted, sponsored, or paid services in the future.
