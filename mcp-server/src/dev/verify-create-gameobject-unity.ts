import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 30_000;
const pollIntervalMs = 500;
const stamp = Date.now();
const name = `Unity AI Bridge Verify ${stamp}`;
const idempotencyKey = `verify-create-${stamp}`;

const client = new Client({
  name: "unity-ai-bridge-create-gameobject-verifier",
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
  for (const requiredTool of ["unity_create_game_object", "unity_get_hierarchy"]) {
    if (!tools.some((tool) => tool.name === requiredTool)) {
      throw new Error(`MCP server did not advertise ${requiredTool}.`);
    }
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; create and hierarchy tools are advertised.");
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity and creating '${name}'...`);

  const deadline = Date.now() + timeoutMs;
  let first: CreateGameObjectPayload | undefined;
  let lastError = "No result received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_create_game_object",
      arguments: { name, idempotencyKey },
    });

    if (!result.isError) {
      if (!isCreateGameObjectPayload(result.structuredContent)) {
        throw new Error(
          `unity_create_game_object returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`,
        );
      }
      first = result.structuredContent;
      break;
    }

    const text = result.content.find((block) => block.type === "text");
    lastError = text?.type === "text" ? text.text : "unity_create_game_object returned isError=true.";
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (first === undefined) {
    throw new Error(`Timed out waiting for live Unity create result. Last tool error: ${lastError}`);
  }

  if (!first.created || first.deduplicated) {
    throw new Error(
      `First create must report created=true and deduplicated=false: ${JSON.stringify(first)}`,
    );
  }
  if (!first.sceneDirty) {
    throw new Error("First create did not report the scene as dirty.");
  }
  if (first.undoGroupName !== "Unity AI Bridge: Create GameObject") {
    throw new Error(`Unexpected Undo group name: ${first.undoGroupName}`);
  }

  console.log("[Unity AI Bridge] First create PASS:");
  console.log(JSON.stringify(first, null, 2));

  const retryResult = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name, idempotencyKey },
  });
  if (retryResult.isError || !isCreateGameObjectPayload(retryResult.structuredContent)) {
    throw new Error(`Idempotent retry failed: ${JSON.stringify(retryResult)}`);
  }

  const retry = retryResult.structuredContent;
  if (retry.created || !retry.deduplicated) {
    throw new Error(
      `Retry must report created=false and deduplicated=true: ${JSON.stringify(retry)}`,
    );
  }
  if (retry.globalObjectId !== first.globalObjectId) {
    throw new Error("Idempotent retry returned a different GlobalObjectId.");
  }

  console.log("[Unity AI Bridge] Same-key deduplication PASS.");

  const hierarchyResult = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: { maxDepth: 8, maxNodes: 500 },
  });
  if (hierarchyResult.isError || !isHierarchyPayload(hierarchyResult.structuredContent)) {
    throw new Error(`Hierarchy readback failed: ${JSON.stringify(hierarchyResult)}`);
  }

  const matches = hierarchyResult.structuredContent.nodes.filter(
    (node) => node.globalObjectId === first.globalObjectId,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one hierarchy node with ${first.globalObjectId}; found ${matches.length}.`,
    );
  }

  console.log("[Unity AI Bridge] Hierarchy readback PASS; exactly one created object exists.");
  console.log("[Unity AI Bridge] Create + idempotency verification PASS.");
  console.log("[Unity AI Bridge] The test object is intentionally left unsaved; use Unity Undo once to remove it.");
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] GameObject create verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

interface CreateGameObjectPayload {
  globalObjectId: string;
  instanceId: number;
  name: string;
  sceneName: string;
  scenePath: string;
  siblingIndex: number;
  activeSelf: boolean;
  activeInHierarchy: boolean;
  sceneDirty: boolean;
  created: boolean;
  deduplicated: boolean;
  undoGroupName: string;
}

function isCreateGameObjectPayload(value: unknown): value is CreateGameObjectPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    typeof candidate.activeSelf === "boolean" &&
    typeof candidate.activeInHierarchy === "boolean" &&
    typeof candidate.sceneDirty === "boolean" &&
    typeof candidate.created === "boolean" &&
    typeof candidate.deduplicated === "boolean" &&
    typeof candidate.undoGroupName === "string"
  );
}

function isHierarchyPayload(value: unknown): value is {
  nodes: Array<{ globalObjectId: string }>;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(
      (node) =>
        typeof node === "object" &&
        node !== null &&
        typeof (node as Record<string, unknown>).globalObjectId === "string",
    )
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
