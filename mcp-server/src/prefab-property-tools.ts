import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  PrefabPropertyBridgeServer,
  type PrefabPropertyApplyOptions,
} from "./bridge/prefab-property-bridge-server.js";
import { registerPlayModeTools } from "./play-mode-tools.js";
import { registerTestRunnerTools } from "./test-runner-tools.js";

const applyPrefabPropertyInputSchema = fromJsonSchema({
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
        "Exact GlobalObjectId of the scene Component that owns the existing Prefab property override.",
    },
    propertyPath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact visible SerializedProperty path on that Component, normally obtained from component inspection. m_Script and array properties/elements are rejected by the first bounded slice.",
    },
    prefabPath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      pattern: "^Assets/.+\\.[Pp][Rr][Ee][Ff][Aa][Bb]$",
      description:
        "Explicit writable Prefab Asset target under Assets. This is required even when Unity could infer a source because nested Prefabs can have multiple valid apply targets.",
    },
    expectedPrefabDependencyHash: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Exact dependencyHash from a recent inspection of prefabPath. The operation is rejected if the Prefab Asset changed before execution.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional retry identity. Reuse only for an ambiguous retry of this exact property/apply intent. If omitted, the bridge generates one.",
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

export function registerPrefabPropertyTools(
  server: McpServer,
  bridge: PrefabPropertyBridgeServer,
): void {
  registerPlayModeTools(server, bridge);
  registerTestRunnerTools(server, bridge);

  server.registerTool(
    "unity_apply_prefab_property_override",
    {
      description:
        "Persist exactly one existing non-array serialized property override from a scene Prefab instance into an explicitly selected writable Prefab Asset. This is a destructive-risk disk write with no Unity Undo claim. The tool requires a fresh scene state token plus the exact Prefab dependencyHash, rejects m_Script/array widening/Model Prefabs/non-Prefab targets, validates the explicit nested-Prefab apply target, and verifies native source/instance equality after ApplyPropertyOverride. It does not perform Apply All, component-wide apply, or automatic nested target selection.",
      inputSchema: applyPrefabPropertyInputSchema,
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
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );
}
