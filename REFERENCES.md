# External References

This file records external projects and documents that have influenced research, requirements, interoperability thinking, or risk analysis for Unity AI Bridge.

**Reference does not mean reuse.** An entry here does not mean source code, documentation text, schemas, assets, or other copyrightable material from that project is included in this repository.

## Current implementation provenance

At this stage, Unity AI Bridge contains no recorded copied or substantially adapted implementation from the Unity MCP projects listed below.

If third-party code is ever actually incorporated, review the exact source revision and license first, preserve all required notices, and add the appropriate license/notice material at that time.

## Authoritative implementation references

### Model Context Protocol TypeScript SDK v2

- Documentation: `https://ts.sdk.modelcontextprotocol.io/v2/`
- Server API: `https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/`
- Checked: 2026-08-22.
- Use here: confirmed the v2 stable SDK line, split `@modelcontextprotocol/server` package, stdio bootstrap shape, and TypeScript/Node typing guidance used by the initial server scaffold.
- Source copied into this project: **No implementation source copied.** Public API usage follows the official SDK documentation.

### Node.js releases

- Download/releases: `https://nodejs.org/en/download`
- Checked: 2026-08-22.
- Use here: confirmed Node 24.19.0 as the current Node 24 LTS release used for the initial runtime pin.
- Source copied into this project: **No.**

### Unity 6000.3.21f1 release

- Release page: `https://unity.com/releases/editor/whats-new/6000.3.21f1`
- Checked: 2026-08-22.
- Use here: confirmed the exact initial Unity development target exists and was released on 2026-07-29.
- Source copied into this project: **No.**

### Unity package manifest documentation

- Documentation: `https://docs.unity3d.com/Manual/upm-manifestPkg.html`
- Checked: 2026-08-22.
- Use here: confirmed `unity` uses the major/minor form and `unityRelease` can identify a specific Unity patch/release in a package manifest.
- Source copied into this project: **No.**

## Research references

### CoplayDev — MCP for Unity

- Repository: `https://github.com/CoplayDev/unity-mcp`
- Use here: architecture/UX/tool-surface research, interoperability ideas, and known-failure-mode research.
- Source copied into this project: **No recorded reuse.**
- Reuse permission: must be checked against the exact revision and license before any copying or substantial adaptation.

### IvanMurzak — Unity-MCP

- Repository: `https://github.com/IvanMurzak/Unity-MCP`
- Use here: architecture, Unity execution model, extensibility, and tool-design research.
- Source copied into this project: **No recorded reuse.**
- Reuse permission: must be checked against the exact revision and license before any copying or substantial adaptation.

### AnkleBreaker Studio Unity MCP work

- Exact repository/project: **not pinned in this repository yet**.
- Use here: feature-coverage and tool-categorization research only.
- Source copied into this project: **No recorded reuse.**
- Reuse permission: not established; do not copy implementation without pinning the exact source and reviewing its current license.

## Research-to-implementation rule

When an external project suggests a useful capability:

1. treat the capability as a requirement or research lead, not as code to copy;
2. verify the underlying behavior against authoritative Unity/MCP documentation where practical;
3. implement independently unless there is a deliberate, license-reviewed reason to reuse code;
4. if copyrighted material is reused, record exact provenance and required notices in the same change.

## Adding a reference

For a material external influence, record:

```text
Project/document:
URL:
Exact revision/date if relevant:
What was learned/referenced:
Source copied or adapted: yes/no
If yes, license review location:
Notes:
```
