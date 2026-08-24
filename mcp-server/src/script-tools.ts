import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  ScriptBridgeServer,
  type ScriptReadOptions,
  type ScriptReplaceOptions,
} from "./bridge/script-bridge-server.js";

const scriptReadInputSchema = fromJsonSchema({
  type: "object",
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      pattern: "^(Assets|Packages)/.+\\.[Cc][Ss]$",
      description:
        "Exact project-relative Unity C# script asset path under Assets or Packages. Use forward slashes; traversal segments are rejected.",
    },
    offset: {
      type: "integer",
      minimum: 0,
      maximum: 2147483647,
      default: 0,
      description:
        "Zero-based UTF-16 code-unit offset into the decoded UTF-8 source. Use nextOffset from a previous result to continue reading without overlap.",
    },
    maxChars: {
      type: "integer",
      minimum: 1,
      maximum: 100000,
      default: 20000,
      description:
        "Maximum UTF-16 code units to return in this chunk. The command never intentionally splits a UTF-16 surrogate pair.",
    },
  },
  additionalProperties: false,
});

const scriptReplaceInputSchema = fromJsonSchema({
  type: "object",
  required: ["path", "expectedGuid", "expectedContentSha256", "content"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      pattern: "^Assets/.+\\.[Cc][Ss]$",
      description:
        "Exact canonical existing Assets/*.cs path from unity_read_script. Package scripts are intentionally read-only in this write slice.",
    },
    expectedGuid: {
      type: "string",
      pattern: "^[0-9A-Fa-f]{32}$",
      description:
        "Exact script GUID from the same recent unity_read_script observation. The write fails if path identity changed.",
    },
    expectedContentSha256: {
      type: "string",
      pattern: "^[0-9A-Fa-f]{64}$",
      description:
        "Exact raw-file SHA-256 from the same recent unity_read_script observation. This mandatory compare-and-swap precondition prevents overwriting concurrent edits.",
    },
    content: {
      type: "string",
      maxLength: 128000,
      description:
        "Complete desired C# source text. Existing UTF-8 BOM presence is preserved; newline characters are used exactly as supplied. First slice is capped at 128,000 UTF-16 code units and 512 KiB UTF-8 body bytes.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional same-intent retry identity. Reuse ONLY to reconcile an ambiguous delivery of this exact path/GUID/old-SHA/replacement. The bridge never blindly repeats an already-started source write.",
    },
  },
  additionalProperties: false,
});

export function registerScriptTools(server: McpServer, bridge: ScriptBridgeServer): void {
  server.registerTool(
    "unity_read_script",
    {
      description:
        "Read a bounded chunk of one exact Unity C# script asset without mutating the project. Returns canonical path/GUID, imported dependencyHash, raw-file SHA-256, UTF-8/BOM metadata, byte/character/line counts, deterministic offset paging, and truncation metadata. Use the returned GUID + contentSha256 as the required optimistic-concurrency observation for unity_replace_script.",
      inputSchema: scriptReadInputSchema,
    },
    async (args) => {
      try {
        const input = args as { path: string; offset?: number; maxChars?: number };
        const options: ScriptReadOptions = { path: input.path };
        if (input.offset !== undefined) options.offset = input.offset;
        if (input.maxChars !== undefined) options.maxChars = input.maxChars;

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "script.read");
        const result = await bridge.requestReadScript(options);
        return success(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_replace_script",
    {
      description:
        "Persistently replace the COMPLETE contents of one existing Assets/*.cs script using mandatory path + GUID + raw contentSha256 compare-and-swap preconditions from unity_read_script. This is a destructive persistent source-file write, not Unity Undo. Package scripts are rejected. The bridge records at-most-once mutation identity before writing, verifies the exact new raw SHA, requests Unity import, tolerates the expected compile/domain-reload disconnect, reconnects to the same Editor, observes a later compilation snapshot when available, and performs fresh post-reload script readback. Compiler errors are reported as compileStatus='failed' while preserving the fact that the requested source bytes were written; do not interpret compile failure as file-write failure or blindly retry with a new mutationId.",
      inputSchema: scriptReplaceInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          path: string;
          expectedGuid: string;
          expectedContentSha256: string;
          content: string;
          mutationId?: string;
        };
        const options: ScriptReplaceOptions = {
          path: input.path,
          expectedGuid: input.expectedGuid,
          expectedContentSha256: input.expectedContentSha256,
          content: input.content,
        };
        if (input.mutationId !== undefined) options.mutationId = input.mutationId;

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "script.replace");
        const result = await bridge.requestReplaceScript(options);
        return success(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function success(result: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function toolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
