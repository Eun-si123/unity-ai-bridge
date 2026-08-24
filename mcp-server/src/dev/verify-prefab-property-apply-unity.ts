import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const requestedTriggerValue = true;
const verificationRunId = `${Date.now()}_${randomUUID().replaceAll("-", "")}`;
const prefabPath = `Assets/UnityAiBridge_Prefab_Property_Apply_Verify_${verificationRunId}.prefab`;

const client = new Client({
  name: "unity-ai-bridge-prefab-property-apply-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

let sourceGlobalObjectId = "";
let primaryInstanceGlobalObjectId = "";
let readbackInstanceGlobalObjectId = "";
let componentGlobalObjectId = "";
let completed = false;

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of [
    "unity_get_status",
    "unity_create_game_object",
    "unity_resolve_object",
    "unity_get_components",
    "unity_add_component",
    "unity_set_component_property",
    "unity_create_prefab_asset",
    "unity_inspect_prefab",
    "unity_inspect_asset",
    "unity_instantiate_prefab",
    "unity_apply_prefab_property_override",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for the required Unity capabilities...");
  const connectedStatus = await waitForUnityReady();
  const activeScene = readString(connectedStatus, "activeScene");
  if (!activeScene.startsWith("Assets/") || !activeScene.toLowerCase().endsWith(".unity")) {
    throw new Error(
      `This verifier requires a saved active Scene under Assets so scene-object GlobalObjectIds are durable. ` +
        `Current activeScene=${activeScene}. Save the Scene and run the verifier again.`,
    );
  }
  console.log(
    `[Unity AI Bridge] Unity connection ready: ${readString(connectedStatus, "unityVersion")} / ${activeScene}`,
  );
  console.log(`[Unity AI Bridge] Verification Prefab: ${prefabPath}`);

  await requireAssetAbsent(prefabPath);

  const sourceCreate = await callStructured("unity_create_game_object", {
    name: `MCP_Prefab_Property_Apply_Source_${Date.now()}`,
    mutationId: `verify-prefab-property-source-create-${randomUUID()}`,
  });
  sourceGlobalObjectId = readString(sourceCreate, "globalObjectId");

  let sourceInspect = await inspectComponents(sourceGlobalObjectId);
  const addCollider = await callStructured("unity_add_component", {
    gameObjectGlobalObjectId: sourceGlobalObjectId,
    typeName: "UnityEngine.BoxCollider",
    mutationId: `verify-prefab-property-add-collider-${randomUUID()}`,
    expectedStateEpoch: readString(sourceInspect, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(sourceInspect, "stateRevision"),
  });
  if (addCollider.added !== true) {
    throw new Error(`Temporary BoxCollider was not added: ${JSON.stringify(addCollider)}`);
  }

  sourceInspect = await inspectComponents(sourceGlobalObjectId);
  assertBooleanProperty(
    findComponent(sourceInspect, "UnityEngine.BoxCollider"),
    "m_IsTrigger",
    false,
    "temporary source BoxCollider",
  );

  const createdPrefab = await callStructured("unity_create_prefab_asset", {
    sourceGlobalObjectId,
    destinationPath: prefabPath,
    mutationId: `verify-prefab-property-asset-create-${randomUUID()}`,
    expectedStateEpoch: readString(sourceInspect, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(sourceInspect, "stateRevision"),
  });
  if (createdPrefab.created !== true || createdPrefab.replayed !== false) {
    throw new Error(
      `Temporary Prefab creation did not report created=true/replayed=false: ${JSON.stringify(createdPrefab)}`,
    );
  }

  const initialPrefab = await inspectPrefab(prefabPath);
  const prefabGuid = readString(initialPrefab, "guid");
  const dependencyHashBefore = readString(initialPrefab, "dependencyHash");
  if (readString(createdPrefab, "prefabGuid") !== prefabGuid) {
    throw new Error("Prefab create/inspect GUID readback disagreed.");
  }
  if (readString(createdPrefab, "dependencyHash") !== dependencyHashBefore) {
    throw new Error("Prefab create/inspect dependencyHash readback disagreed.");
  }
  const prefabRoot = readRecord(readArray(initialPrefab, "nodes")[0], "Prefab root node");
  if (!readArray(prefabRoot, "componentTypeNames").includes("UnityEngine.BoxCollider")) {
    throw new Error("Temporary Prefab root did not contain UnityEngine.BoxCollider.");
  }

  const beforePrimaryInstantiate = await getStatus();
  const primaryInstantiate = await callStructured("unity_instantiate_prefab", {
    prefabPath,
    expectedPrefabDependencyHash: dependencyHashBefore,
    mutationId: `verify-prefab-property-instance-${randomUUID()}`,
    expectedStateEpoch: readString(beforePrimaryInstantiate, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(beforePrimaryInstantiate, "stateRevision"),
  });
  primaryInstanceGlobalObjectId = readString(primaryInstantiate, "globalObjectId");

  let primaryInspect = await inspectComponents(primaryInstanceGlobalObjectId);
  const primaryCollider = findComponent(primaryInspect, "UnityEngine.BoxCollider");
  componentGlobalObjectId = readString(primaryCollider, "globalObjectId");
  assertBooleanProperty(primaryCollider, "m_IsTrigger", false, "fresh Prefab instance BoxCollider");

  const propertySet = await callStructured("unity_set_component_property", {
    componentGlobalObjectId,
    propertyPath: "m_IsTrigger",
    valueKind: "boolean",
    boolValue: requestedTriggerValue,
    mutationId: `verify-prefab-property-set-${randomUUID()}`,
    expectedStateEpoch: readString(primaryInspect, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(primaryInspect, "stateRevision"),
  });
  if (propertySet.replayed !== false || propertySet.changed !== true) {
    throw new Error(
      `Prefab instance property write did not report a fresh change: ${JSON.stringify(propertySet)}`,
    );
  }

  primaryInspect = await inspectComponents(primaryInstanceGlobalObjectId);
  const overriddenCollider = findComponent(primaryInspect, "UnityEngine.BoxCollider");
  if (readString(overriddenCollider, "globalObjectId") !== componentGlobalObjectId) {
    throw new Error("BoxCollider identity changed after its serialized property edit.");
  }
  assertBooleanProperty(
    overriddenCollider,
    "m_IsTrigger",
    requestedTriggerValue,
    "overridden Prefab instance BoxCollider",
  );

  const prefabImmediatelyBeforeApply = await inspectPrefab(prefabPath);
  if (readString(prefabImmediatelyBeforeApply, "dependencyHash") !== dependencyHashBefore) {
    throw new Error(
      "The Prefab Asset changed before ApplyPropertyOverride; the instance-only property edit widened unexpectedly.",
    );
  }

  const applyMutationId = `verify-prefab-property-apply-${randomUUID()}`;
  const applyExpectedStateEpoch = readString(primaryInspect, "stateEpoch");
  const applyExpectedStateRevision = readPositiveInteger(primaryInspect, "stateRevision");
  const applied = await callStructured("unity_apply_prefab_property_override", {
    componentGlobalObjectId,
    propertyPath: "m_IsTrigger",
    prefabPath,
    expectedPrefabDependencyHash: dependencyHashBefore,
    mutationId: applyMutationId,
    expectedStateEpoch: applyExpectedStateEpoch,
    expectedStateRevision: applyExpectedStateRevision,
  });

  if (applied.applied !== true || applied.replayed !== false) {
    throw new Error(
      `First Prefab property apply did not report applied=true/replayed=false: ${JSON.stringify(applied)}`,
    );
  }
  if (
    readString(applied, "componentGlobalObjectId") !== componentGlobalObjectId ||
    readString(applied, "componentTypeName") !== "UnityEngine.BoxCollider" ||
    readString(applied, "propertyPath") !== "m_IsTrigger" ||
    readString(applied, "prefabPath") !== prefabPath ||
    readString(applied, "prefabGuid") !== prefabGuid
  ) {
    throw new Error(`Prefab property apply returned the wrong target metadata: ${JSON.stringify(applied)}`);
  }
  if (
    readString(applied, "expectedPrefabDependencyHash") !== dependencyHashBefore ||
    readString(applied, "dependencyHashBefore") !== dependencyHashBefore ||
    readString(applied, "expectedStateEpoch") !== applyExpectedStateEpoch ||
    readPositiveInteger(applied, "expectedStateRevision") !== applyExpectedStateRevision
  ) {
    throw new Error(`Prefab property apply did not preserve its preconditions: ${JSON.stringify(applied)}`);
  }

  const dependencyHashAfter = readString(applied, "dependencyHashAfter");
  if (dependencyHashAfter === dependencyHashBefore) {
    throw new Error("Prefab dependencyHash did not change after applying BoxCollider.m_IsTrigger false -> true.");
  }

  const afterApplyInspection = await inspectPrefab(prefabPath);
  if (
    readString(afterApplyInspection, "guid") !== prefabGuid ||
    readString(afterApplyInspection, "dependencyHash") !== dependencyHashAfter
  ) {
    throw new Error(`Native Prefab inspect did not match the apply result: ${JSON.stringify(afterApplyInspection)}`);
  }

  primaryInspect = await inspectComponents(primaryInstanceGlobalObjectId);
  assertBooleanProperty(
    findComponent(primaryInspect, "UnityEngine.BoxCollider"),
    "m_IsTrigger",
    requestedTriggerValue,
    "primary instance after apply",
  );

  const replay = await callStructured("unity_apply_prefab_property_override", {
    componentGlobalObjectId,
    propertyPath: "m_IsTrigger",
    prefabPath,
    expectedPrefabDependencyHash: dependencyHashBefore,
    mutationId: applyMutationId,
    expectedStateEpoch: applyExpectedStateEpoch,
    expectedStateRevision: applyExpectedStateRevision,
  });
  if (replay.replayed !== true || replay.applied !== true) {
    throw new Error(`Same-id Prefab property apply did not replay read-only: ${JSON.stringify(replay)}`);
  }
  if (readString(replay, "dependencyHashAfter") !== dependencyHashAfter) {
    throw new Error("Same-id Prefab property replay did not preserve the completed asset hash.");
  }

  const beforeReadbackInstantiate = await getStatus();
  const readbackInstantiate = await callStructured("unity_instantiate_prefab", {
    prefabPath,
    expectedPrefabDependencyHash: dependencyHashAfter,
    mutationId: `verify-prefab-property-readback-instance-${randomUUID()}`,
    expectedStateEpoch: readString(beforeReadbackInstantiate, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(beforeReadbackInstantiate, "stateRevision"),
  });
  readbackInstanceGlobalObjectId = readString(readbackInstantiate, "globalObjectId");
  const readbackInspect = await inspectComponents(readbackInstanceGlobalObjectId);
  assertBooleanProperty(
    findComponent(readbackInspect, "UnityEngine.BoxCollider"),
    "m_IsTrigger",
    requestedTriggerValue,
    "fresh instance created from the modified Prefab Asset",
  );

  await deleteGameObject(readbackInstanceGlobalObjectId, "fresh readback instance cleanup");
  readbackInstanceGlobalObjectId = "";
  await deleteGameObject(sourceGlobalObjectId, "temporary source cleanup");
  sourceGlobalObjectId = "";

  console.log("[Unity AI Bridge] Prefab property apply + fresh-instance native readback + same-id replay PASS.");
  console.log(
    `[Unity AI Bridge] NOW delete '${prefabPath}' ONCE in Unity's Project window. ` +
      "Keep the primary scene instance until the verifier finishes the stale-replay check.",
  );
  await waitForAssetAbsent(prefabPath);

  const staleReplayResult = await client.callTool({
    name: "unity_apply_prefab_property_override",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_IsTrigger",
      prefabPath,
      expectedPrefabDependencyHash: dependencyHashBefore,
      mutationId: applyMutationId,
      expectedStateEpoch: applyExpectedStateEpoch,
      expectedStateRevision: applyExpectedStateRevision,
    },
  });
  if (!staleReplayResult.isError) {
    throw new Error("Same-id Prefab property replay unexpectedly succeeded after the Prefab Asset was deleted.");
  }
  const staleReplayError = readToolText(staleReplayResult);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Prefab property stale replay returned the wrong error: ${staleReplayError}`);
  }

  await deleteGameObject(primaryInstanceGlobalObjectId, "primary Prefab instance cleanup");
  primaryInstanceGlobalObjectId = "";

  const finalStatus = await getStatus();
  console.log("[Unity AI Bridge] Prefab single-property apply MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: readString(finalStatus, "unityVersion"),
    prefabPath,
    prefabGuid,
    componentTypeName: "UnityEngine.BoxCollider",
    propertyPath: "m_IsTrigger",
    requestedTriggerValue,
    dependencyHashBefore,
    dependencyHashAfter,
    applyMutationId,
    applyVerified: true,
    independentFreshInstanceReadback: true,
    immediateReplay: true,
    manualAssetRemovalObserved: true,
    staleReplayError,
    temporarySceneObjectsRemoved: true,
  }, null, 2));
  completed = true;
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Prefab property apply MCP verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  for (const [id, label] of [
    [readbackInstanceGlobalObjectId, "readback instance"],
    [primaryInstanceGlobalObjectId, "primary instance"],
    [sourceGlobalObjectId, "source"],
  ] as const) {
    if (id.length === 0) continue;
    try {
      await deleteGameObject(id, `${label} best-effort cleanup`);
    } catch (cleanupError) {
      console.error(
        `[Unity AI Bridge] WARNING: failed to clean temporary ${label} ${id}: ${String(cleanupError)}`,
      );
    }
  }

  if (!completed) {
    try {
      const assetResult = await client.callTool({
        name: "unity_inspect_asset",
        arguments: { path: prefabPath, maxDependencies: 0 },
      });
      if (!assetResult.isError) {
        console.error(`[Unity AI Bridge] CLEANUP REQUIRED: delete '${prefabPath}' from Unity's Project window.`);
      }
    } catch {
      // The bridge can already be unavailable after a failure; the unique path printed above remains
      // sufficient for deterministic manual cleanup.
    }
  }

  await client.close();
}

async function waitForUnityReady(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastObservation = "No Unity status returned.";
  const requiredCapabilities = [
    "state.revision.v1",
    "component.inspect",
    "component.add",
    "component.property.set",
    "prefab.asset.create",
    "prefab.inspect",
    "prefab.instantiate",
    "prefab.property.apply",
  ];

  while (Date.now() < deadline) {
    try {
      const status = await getStatus();
      const capabilities = readArray(status, "capabilities");
      const missing = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
      if (missing.length === 0) return status;
      lastObservation = `Missing capabilities: ${missing.join(", ")}`;
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for the Prefab-property-capable Unity Agent. Last observation: ${lastObservation}. ` +
      "Reimport/recompile the package or restart Unity if it is still running an older assembly.",
  );
}

async function getStatus(): Promise<Record<string, unknown>> {
  return callStructured("unity_get_status", {});
}

async function inspectComponents(gameObjectGlobalObjectId: string): Promise<Record<string, unknown>> {
  return callStructured("unity_get_components", {
    gameObjectGlobalObjectId,
    maxComponents: 16,
    maxPropertiesPerComponent: 128,
    maxDepth: 4,
  });
}

async function inspectPrefab(path: string): Promise<Record<string, unknown>> {
  return callStructured("unity_inspect_prefab", { path, maxDepth: 1, maxNodes: 8 });
}

async function requireAssetAbsent(path: string): Promise<void> {
  const result = await client.callTool({
    name: "unity_inspect_asset",
    arguments: { path, maxDependencies: 0 },
  });
  if (!result.isError) {
    throw new Error(`Unique verification asset unexpectedly already exists at '${path}'.`);
  }
  const text = readToolText(result);
  if (!text.includes("stale_target/asset_unavailable")) {
    throw new Error(`Could not prove verification asset is absent: ${text}`);
  }
}

async function waitForAssetAbsent(path: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_inspect_asset",
      arguments: { path, maxDependencies: 0 },
    });
    if (result.isError && readToolText(result).includes("stale_target/asset_unavailable")) return;
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for '${path}' to be deleted in Unity's Project window.`);
}

async function deleteGameObject(globalObjectId: string, label: string): Promise<void> {
  if (globalObjectId.length === 0) return;
  const resolved = await callStructured("unity_resolve_object", { globalObjectId });
  if (resolved.found === false) return;
  if (resolved.found !== true || resolved.isGameObject !== true) {
    throw new Error(`${label}: target did not resolve as a GameObject: ${JSON.stringify(resolved)}`);
  }
  const deleted = await callStructured("unity_delete_game_object", {
    globalObjectId,
    mutationId: `verify-prefab-property-cleanup-${randomUUID()}`,
    expectedStateEpoch: readString(resolved, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(resolved, "stateRevision"),
  });
  if (deleted.deleted !== true) {
    throw new Error(`${label}: unity_delete_game_object did not report deleted=true.`);
  }
}

function findComponent(
  inspection: Record<string, unknown>,
  typeName: string,
): Record<string, unknown> {
  const component = readArray(inspection, "components").find(
    (entry) => isRecord(entry) && entry.missingScript === false && entry.typeName === typeName,
  );
  if (!isRecord(component)) {
    throw new Error(`Component inspection did not return ${typeName}: ${JSON.stringify(inspection)}`);
  }
  return component;
}

function assertBooleanProperty(
  component: Record<string, unknown>,
  path: string,
  expected: boolean,
  label: string,
): void {
  const property = readArray(component, "properties").find(
    (entry) => isRecord(entry) && entry.path === path,
  );
  if (!isRecord(property)) {
    throw new Error(`${label}: serialized property ${path} was not returned.`);
  }
  if (property.valueKind !== "boolean" || property.boolValue !== expected) {
    throw new Error(`${label}: ${path} expected boolean ${expected}, got ${JSON.stringify(property)}.`);
  }
}

async function callStructured(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError || !isRecord(result.structuredContent)) {
    throw new Error(`${name} failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((block) => block.type === "text")?.text ?? "tool returned no text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} was not an object.`);
  return value;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${key} was not an array.`);
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} was not a non-empty string.`);
  }
  return value;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} was not a positive safe integer.`);
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
