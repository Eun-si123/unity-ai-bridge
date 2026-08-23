import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const prefabPath =
  "Packages/com.eunsung.unity-ai-bridge/Tests/Editor/Fixtures/PrefabWorkflowFixture.prefab";
const prefabGuid = "8a7f7a7f8c15476ebf7a50b5c9049f11";
const rootName = "PrefabWorkflowFixture";

const client = new Client({
  name: "unity-ai-bridge-prefab-verifier",
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
    "unity_inspect_prefab",
    "unity_instantiate_prefab",
    "unity_resolve_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  const inspectionResult = await client.callTool({
    name: "unity_inspect_prefab",
    arguments: { path: prefabPath, maxDepth: 4, maxNodes: 25 },
  });
  requireSuccess(inspectionResult, "Prefab inspection");
  const inspection = requireRecord(inspectionResult.structuredContent, "Prefab inspection");
  if (requireString(inspection, "guid") !== prefabGuid) {
    throw new Error(`Prefab fixture GUID did not match ${prefabGuid}.`);
  }
  if (requireString(inspection, "path") !== prefabPath) {
    throw new Error("Prefab inspection returned a different asset path.");
  }
  const dependencyHash = requireString(inspection, "dependencyHash");
  if (requireString(inspection, "rootName") !== rootName) {
    throw new Error(`Prefab fixture root name was not ${rootName}.`);
  }
  const nodes = requireArray(inspection, "nodes");
  const root = requireRecord(nodes[0], "Prefab root node");
  const componentTypes = requireArray(root, "componentTypeNames");
  if (!componentTypes.includes("UnityEngine.Transform")) {
    throw new Error("Prefab root inspection did not include UnityEngine.Transform.");
  }

  const statusResult = await client.callTool({ name: "unity_get_status", arguments: {} });
  requireSuccess(statusResult, "initial Unity status");
  const status = requireRecord(statusResult.structuredContent, "initial status");
  const stateEpoch = requireString(status, "stateEpoch");
  const stateRevision = requirePositiveInteger(status, "stateRevision");

  const instantiateMutationId = `verify-prefab-instantiate-${randomUUID()}`;
  const instantiateResult = await client.callTool({
    name: "unity_instantiate_prefab",
    arguments: {
      prefabPath,
      expectedPrefabDependencyHash: dependencyHash,
      mutationId: instantiateMutationId,
      expectedStateEpoch: stateEpoch,
      expectedStateRevision: stateRevision,
    },
  });
  requireSuccess(instantiateResult, "Prefab instantiate");
  const instantiate = requireRecord(instantiateResult.structuredContent, "Prefab instantiate");
  if (requireBoolean(instantiate, "replayed")) {
    throw new Error("First Prefab instantiate unexpectedly returned replayed=true.");
  }
  if (requireString(instantiate, "prefabPath") !== prefabPath ||
      requireString(instantiate, "expectedPrefabDependencyHash") !== dependencyHash) {
    throw new Error("Prefab instantiate result did not preserve its asset precondition.");
  }
  const globalObjectId = requireString(instantiate, "globalObjectId");

  const resolved = await resolve(globalObjectId);
  if (!resolved.found || !resolved.isGameObject || resolved.name !== rootName) {
    throw new Error(`Instantiated Prefab root did not resolve as ${rootName}.`);
  }

  const replayResult = await client.callTool({
    name: "unity_instantiate_prefab",
    arguments: {
      prefabPath,
      expectedPrefabDependencyHash: dependencyHash,
      mutationId: instantiateMutationId,
      expectedStateEpoch: stateEpoch,
      expectedStateRevision: stateRevision,
    },
  });
  requireSuccess(replayResult, "Prefab same-id replay");
  const replay = requireRecord(replayResult.structuredContent, "Prefab replay");
  if (!requireBoolean(replay, "replayed") || requireString(replay, "globalObjectId") !== globalObjectId) {
    throw new Error("Prefab same-id replay did not return the completed instance identity.");
  }

  console.log("[Unity AI Bridge] Prefab inspect + instantiate + native linkage/replay PASS.");
  console.log("[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo the Prefab instance creation.");
  await waitUntilAbsent(globalObjectId);

  const staleReplay = await client.callTool({
    name: "unity_instantiate_prefab",
    arguments: {
      prefabPath,
      expectedPrefabDependencyHash: dependencyHash,
      mutationId: instantiateMutationId,
      expectedStateEpoch: stateEpoch,
      expectedStateRevision: stateRevision,
    },
  });
  if (!staleReplay.isError) {
    throw new Error("Prefab same-id replay unexpectedly recreated the instance after Undo.");
  }
  const staleReplayError = readText(staleReplay);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Prefab stale replay returned the wrong error: ${staleReplayError}`);
  }

  const finalStatusResult = await client.callTool({ name: "unity_get_status", arguments: {} });
  requireSuccess(finalStatusResult, "final Unity status");
  const finalStatus = requireRecord(finalStatusResult.structuredContent, "final status");

  console.log("[Unity AI Bridge] Prefab inspect/instantiate reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: requireString(finalStatus, "unityVersion"),
    prefabPath,
    prefabGuid,
    dependencyHash,
    rootName,
    returnedNodeCount: requireNonNegativeInteger(inspection, "returnedNodeCount"),
    instantiateMutationId,
    globalObjectId,
    instantiateVerified: true,
    immediateReplay: true,
    undoRemovedInstance: true,
    staleReplayError,
    temporaryInstanceRemoved: true,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Prefab workflow verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitUntilAbsent(globalObjectId: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await resolve(globalObjectId)).found) return;
    await delay(pollIntervalMs);
  }
  throw new Error("Timed out waiting for Unity Undo to remove the Prefab instance.");
}

async function resolve(globalObjectId: string): Promise<ResolvedObject> {
  const result = await client.callTool({
    name: "unity_resolve_object",
    arguments: { globalObjectId },
  });
  requireSuccess(result, "object resolve");
  const value = requireRecord(result.structuredContent, "object resolve");
  return {
    found: requireBoolean(value, "found"),
    isGameObject: requireBoolean(value, "isGameObject"),
    name: requireString(value, "name"),
  };
}

type ResolvedObject = { found: boolean; isGameObject: boolean; name: string };

function requireSuccess(result: { isError?: boolean; content: Array<{ type: string; text?: string }> }, label: string): void {
  if (result.isError) throw new Error(`${label} failed: ${readText(result)}`);
}

function readText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((block) => block.type === "text")?.text ?? "tool returned no text";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: Record<string, unknown>, key: string): unknown[] {
  const item = value[key];
  if (!Array.isArray(item)) throw new Error(`${key} was not an array.`);
  return item;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string") throw new Error(`${key} was not a string.`);
  return item;
}

function requireBoolean(value: Record<string, unknown>, key: string): boolean {
  const item = value[key];
  if (typeof item !== "boolean") throw new Error(`${key} was not a boolean.`);
  return item;
}

function requirePositiveInteger(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0) {
    throw new Error(`${key} was not a positive safe integer.`);
  }
  return item;
}

function requireNonNegativeInteger(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
    throw new Error(`${key} was not a non-negative safe integer.`);
  }
  return item;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
