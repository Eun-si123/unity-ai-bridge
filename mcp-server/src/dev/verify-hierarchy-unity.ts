import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 30_000;
const pollIntervalMs = 500;

const client = new Client({
  name: "unity-ai-bridge-hierarchy-verifier",
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
  if (!tools.some((tool) => tool.name === "unity_get_hierarchy")) {
    throw new Error("MCP server did not advertise unity_get_hierarchy.");
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; unity_get_hierarchy is advertised.");
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity and reading the active hierarchy...`);

  const deadline = Date.now() + timeoutMs;
  let lastError = "No result received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_get_hierarchy",
      arguments: {
        maxDepth: 8,
        maxNodes: 200,
      },
    });

    if (!result.isError) {
      const hierarchy = result.structuredContent;
      if (!isHierarchyPayload(hierarchy)) {
        throw new Error(
          `unity_get_hierarchy returned invalid structuredContent: ${JSON.stringify(hierarchy)}`,
        );
      }

      console.log("[Unity AI Bridge] MCP unity_get_hierarchy PASS:");
      console.log(JSON.stringify(hierarchy, null, 2));
      process.exitCode = 0;
      break;
    }

    const text = result.content.find((block) => block.type === "text");
    lastError = text?.type === "text" ? text.text : "unity_get_hierarchy returned isError=true.";
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (Date.now() >= deadline && process.exitCode !== 0) {
    throw new Error(`Timed out waiting for live Unity hierarchy result. Last tool error: ${lastError}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Hierarchy verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

function isHierarchyPayload(value: unknown): value is {
  sceneName: string;
  scenePath: string;
  rootCount: number;
  returnedNodeCount: number;
  maxDepth: number;
  maxNodes: number;
  truncatedByDepth: boolean;
  truncatedByNodes: boolean;
  nodes: unknown[];
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sceneName !== "string" ||
    typeof candidate.scenePath !== "string" ||
    !isNonNegativeInteger(candidate.rootCount) ||
    !isNonNegativeInteger(candidate.returnedNodeCount) ||
    !isPositiveInteger(candidate.maxDepth) ||
    !isPositiveInteger(candidate.maxNodes) ||
    typeof candidate.truncatedByDepth !== "boolean" ||
    typeof candidate.truncatedByNodes !== "boolean" ||
    !Array.isArray(candidate.nodes)
  ) {
    return false;
  }

  return (
    candidate.returnedNodeCount === candidate.nodes.length &&
    candidate.nodes.every(isHierarchyNode)
  );
}

function isHierarchyNode(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    typeof candidate.parentGlobalObjectId === "string" &&
    isNonNegativeInteger(candidate.depth) &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    isNonNegativeInteger(candidate.childCount) &&
    typeof candidate.activeSelf === "boolean" &&
    typeof candidate.activeInHierarchy === "boolean"
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
