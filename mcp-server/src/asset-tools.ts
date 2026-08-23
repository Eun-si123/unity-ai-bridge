import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  AssetBridgeServer,
  type AssetInspectOptions,
  type AssetSearchOptions,
} from "./bridge/asset-bridge-server.js";

const searchInputSchema = fromJsonSchema({
  type: "object",
  properties: {
    filter: {
      type: "string",
      maxLength: 256,
      default: "",
      description:
        "Unity AssetDatabase search filter. Supports Unity name/type/label syntax such as 'Player t:Prefab' or 't:Material'. Empty filter is allowed but results are still bounded.",
    },
    searchInFolders: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      default: ["Assets"],
      items: {
        type: "string",
        minLength: 1,
        maxLength: 512,
      },
      description:
        "Project-relative Unity folders to search recursively. Paths must be under Assets or Packages and use forward slashes.",
    },
    maxResults: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 50,
      description: "Maximum deterministic path-sorted asset entries to return.",
    },
  },
  additionalProperties: false,
});

const inspectInputSchema = fromJsonSchema({
  type: "object",
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact project-relative asset file path returned by asset search, under Assets or Packages. Folder paths are rejected.",
    },
    maxDependencies: {
      type: "integer",
      minimum: 0,
      maximum: 256,
      default: 64,
      description:
        "Maximum direct dependency entries to return. Set to 0 to omit dependency entries while retaining the total direct dependency count.",
    },
  },
  additionalProperties: false,
});

export function registerAssetTools(server: McpServer, bridge: AssetBridgeServer): void {
  server.registerTool(
    "unity_search_assets",
    {
      description:
        "Search Unity's AssetDatabase without touching the filesystem directly. Returns a bounded deterministic list of GUID/path/name/extension/main-type entries and explicit truncation metadata. Defaults to searching Assets only.",
      inputSchema: searchInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          filter?: string;
          searchInFolders?: string[];
          maxResults?: number;
        };
        const options: AssetSearchOptions = {};
        if (input.filter !== undefined) options.filter = input.filter;
        if (input.searchInFolders !== undefined) options.searchInFolders = input.searchInFolders;
        if (input.maxResults !== undefined) options.maxResults = input.maxResults;

        await preflight(bridge, "asset.search");
        const result = await bridge.requestSearchAssets(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_inspect_asset",
    {
      description:
        "Inspect one exact Unity asset file through AssetDatabase. Returns GUID/path/main asset type and identity, importer type, labels, Unity dependency hash, and a bounded list of direct asset dependencies. This first slice is read-only and does not expose importer mutation.",
      inputSchema: inspectInputSchema,
    },
    async (args) => {
      try {
        const input = args as { path: string; maxDependencies?: number };
        const options: AssetInspectOptions = { path: input.path };
        if (input.maxDependencies !== undefined) {
          options.maxDependencies = input.maxDependencies;
        }

        await preflight(bridge, "asset.inspect");
        const result = await bridge.requestInspectAsset(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

async function preflight(bridge: AssetBridgeServer, capability: string): Promise<void> {
  const status = await bridge.requestEditorStatus();
  requireAgentCapability(status, capability);
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
