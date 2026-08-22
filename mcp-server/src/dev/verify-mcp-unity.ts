import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 30_000;
const pollIntervalMs = 500;

const client = new Client({
  name: "unity-ai-bridge-verifier",
  version: "0.0.1",
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  if (!tools.some((tool) => tool.name === "unity_get_status")) {
    throw new Error("MCP server did not advertise unity_get_status.");
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; unity_get_status is advertised.");
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity and calling unity_get_status...`);

  const deadline = Date.now() + timeoutMs;
  let lastError = "No result received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_get_status",
      arguments: {},
    });

    if (!result.isError) {
      const status = result.structuredContent;
      if (!isEditorStatusPayload(status)) {
        throw new Error(`unity_get_status returned invalid structuredContent: ${JSON.stringify(status)}`);
      }

      console.log("[Unity AI Bridge] MCP unity_get_status PASS:");
      console.log(JSON.stringify(status, null, 2));
      process.exitCode = 0;
      break;
    }

    const text = result.content.find((block) => block.type === "text");
    lastError = text?.type === "text" ? text.text : "unity_get_status returned isError=true.";
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (Date.now() >= deadline && process.exitCode !== 0) {
    throw new Error(`Timed out waiting for live Unity MCP result. Last tool error: ${lastError}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] MCP verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

function isEditorStatusPayload(value: unknown): value is {
  unityVersion: string;
  projectName: string;
  activeScene: string;
  isPlaying: boolean;
  isCompiling: boolean;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.unityVersion === "string" &&
    typeof candidate.projectName === "string" &&
    typeof candidate.activeScene === "string" &&
    typeof candidate.isPlaying === "boolean" &&
    typeof candidate.isCompiling === "boolean"
  );
}
