import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  requestBridgeActionHistory,
  requestUndoLastBridgeAction,
} from "./bridge/action-bridge.js";
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

const actionHistoryInputSchema = fromJsonSchema({
  type: "object",
  properties: {
    maxResults: {
      type: "integer",
      minimum: 1,
      maximum: 32,
      default: 10,
      description:
        "Maximum number of current-session bridge action records to return, newest first. Only the newest record can ever report safeToUndoNow=true.",
    },
  },
  additionalProperties: false,
});

const undoLastActionInputSchema = fromJsonSchema({
  type: "object",
  required: ["mutationId", "expectedStateEpoch", "expectedStateRevision"],
  properties: {
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Exact mutationId of the latest bridge action returned by unity_get_bridge_action_history. Older mutation IDs are rejected; this is not arbitrary historical rollback.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Exact current state epoch from the same recent action-history/native-state observation used to decide that the latest action is safe to Undo.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description:
        "Exact current state revision from the same observation. Any intervening Unity state change rejects the Undo before execution.",
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
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_get_bridge_action_history",
    {
      description:
        "Read a bounded newest-first history of current-Editor-session Unity AI Bridge scene mutations that produced verified Unity Undo records. The history is not a promise that older actions remain undoable. Only the latest action may report safeToUndoNow=true, and that requires the current scene state token plus Unity's current Undo group/name to still exactly match the recorded action.",
      inputSchema: actionHistoryInputSchema,
    },
    async (args) => {
      try {
        const input = args as { maxResults?: number };
        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "action.history");
        requireAgentCapability(status, "state.revision.v1");

        const result = await requestBridgeActionHistory(bridge, input.maxResults ?? 10);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_undo_last_bridge_action",
    {
      description:
        "Undo only the exact latest bridge-owned scene action when Unity still proves it is the current Undo top. Requires that action's exact mutationId plus a fresh state epoch/revision. Unity refuses the request if state advanced, the active scene changed, the Undo group/name changed, the action was already undone, or the mutationId is not the latest bridge action. After PerformUndo, the bridge verifies Unity's undoRedoEvent reported the exact recorded group/name. This tool never searches backward through arbitrary historical mutations.",
      inputSchema: undoLastActionInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          mutationId: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "action.undoLast");
        requireAgentCapability(status, "state.revision.v1");

        const result = await requestUndoLastBridgeAction(bridge, input);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function toolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
