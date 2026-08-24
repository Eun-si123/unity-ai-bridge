import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  PrefabPropertyBridgeServer,
  type PlayModeSetOptions,
  type StablePlayMode,
} from "./bridge/prefab-property-bridge-server.js";

const setPlayModeInputSchema = fromJsonSchema({
  type: "object",
  required: ["targetMode", "expectedCurrentMode"],
  properties: {
    targetMode: {
      type: "string",
      enum: ["edit", "play"],
      description: "Stable Play Mode state Unity should reach: 'play' to enter Play Mode or 'edit' to exit it.",
    },
    expectedCurrentMode: {
      type: "string",
      enum: ["edit", "play"],
      description:
        "Required stable Play Mode precondition from a recent unity_get_status observation. Transitions are rejected rather than guessed; refresh status if Unity is entering/exiting Play Mode.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional retry identity. Reuse only for an ambiguous retry of this exact targetMode + expectedCurrentMode intent. Same-id retries reconcile native state and never blindly request Enter/Exit Play Mode again.",
    },
  },
  additionalProperties: false,
});

export function registerPlayModeTools(
  server: McpServer,
  bridge: PrefabPropertyBridgeServer,
): void {
  server.registerTool(
    "unity_set_play_mode",
    {
      description:
        "Enter or exit Unity Play Mode and wait until the same Editor reaches the requested stable state. Requires an explicit stable expectedCurrentMode precondition, records mutation identity before requesting the asynchronous transition, survives optional domain reload/reconnect, and reconciles same-id retries without blindly repeating Enter/Exit Play Mode. This tool does not change the user's Enter Play Mode settings, does not save scenes automatically, and is not a Unity Undo operation. Use unity_get_status to inspect playModeState, pause state, and Domain/Scene Reload policy first.",
      inputSchema: setPlayModeInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          targetMode: StablePlayMode;
          expectedCurrentMode: StablePlayMode;
          mutationId?: string;
        };
        const options: PlayModeSetOptions = {
          targetMode: input.targetMode,
          expectedCurrentMode: input.expectedCurrentMode,
        };
        if (input.mutationId !== undefined) options.mutationId = input.mutationId;

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "editor.playMode.set");

        const result = await bridge.requestSetPlayMode(options);
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
