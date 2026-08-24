import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import { ScriptBridgeServer, type ScriptReadOptions } from "./bridge/script-bridge-server.js";

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

export function registerScriptTools(server: McpServer, bridge: ScriptBridgeServer): void {
  server.registerTool(
    "unity_read_script",
    {
      description:
        "Read a bounded chunk of one exact Unity C# script asset without mutating the project. Returns canonical path/GUID, imported dependencyHash, raw-file SHA-256, UTF-8/BOM metadata, byte/character/line counts, deterministic offset paging, and truncation metadata. The raw contentSha256 is intended to become the optimistic-concurrency precondition for the later script replace workflow.",
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
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );
}
