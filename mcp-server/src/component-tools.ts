import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  EditingBridgeServer,
  type ComponentInspectOptions,
} from "./bridge/editing-bridge-server.js";

const inspectInputSchema = fromJsonSchema({
  type: "object",
  required: ["gameObjectGlobalObjectId"],
  properties: {
    gameObjectGlobalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "GlobalObjectId of the GameObject whose attached Components and visible serialized properties should be inspected.",
    },
    maxComponents: {
      type: "integer",
      minimum: 1,
      maximum: 64,
      default: 32,
      description: "Maximum attached Component entries to return. Missing Script slots count toward this limit.",
    },
    maxPropertiesPerComponent: {
      type: "integer",
      minimum: 1,
      maximum: 256,
      default: 128,
      description:
        "Maximum visible SerializedProperty entries to return per non-missing Component.",
    },
    maxDepth: {
      type: "integer",
      minimum: 0,
      maximum: 8,
      default: 4,
      description:
        "Maximum SerializedProperty depth to include. Deeper visible property subtrees are skipped and reported as truncated.",
    },
  },
  additionalProperties: false,
});

export function registerComponentTools(
  server: McpServer,
  bridge: EditingBridgeServer,
): void {
  server.registerTool(
    "unity_get_components",
    {
      description:
        "Inspect the Components attached to one GameObject using Unity SerializedObject/SerializedProperty visibility rather than unrestricted reflection. Returns each Component's GlobalObjectId/type metadata, Missing Script slots, bounded visible serialized-property snapshots, object-reference identities when available, and a fresh stateEpoch/stateRevision for later safe edits.",
      inputSchema: inspectInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          gameObjectGlobalObjectId: string;
          maxComponents?: number;
          maxPropertiesPerComponent?: number;
          maxDepth?: number;
        };
        const options: ComponentInspectOptions = {
          gameObjectGlobalObjectId: input.gameObjectGlobalObjectId,
        };
        if (input.maxComponents !== undefined) {
          options.maxComponents = input.maxComponents;
        }
        if (input.maxPropertiesPerComponent !== undefined) {
          options.maxPropertiesPerComponent = input.maxPropertiesPerComponent;
        }
        if (input.maxDepth !== undefined) {
          options.maxDepth = input.maxDepth;
        }

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "component.inspect");
        requireAgentCapability(status, "state.revision.v1");

        const result = await bridge.requestInspectComponents(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );
}
