import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  LocalBridgeServer,
  type DiagnosticsOptions,
  type GameObjectCreateOptions,
  type HierarchyOptions,
} from "./bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "./protocol/bridge.js";

const bridge = new LocalBridgeServer();
const bridgePort = await bridge.start();
console.error(`[Unity AI Bridge] Local bridge listening on ws://127.0.0.1:${bridgePort}`);

const hierarchyInputSchema = fromJsonSchema({
  type: "object",
  properties: {
    maxDepth: {
      type: "integer",
      minimum: 1,
      maximum: 32,
      default: 8,
      description: "Maximum hierarchy depth to return, counting root GameObjects as depth 0. Allowed range: 1..32.",
    },
    maxNodes: {
      type: "integer",
      minimum: 1,
      maximum: 500,
      default: 200,
      description: "Maximum number of GameObjects to return in preorder. Allowed range: 1..500.",
    },
  },
  additionalProperties: false,
});

const diagnosticsInputSchema = fromJsonSchema({
  type: "object",
  properties: {
    maxEntries: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 100,
      description: "Maximum recent Console entries and compiler diagnostics to return after filtering. Allowed range: 1..200.",
    },
    minimumSeverity: {
      type: "string",
      enum: ["error", "warning", "log"],
      default: "warning",
      description: "Minimum severity to return. 'error' returns errors only, 'warning' returns errors and warnings, and 'log' also includes ordinary Console logs.",
    },
  },
  additionalProperties: false,
});

const resolveObjectInputSchema = fromJsonSchema({
  type: "object",
  required: ["globalObjectId"],
  properties: {
    globalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Unity GlobalObjectId string to re-resolve against current native Editor state. A syntactically valid ID may still return found=false when the target no longer exists or its scene is not loaded.",
    },
  },
  additionalProperties: false,
});

const createGameObjectInputSchema = fromJsonSchema({
  type: "object",
  required: ["name"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Name for a new empty root GameObject in the active scene. Whitespace-only names are rejected.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional idempotency key. Reuse exactly the same mutationId only when retrying the same create after an ambiguous timeout/disconnect. If omitted, the bridge generates one.",
    },
  },
  additionalProperties: false,
});

async function preflightAgentCapability(operation: string): Promise<void> {
  const status = await bridge.requestEditorStatus();
  requireAgentCapability(status, operation);
}

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await bridge.stop();
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

serveStdio(() => {
  const server = new McpServer({
    name: "unity-ai-bridge",
    version: `0.0.1-bridge-v${BRIDGE_PROTOCOL_VERSION}`,
  });

  server.registerTool(
    "unity_get_status",
    {
      description:
        "Read the connected Unity Editor version, project, active scene, Play Mode state, compilation state, Unity AI Bridge Agent version, and advertised bridge-operation capabilities.",
    },
    async () => {
      try {
        const status = await bridge.requestEditorStatus();
        return {
          content: [{ type: "text", text: JSON.stringify(status) }],
          structuredContent: status,
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
    "unity_get_hierarchy",
    {
      description:
        "Read a bounded preorder snapshot of the active Unity scene hierarchy. Returns GlobalObjectId plus transient instanceId, parent identity, depth, sibling index, child count, and active state. hierarchyPath is informational and must not be treated as durable identity.",
      inputSchema: hierarchyInputSchema,
    },
    async (args) => {
      try {
        const input = args as { maxDepth?: number; maxNodes?: number };
        const options: HierarchyOptions = {};
        if (input.maxDepth !== undefined) {
          options.maxDepth = input.maxDepth;
        }
        if (input.maxNodes !== undefined) {
          options.maxNodes = input.maxNodes;
        }

        await preflightAgentCapability("scene.hierarchy");
        const hierarchy = await bridge.requestHierarchy(options);
        return {
          content: [{ type: "text", text: JSON.stringify(hierarchy) }],
          structuredContent: hierarchy,
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
    "unity_get_diagnostics",
    {
      description:
        "Read bounded Unity diagnostics using public Unity APIs. Returns current Console error/warning/log counts, recent Console messages captured since the current script-domain load, and the latest compilation messages observed through Unity's CompilationPipeline. The result explicitly reports coverage because public Unity APIs expose current Console counts but not a supported full historical Console-entry iterator.",
      inputSchema: diagnosticsInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          maxEntries?: number;
          minimumSeverity?: "error" | "warning" | "log";
        };
        const options: DiagnosticsOptions = {};
        if (input.maxEntries !== undefined) {
          options.maxEntries = input.maxEntries;
        }
        if (input.minimumSeverity !== undefined) {
          options.minimumSeverity = input.minimumSeverity;
        }

        await preflightAgentCapability("editor.diagnostics");
        const diagnostics = await bridge.requestDiagnostics(options);
        return {
          content: [{ type: "text", text: JSON.stringify(diagnostics) }],
          structuredContent: diagnostics,
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
    "unity_resolve_object",
    {
      description:
        "Re-resolve a Unity GlobalObjectId against current native Editor state. Use this before mutations when a target came from an earlier snapshot. Returns found=false instead of inventing a replacement when the target no longer exists. Instance IDs and hierarchy paths are returned only as current hints; the GlobalObjectId remains the stable identity input.",
      inputSchema: resolveObjectInputSchema,
    },
    async (args) => {
      try {
        const input = args as { globalObjectId: string };
        await preflightAgentCapability("object.resolve");
        const result = await bridge.requestResolveObject(input.globalObjectId);
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
    "unity_create_game_object",
    {
      description:
        "Create one empty root GameObject in the active Unity scene. This is a write operation. Unity registers Undo, marks the scene dirty, verifies the created target through native GlobalObjectId readback, and deduplicates repeated delivery when the same mutationId and arguments are reused. A replay re-resolves the cached target and fails closed if that object was undone, deleted, moved, or otherwise no longer matches the completed mutation. If a write fails ambiguously, retry only with the mutationId reported by the failed call.",
      inputSchema: createGameObjectInputSchema,
    },
    async (args) => {
      try {
        const input = args as { name: string; mutationId?: string };
        const options: GameObjectCreateOptions = { name: input.name };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflightAgentCapability("gameObject.create");
        const result = await bridge.requestCreateGameObject(options);
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

  return server;
});
