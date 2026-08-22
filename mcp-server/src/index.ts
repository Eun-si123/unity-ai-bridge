import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import {
  LocalBridgeServer,
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
        "Read the connected Unity Editor version, project, active scene, Play Mode state, and compilation state.",
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

  return server;
});
