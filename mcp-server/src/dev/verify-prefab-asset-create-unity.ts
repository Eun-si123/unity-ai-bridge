import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const destinationPath = "Assets/UnityAiBridge_Prefab_Create_Verify.prefab";

const client = new Client({
  name: "unity-ai-bridge-prefab-asset-create-verifier",
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
    "unity_create_game_object",
    "unity_resolve_object",
    "unity_create_prefab_asset",
    "unity_inspect_prefab",
    "unity_inspect_asset",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Unity Editor to connect to the local bridge...");
  const status = await waitForUnityConnection();
  console.log(
    `[Unity AI Bridge] Unity connection ready: ${requireString(status, "unityVersion")} / ${requireString(status, "activeScene")}`,
  );

  await requireDestinationAbsent();

  const sourceName = `MCP_Prefab_Asset_Create_Verify_${Date.now()}`;
  const sourceCreateMutationId = `verify-prefab-source-create-${randomUUID()}`;
  const createSourceResult = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name: sourceName, mutationId: sourceCreateMutationId },
  });
  requireSuccess(createSourceResult, "temporary source GameObject create");
  const sourceCreate = requireRecord(createSourceResult.structuredContent, "source create");
  const sourceGlobalObjectId = requireString(sourceCreate, "globalObjectId");

  const sourceState = await resolve(sourceGlobalObjectId);
  if (!sourceState.found || sourceState.name !== sourceName) {
    throw new Error(`Temporary source GameObject did not resolve: ${JSON.stringify(sourceState)}`);
  }

  const createMutationId = `verify-prefab-asset-create-${randomUUID()}`;
  const createResult = await client.callTool({
    name: "unity_create_prefab_asset",
    arguments: {
      sourceGlobalObjectId,
      destinationPath,
      mutationId: createMutationId,
      expectedStateEpoch: sourceState.stateEpoch,
      expectedStateRevision: sourceState.stateRevision,
    },
  });
  requireSuccess(createResult, "Prefab Asset create");
  const created = requireRecord(createResult.structuredContent, "Prefab Asset create");
  if (requireBoolean(created, "replayed") || !requireBoolean(created, "created")) {
    throw new Error("First Prefab Asset create did not report created=true/replayed=false.");
  }
  if (requireString(created, "sourceGlobalObjectId") !== sourceGlobalObjectId ||
      requireString(created, "destinationPath") !== destinationPath ||
      requireString(created, "rootName") !== sourceName) {
    throw new Error(`Prefab Asset create returned wrong source/path/root: ${JSON.stringify(created)}`);
  }
  const prefabGuid = requireString(created, "prefabGuid");
  const dependencyHash = requireString(created, "dependencyHash");

  const inspectedResult = await client.callTool({
    name: "unity_inspect_prefab",
    arguments: { path: destinationPath, maxDepth: 0, maxNodes: 1 },
  });
  requireSuccess(inspectedResult, "created Prefab inspect");
  const inspected = requireRecord(inspectedResult.structuredContent, "created Prefab inspect");
  if (requireString(inspected, "guid") !== prefabGuid ||
      requireString(inspected, "dependencyHash") !== dependencyHash ||
      requireString(inspected, "rootName") !== sourceName) {
    throw new Error(`Created Prefab native readback did not match: ${JSON.stringify(inspected)}`);
  }

  const replayResult = await client.callTool({
    name: "unity_create_prefab_asset",
    arguments: {
      sourceGlobalObjectId,
      destinationPath,
      mutationId: createMutationId,
      expectedStateEpoch: sourceState.stateEpoch,
      expectedStateRevision: sourceState.stateRevision,
    },
  });
  requireSuccess(replayResult, "Prefab Asset immediate replay");
  const replay = requireRecord(replayResult.structuredContent, "Prefab Asset replay");
  if (!requireBoolean(replay, "replayed") ||
      requireString(replay, "prefabGuid") !== prefabGuid ||
      requireString(replay, "dependencyHash") !== dependencyHash) {
    throw new Error(`Prefab Asset immediate replay did not preserve identity: ${JSON.stringify(replay)}`);
  }

  console.log("[Unity AI Bridge] Prefab Asset create + native inspect + immediate replay PASS.");
  console.log(
    `[Unity AI Bridge] NOW delete '${destinationPath}' ONCE in Unity's Project window, then return here.`,
  );
  await waitForDestinationAbsent();

  const staleReplay = await client.callTool({
    name: "unity_create_prefab_asset",
    arguments: {
      sourceGlobalObjectId,
      destinationPath,
      mutationId: createMutationId,
      expectedStateEpoch: sourceState.stateEpoch,
      expectedStateRevision: sourceState.stateRevision,
    },
  });
  if (record(staleReplay)?.isError !== true) {
    throw new Error("Same-id Prefab Asset replay unexpectedly recreated the manually removed asset.");
  }
  const staleReplayError = readText(staleReplay);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Prefab Asset stale replay returned the wrong error: ${staleReplayError}`);
  }

  const cleanupState = await resolve(sourceGlobalObjectId);
  if (!cleanupState.found) {
    throw new Error("Temporary source disappeared before cleanup.");
  }
  const sourceCleanupMutationId = `verify-prefab-source-cleanup-${randomUUID()}`;
  const cleanupResult = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: sourceGlobalObjectId,
      mutationId: sourceCleanupMutationId,
      expectedStateEpoch: cleanupState.stateEpoch,
      expectedStateRevision: cleanupState.stateRevision,
    },
  });
  requireSuccess(cleanupResult, "temporary source cleanup");
  const finalSource = await resolve(sourceGlobalObjectId);
  if (finalSource.found) {
    throw new Error("Temporary source GameObject still exists after cleanup.");
  }

  const finalStatusResult = await client.callTool({ name: "unity_get_status", arguments: {} });
  requireSuccess(finalStatusResult, "final Unity status");
  const finalStatus = requireRecord(finalStatusResult.structuredContent, "final status");

  console.log("[Unity AI Bridge] Prefab Asset creation reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: requireString(finalStatus, "unityVersion"),
    sourceGlobalObjectId,
    sourceName,
    destinationPath,
    prefabGuid,
    dependencyHash,
    createMutationId,
    createVerified: true,
    immediateReplay: true,
    manualAssetRemovalObserved: true,
    staleReplayError,
    sourceCleanupDeleted: true,
    temporarySourceRemoved: true,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Prefab Asset creation verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityConnection(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastObservation = "No status returned.";
  while (Date.now() < deadline) {
    try {
      const result = await client.callTool({ name: "unity_get_status", arguments: {} });
      if (record(result)?.isError !== true) {
        const status = record(result.structuredContent);
        if (status !== null &&
            typeof status.unityVersion === "string" &&
            typeof status.activeScene === "string" &&
            typeof status.stateEpoch === "string" &&
            typeof status.stateRevision === "number") {
          return status;
        }
        lastObservation = `Invalid status payload: ${JSON.stringify(result.structuredContent)}`;
      } else {
        lastObservation = readText(result);
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Unity Editor. Last observation: ${lastObservation}`);
}

async function requireDestinationAbsent(): Promise<void> {
  const result = await client.callTool({
    name: "unity_inspect_asset",
    arguments: { path: destinationPath, maxDependencies: 0 },
  });
  if (record(result)?.isError !== true) {
    throw new Error(
      `Verification destination already exists at '${destinationPath}'. Delete it in Unity's Project window before retrying.`,
    );
  }
  const text = readText(result);
  if (!text.includes("asset_unavailable")) {
    throw new Error(`Could not prove verification destination is absent: ${text}`);
  }
}

async function waitForDestinationAbsent(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_inspect_asset",
      arguments: { path: destinationPath, maxDependencies: 0 },
    });
    if (record(result)?.isError === true && readText(result).includes("asset_unavailable")) {
      return;
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for '${destinationPath}' to be deleted in Unity's Project window.`);
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
    name: requireString(value, "name"),
    stateEpoch: requireString(value, "stateEpoch"),
    stateRevision: requirePositiveInteger(value, "stateRevision"),
  };
}

type ResolvedObject = {
  found: boolean;
  name: string;
  stateEpoch: string;
  stateRevision: number;
};

function requireSuccess(result: unknown, label: string): void {
  if (record(result)?.isError === true) {
    throw new Error(`${label} failed: ${readText(result)}`);
  }
}

function readText(value: unknown): string {
  const content = record(value)?.content;
  if (!Array.isArray(content)) return "tool returned no text";
  for (const block of content) {
    const item = record(block);
    if (item?.type === "text" && typeof item.text === "string") return item.text;
  }
  return "tool returned no text";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const item = record(value);
  if (item === null || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`);
  }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
