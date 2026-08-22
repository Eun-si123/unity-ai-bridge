import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { LocalBridgeServer } from "./bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "./protocol/bridge.js";

const bridge = new LocalBridgeServer();
const bridgePort = await bridge.start();
console.error(`[Unity AI Bridge] Local bridge listening on ws://127.0.0.1:${bridgePort}`);

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

  return server;
});
