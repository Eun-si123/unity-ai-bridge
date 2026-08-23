import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 30_000;
const pollIntervalMs = 300;
const expectedCapabilities = [
  "editor.status",
  "scene.hierarchy",
  "editor.diagnostics",
  "object.resolve",
  "gameObject.create",
  "gameObject.update",
  "gameObject.delete",
  "scene.save",
  "transform.get",
  "transform.set",
  "state.revision.v1",
] as const;

const client = new Client({
  name: "unity-ai-bridge-agent-capabilities-verifier",
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
  for (const required of [
    "unity_get_status",
    "unity_get_hierarchy",
    "unity_get_transform",
    "unity_set_transform",
    "unity_update_game_object",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Unity Agent capability metadata...");
  const status = await waitForCurrentAgentStatus();

  const missing = expectedCapabilities.filter(
    (operation) => !status.capabilities.includes(operation),
  );
  if (missing.length > 0) {
    throw new Error(
      `Unity Agent ${status.agentVersion} is missing expected capabilities: ${missing.join(", ")}`,
    );
  }

  console.log("[Unity AI Bridge] Agent capability metadata PASS:");
  console.log(JSON.stringify(status, null, 2));

  const hierarchy = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: { maxDepth: 1, maxNodes: 10 },
  });
  if (hierarchy.isError) {
    throw new Error(
      `Capability-preflighted unity_get_hierarchy failed: ${readToolText(hierarchy)}`,
    );
  }

  console.log(
    "[Unity AI Bridge] Capability preflight -> supported operation PASS (scene.hierarchy).",
  );
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Agent capability verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForCurrentAgentStatus(): Promise<AgentStatus> {
  const deadline = Date.now() + timeoutMs;
  let lastObservation = "No status returned.";

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_get_status",
      arguments: {},
    });

    if (!result.isError) {
      const status = parseAgentStatus(result.structuredContent);
      if (status !== null) {
        return status;
      }
      lastObservation = JSON.stringify(result.structuredContent);
    } else {
      lastObservation = readToolText(result);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for current Unity Agent capability metadata. Last observation: ${lastObservation}. If Unity is running an older compiled package assembly, reimport the Unity AI Bridge package or restart Unity and retry.`,
  );
}

type AgentStatus = {
  unityVersion: string;
  projectName: string;
  activeScene: string;
  isPlaying: boolean;
  isCompiling: boolean;
  agentVersion: string;
  capabilities: string[];
};

function parseAgentStatus(value: unknown): AgentStatus | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.unityVersion !== "string" ||
    typeof candidate.projectName !== "string" ||
    typeof candidate.activeScene !== "string" ||
    typeof candidate.isPlaying !== "boolean" ||
    typeof candidate.isCompiling !== "boolean" ||
    typeof candidate.agentVersion !== "string" ||
    candidate.agentVersion.length === 0 ||
    !Array.isArray(candidate.capabilities) ||
    !candidate.capabilities.every((entry) => typeof entry === "string")
  ) {
    return null;
  }

  return {
    unityVersion: candidate.unityVersion,
    projectName: candidate.projectName,
    activeScene: candidate.activeScene,
    isPlaying: candidate.isPlaying,
    isCompiling: candidate.isCompiling,
    agentVersion: candidate.agentVersion,
    capabilities: candidate.capabilities as string[],
  };
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
