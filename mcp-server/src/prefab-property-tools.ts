import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  PrefabPropertyBridgeServer,
  type PrefabPropertyApplyOptions,
} from "./bridge/prefab-property-bridge-server.js";

const applyPropertyInputSchema = fromJsonSchema({
  type: "object",
  required: [
    "componentGlobalObjectId",
    "propertyPath",
    "prefabPath",
    "expectedPrefabDependencyHash",
    "expectedStateEpoch",
    "expectedStateRevision",
  ],
  properties: {
    componentGlobalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Exact Component GlobalObjectId on a live Regular Prefab instance. Use unity_get_components to discover it.",
    },
    propertyPath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact visible serialized property path currently marked as a Prefab override. The first slice supports Boolean, Integer, Float, String, and Vector3 non-array properties on non-Transform Components.",
    },
    prefabPath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact writable Regular Prefab Asset path under Assets. Nested/variant/package targets are rejected by this first slice.",
    },
    expectedPrefabDependencyHash: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Exact dependencyHash from a recent unity_inspect_prefab call. The apply fails if the Prefab Asset changed before execution.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional same-session retry identity. Reuse only for an ambiguous retry of this exact single-property apply intent.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Fresh active-scene state epoch from a recent observation.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description: "Fresh active-scene state revision from the same observation.",
    },
  },
  additionalProperties: false,
});

export function registerPrefabPropertyTools(
  server: McpServer,
  bridge: PrefabPropertyBridgeServer,
): void {
  server.registerTool(
    "unity_apply_prefab_property_override",
    {
      description:
        "Persist exactly one current visible Component property override from a live Regular Prefab instance to its exact Prefab Asset. This is intentionally narrower than Apply All. Requires the exact Component GlobalObjectId/property path, a fresh scene state token, and the exact Prefab dependencyHash. The operation is a destructive disk write with no bridge Undo guarantee; native verification requires the Prefab GUID to remain stable, dependencyHash to change, the instance override flag to clear, and source/instance SerializedProperty data to match.",
      inputSchema: applyPropertyInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          componentGlobalObjectId: string;
          propertyPath: string;
          prefabPath: string;
          expectedPrefabDependencyHash: string;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: PrefabPropertyApplyOptions = {
          componentGlobalObjectId: input.componentGlobalObjectId,
          propertyPath: input.propertyPath,
          prefabPath: input.prefabPath,
          expectedPrefabDependencyHash: input.expectedPrefabDependencyHash,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) options.mutationId = input.mutationId;

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "prefab.property.apply");
        requireAgentCapability(status, "state.revision.v1");
        const result = await bridge.requestApplyPrefabPropertyOverride(options);
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
