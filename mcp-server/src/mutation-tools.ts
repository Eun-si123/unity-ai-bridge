import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import { PrefabPropertyBridgeServer } from "./bridge/prefab-property-bridge-server.js";
import { requestMutationStatus } from "./bridge/mutation-status-bridge.js";

const mutationStatusInputSchema = fromJsonSchema({
  type: "object",
  required: ["mutationId"],
  properties: {
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Mutation id to inspect in the current Editor-session common mutation lifecycle journal. Absence is not proof that no side effect occurred because this first slice does not unify every operation-specific journal and does not survive a full Editor restart.",
    },
  },
  additionalProperties: false,
});

export function registerMutationTools(
  server: McpServer,
  bridge: PrefabPropertyBridgeServer,
): void {
  server.registerTool(
    "unity_get_mutation_status",
    {
      description:
        "Read the current-Editor-session common mutation lifecycle record for one mutationId without executing or replaying a write. The first slice covers mutations that use EditorMutationTransaction; Script, persistent Prefab/asset, Play Mode, and Test Runner journals are not yet unified. A not_found result is therefore not proof that a side effect never happened. The result never exposes the internal intent fingerprint and never claims blind retry is safe; follow recommendedAction and re-observe native Unity state before choosing a new mutationId.",
      inputSchema: mutationStatusInputSchema,
    },
    async (args) => {
      try {
        const input = args as { mutationId: string };
        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "mutation.status");

        const result = await requestMutationStatus(bridge, input.mutationId);
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
