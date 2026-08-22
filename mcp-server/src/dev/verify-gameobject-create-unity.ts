import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 30_000;
const pollIntervalMs = 500;

const client = new Client({
  name: "unity-ai-bridge-gameobject-create-verifier",
  version: "0.0.1",
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

const mutationId = `verify-create-${randomUUID()}`;
const objectName = `MCP_Create_Verify_${Date.now()}`;

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  if (!tools.some((tool) => tool.name === "unity_get_status")) {
    throw new Error("MCP server did not advertise unity_get_status.");
  }
  if (!tools.some((tool) => tool.name === "unity_create_game_object")) {
    throw new Error("MCP server did not advertise unity_create_game_object.");
  }
  if (!tools.some((tool) => tool.name === "unity_get_hierarchy")) {
    throw new Error("MCP server did not advertise unity_get_hierarchy.");
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; status + create + hierarchy tools are advertised.");
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity to connect...`);
  await waitForUnityReady();

  console.log(`[Unity AI Bridge] Unity connection ready. Creating '${objectName}' with mutationId=${mutationId}...`);

  const firstCall = await callCreateWithSafeRetry();
  const first = firstCall.structuredContent;
  if (!isCreatePayload(first)) {
    throw new Error(`First create returned invalid structuredContent: ${JSON.stringify(first)}`);
  }
  if (first.replayed) {
    throw new Error("First create unexpectedly reported replayed=true.");
  }

  console.log("[Unity AI Bridge] First create PASS; retrying the same mutationId...");

  const secondCall = await client.callTool({
    name: "unity_create_game_object",
    arguments: {
      name: objectName,
      mutationId,
    },
  });

  if (secondCall.isError) {
    throw new Error(`Second unity_create_game_object call failed: ${readToolText(secondCall)}`);
  }

  const second = secondCall.structuredContent;
  if (!isCreatePayload(second)) {
    throw new Error(`Second create returned invalid structuredContent: ${JSON.stringify(second)}`);
  }
  if (!second.replayed) {
    throw new Error("Second create did not report replayed=true for the same mutationId.");
  }
  if (second.globalObjectId !== first.globalObjectId) {
    throw new Error("Deduplicated retry returned a different GlobalObjectId.");
  }

  const hierarchyCall = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: {
      maxDepth: 8,
      maxNodes: 500,
    },
  });

  if (hierarchyCall.isError) {
    throw new Error(`Hierarchy verification failed: ${readToolText(hierarchyCall)}`);
  }

  const hierarchy = hierarchyCall.structuredContent;
  if (!isHierarchyPayload(hierarchy)) {
    throw new Error(`Hierarchy returned invalid structuredContent: ${JSON.stringify(hierarchy)}`);
  }

  const matchingNodes = hierarchy.nodes.filter((node) => {
    if (typeof node !== "object" || node === null) {
      return false;
    }
    const candidate = node as Record<string, unknown>;
    return candidate.globalObjectId === first.globalObjectId;
  });

  if (matchingNodes.length !== 1) {
    throw new Error(
      `Expected exactly one hierarchy node with GlobalObjectId ${first.globalObjectId}; found ${matchingNodes.length}.`,
    );
  }

  console.log("[Unity AI Bridge] GameObject create + dedup PASS:");
  console.log(JSON.stringify({ first, second, hierarchyMatches: matchingNodes.length }, null, 2));
  console.log("[Unity AI Bridge] NOTE: the test leaves one dirty GameObject in the scene; use Unity Undo once to remove it.");
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] GameObject create verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityReady(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No Unity status result received.";

  while (Date.now() < deadline) {
    const status = await client.callTool({
      name: "unity_get_status",
      arguments: {},
    });

    if (!status.isError) {
      return;
    }

    lastError = readToolText(status);
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for Unity connection. Last tool error: ${lastError}`);
}

async function callCreateWithSafeRetry() {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No create result received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_create_game_object",
      arguments: {
        name: objectName,
        mutationId,
      },
    });

    if (!result.isError) {
      return result;
    }

    lastError = readToolText(result);
    if (!isRetryableConnectionError(lastError)) {
      throw new Error(`First unity_create_game_object call failed: ${lastError}`);
    }

    console.log(
      `[Unity AI Bridge] Create attempt was ambiguous/unavailable; retrying with the SAME mutationId (${mutationId})...`,
    );
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for first unity_create_game_object result. Last tool error: ${lastError}; mutationId=${mutationId}`,
  );
}

function isRetryableConnectionError(message: string): boolean {
  return (
    message.includes("No Unity Editor is connected") ||
    message.includes("disconnected") ||
    message.includes("timed out") ||
    message.includes("timeout/") ||
    message.includes("routing/stale_connection")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function isCreatePayload(value: unknown): value is {
  mutationId: string;
  replayed: boolean;
  globalObjectId: string;
  instanceId: number;
  name: string;
  hierarchyPath: string;
  sceneName: string;
  scenePath: string;
  siblingIndex: number;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    typeof candidate.siblingIndex === "number" &&
    Number.isSafeInteger(candidate.siblingIndex) &&
    candidate.siblingIndex >= 0
  );
}

function isHierarchyPayload(value: unknown): value is { nodes: unknown[] } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.nodes);
}
