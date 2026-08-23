import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  AssetBridgeServer,
  type AssetInspectOptions,
  type AssetSearchOptions,
  type PrefabInspectOptions,
  type PrefabInstantiateOptions,
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
      items: { type: "string", minLength: 1, maxLength: 512 },
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

const prefabInspectInputSchema = fromJsonSchema({
  type: "object",
  required: ["path"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description: "Exact project-relative Prefab Asset path under Assets or Packages.",
    },
    maxDepth: {
      type: "integer",
      minimum: 0,
      maximum: 32,
      default: 8,
      description: "Maximum Prefab hierarchy depth to return, with the Prefab root at depth 0.",
    },
    maxNodes: {
      type: "integer",
      minimum: 1,
      maximum: 500,
      default: 100,
      description: "Maximum Prefab hierarchy nodes to return in deterministic preorder.",
    },
  },
  additionalProperties: false,
});

const prefabInstantiateInputSchema = fromJsonSchema({
  type: "object",
  required: [
    "prefabPath",
    "expectedPrefabDependencyHash",
    "expectedStateEpoch",
    "expectedStateRevision",
  ],
  properties: {
    prefabPath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description: "Exact Prefab Asset path from a recent prefab/asset inspection.",
    },
    expectedPrefabDependencyHash: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Exact dependencyHash from a recent inspection of the same Prefab Asset. The write fails if the Prefab changed before execution.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional retry identity. Reuse only for an ambiguous retry of this exact instantiate intent. If omitted, the bridge generates one.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Required active-scene state epoch from a recent Unity observation.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description: "Required active-scene state revision from the same observation.",
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
        const input = args as { filter?: string; searchInFolders?: string[]; maxResults?: number };
        const options: AssetSearchOptions = {};
        if (input.filter !== undefined) options.filter = input.filter;
        if (input.searchInFolders !== undefined) options.searchInFolders = input.searchInFolders;
        if (input.maxResults !== undefined) options.maxResults = input.maxResults;
        await preflight(bridge, "asset.search");
        const result = await bridge.requestSearchAssets(options);
        return success(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_inspect_asset",
    {
      description:
        "Inspect one exact Unity asset file through AssetDatabase. Returns GUID/path/main asset type and identity, importer type, labels, Unity dependency hash, and a bounded list of direct asset dependencies. This surface is read-only.",
      inputSchema: inspectInputSchema,
    },
    async (args) => {
      try {
        const input = args as { path: string; maxDependencies?: number };
        const options: AssetInspectOptions = { path: input.path };
        if (input.maxDependencies !== undefined) options.maxDependencies = input.maxDependencies;
        await preflight(bridge, "asset.inspect");
        const result = await bridge.requestInspectAsset(options);
        return success(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_inspect_prefab",
    {
      description:
        "Inspect one exact Prefab Asset without instantiating it. Returns GUID/dependencyHash/Prefab asset type/root name and a bounded preorder hierarchy with component type names. Use the dependencyHash as the Prefab precondition for unity_instantiate_prefab.",
      inputSchema: prefabInspectInputSchema,
    },
    async (args) => {
      try {
        const input = args as { path: string; maxDepth?: number; maxNodes?: number };
        const options: PrefabInspectOptions = { path: input.path };
        if (input.maxDepth !== undefined) options.maxDepth = input.maxDepth;
        if (input.maxNodes !== undefined) options.maxNodes = input.maxNodes;
        await preflight(bridge, "prefab.inspect");
        const result = await bridge.requestInspectPrefab(options);
        return success(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_instantiate_prefab",
    {
      description:
        "Instantiate one exact Prefab Asset as a root GameObject in the active scene while preserving its Prefab connection. Requires both a fresh active-scene state token and the Prefab dependencyHash observed by inspection. Unity records Undo, verifies native Prefab linkage, enforces the execution deadline, and protects ambiguous retries with mutationId replay rules.",
      inputSchema: prefabInstantiateInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          prefabPath: string;
          expectedPrefabDependencyHash: string;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: PrefabInstantiateOptions = {
          prefabPath: input.prefabPath,
          expectedPrefabDependencyHash: input.expectedPrefabDependencyHash,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) options.mutationId = input.mutationId;
        await preflight(bridge, "prefab.instantiate", "state.revision.v1");
        const result = await bridge.requestInstantiatePrefab(options);
        return success(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

async function preflight(bridge: AssetBridgeServer, ...capabilities: string[]): Promise<void> {
  const status = await bridge.requestEditorStatus();
  for (const capability of capabilities) {
    requireAgentCapability(status, capability);
  }
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
