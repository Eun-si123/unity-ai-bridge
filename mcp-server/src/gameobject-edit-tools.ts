import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  EditingBridgeServer,
  type GameObjectDeleteOptions,
  type GameObjectUpdateOptions,
} from "./bridge/editing-bridge-server.js";

const updateInputSchema = fromJsonSchema({
  type: "object",
  required: [
    "globalObjectId",
    "name",
    "activeSelf",
    "expectedStateEpoch",
    "expectedStateRevision",
  ],
  properties: {
    globalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "GlobalObjectId of the active-scene GameObject to update.",
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Complete desired GameObject name. Whitespace-only names are rejected.",
    },
    activeSelf: {
      type: "boolean",
      description: "Complete desired GameObject activeSelf state.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional idempotency key. Reuse only for an ambiguous retry of this exact update intent. If omitted, the bridge generates one.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Required optimistic-concurrency epoch from a recent Unity observation.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description:
        "Required optimistic-concurrency revision from the same observation. Stale state is rejected before mutation.",
    },
  },
  additionalProperties: false,
});

const deleteInputSchema = fromJsonSchema({
  type: "object",
  required: ["globalObjectId", "expectedStateEpoch", "expectedStateRevision"],
  properties: {
    globalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "GlobalObjectId of the active-scene GameObject to delete. Deleting a GameObject also deletes its child hierarchy through normal Unity semantics.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional idempotency key. Reuse only for an ambiguous retry of this exact delete intent. If omitted, the bridge generates one.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Required optimistic-concurrency epoch from a recent Unity observation.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description:
        "Required optimistic-concurrency revision from the same observation. Stale state is rejected before deletion.",
    },
  },
  additionalProperties: false,
});

export function registerGameObjectEditTools(
  server: McpServer,
  bridge: EditingBridgeServer,
): void {
  server.registerTool(
    "unity_update_game_object",
    {
      description:
        "Update the complete name and activeSelf state of one active-scene GameObject. Requires a fresh state token. Unity records Undo when native state changes, verifies name/active state by native readback, rolls back and verifies rollback on failed semantic verification, enforces the command deadline before execution, and protects ambiguous retries with mutationId replay rules. A request that already matches native state is returned as changed=false without creating an Undo mutation.",
      inputSchema: updateInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          globalObjectId: string;
          name: string;
          activeSelf: boolean;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: GameObjectUpdateOptions = {
          globalObjectId: input.globalObjectId,
          name: input.name,
          activeSelf: input.activeSelf,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflight(bridge, "gameObject.update", "state.revision.v1");
        const result = await bridge.requestUpdateGameObject(options);
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

  server.registerTool(
    "unity_delete_game_object",
    {
      description:
        "Delete one active-scene GameObject (including its child hierarchy) with Unity Undo support. This destructive Editor mutation requires a fresh state token, verifies the target is absent after deletion, verifies restoration if rollback is required, enforces the command deadline before execution, and uses mutationId replay rules so an ambiguous retry does not silently delete a restored object again.",
      inputSchema: deleteInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          globalObjectId: string;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: GameObjectDeleteOptions = {
          globalObjectId: input.globalObjectId,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflight(bridge, "gameObject.delete", "state.revision.v1");
        const result = await bridge.requestDeleteGameObject(options);
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

async function preflight(
  bridge: EditingBridgeServer,
  ...capabilities: string[]
): Promise<void> {
  const status = await bridge.requestEditorStatus();
  for (const capability of capabilities) {
    requireAgentCapability(status, capability);
  }
}
