import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const propertyPath = "m_IsTrigger";

const client = new Client({
  name: "unity-ai-bridge-prefab-property-apply-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({ command: "node", args: ["dist/src/index.js"] });

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const requiredTools = [
    "unity_get_status",
    "unity_create_game_object",
    "unity_resolve_object",
    "unity_add_component",
    "unity_get_components",
    "unity_set_component_property",
    "unity_create_prefab_asset",
    "unity_inspect_prefab",
    "unity_instantiate_prefab",
    "unity_apply_prefab_property_override",
    "unity_delete_game_object",
    "unity_inspect_asset",
  ];
  const { tools } = await client.listTools();
  for (const required of requiredTools) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Unity Editor to connect to the local bridge...");
  const ready = await waitForStatus();
  console.log(`[Unity AI Bridge] Unity connection ready: ${ready.unityVersion} / ${ready.activeScene}`);

  const suffix = `${Date.now()}_${randomUUID().replaceAll("-", "")}`;
  const sourceName = `MCP_Prefab_Property_Apply_Verify_${Date.now()}`;
  const prefabPath = `Assets/UnityAiBridge_Prefab_Property_Apply_Verify_${suffix}.prefab`;
  const createSourceMutationId = `verify-prefab-apply-source-${randomUUID()}`;
  const addColliderMutationId = `verify-prefab-apply-collider-${randomUUID()}`;
  const createAssetMutationId = `verify-prefab-apply-asset-${randomUUID()}`;
  const firstInstanceMutationId = `verify-prefab-apply-instance-a-${randomUUID()}`;
  const setTrueMutationId = `verify-prefab-apply-set-true-${randomUUID()}`;
  const applyMutationId = `verify-prefab-property-apply-${randomUUID()}`;
  const secondInstanceMutationId = `verify-prefab-apply-instance-b-${randomUUID()}`;
  const setFalseMutationId = `verify-prefab-apply-set-false-${randomUUID()}`;

  const sourceCreate = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name: sourceName, mutationId: createSourceMutationId },
  });
  requireSuccess(sourceCreate, "Temporary source create");
  const sourceId = readString(sourceCreate.structuredContent, "globalObjectId");

  let sourceState = await resolve(sourceId);
  const addCollider = await client.callTool({
    name: "unity_add_component",
    arguments: {
      gameObjectGlobalObjectId: sourceId,
      typeName: "UnityEngine.BoxCollider",
      mutationId: addColliderMutationId,
      expectedStateEpoch: sourceState.stateEpoch,
      expectedStateRevision: sourceState.stateRevision,
    },
  });
  requireSuccess(addCollider, "Source BoxCollider add");

  sourceState = await resolve(sourceId);
  const assetCreate = await client.callTool({
    name: "unity_create_prefab_asset",
    arguments: {
      sourceGlobalObjectId: sourceId,
      destinationPath: prefabPath,
      mutationId: createAssetMutationId,
      expectedStateEpoch: sourceState.stateEpoch,
      expectedStateRevision: sourceState.stateRevision,
    },
  });
  requireSuccess(assetCreate, "Prefab Asset create");
  const createdGuid = readString(assetCreate.structuredContent, "prefabGuid");

  // The source is no longer needed once the Prefab Asset exists.
  sourceState = await resolve(sourceId);
  const sourceDelete = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: sourceId,
      mutationId: `verify-prefab-apply-source-cleanup-${randomUUID()}`,
      expectedStateEpoch: sourceState.stateEpoch,
      expectedStateRevision: sourceState.stateRevision,
    },
  });
  requireSuccess(sourceDelete, "Source cleanup delete");

  const beforeInspect = await inspectPrefab(prefabPath);
  const hashBefore = beforeInspect.dependencyHash;

  const beforeFirstInstance = await waitForStatus();
  const firstInstanceCall = await client.callTool({
    name: "unity_instantiate_prefab",
    arguments: {
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: firstInstanceMutationId,
      expectedStateEpoch: beforeFirstInstance.stateEpoch,
      expectedStateRevision: beforeFirstInstance.stateRevision,
    },
  });
  requireSuccess(firstInstanceCall, "First Prefab instantiate");
  const firstInstanceId = readString(firstInstanceCall.structuredContent, "globalObjectId");

  let firstComponents = await inspectComponents(firstInstanceId);
  const firstColliderId = requireBoxCollider(firstComponents).globalObjectId;
  const setTrue = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId: firstColliderId,
      propertyPath,
      value: { kind: "boolean", boolValue: true },
      mutationId: setTrueMutationId,
      expectedStateEpoch: firstComponents.stateEpoch,
      expectedStateRevision: firstComponents.stateRevision,
    },
  });
  requireSuccess(setTrue, "BoxCollider override set true");

  const stillBeforeApply = await inspectPrefab(prefabPath);
  if (stillBeforeApply.dependencyHash !== hashBefore) {
    throw new Error("Prefab dependencyHash changed before the explicit property apply.");
  }

  firstComponents = await inspectComponents(firstInstanceId);
  const colliderBeforeApply = requireBoxCollider(firstComponents);
  if (readBooleanProperty(colliderBeforeApply, propertyPath) !== true) {
    throw new Error("Instance BoxCollider m_IsTrigger is not true before apply.");
  }

  const applyCall = await client.callTool({
    name: "unity_apply_prefab_property_override",
    arguments: {
      componentGlobalObjectId: firstColliderId,
      propertyPath,
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: applyMutationId,
      expectedStateEpoch: firstComponents.stateEpoch,
      expectedStateRevision: firstComponents.stateRevision,
    },
  });
  requireSuccess(applyCall, "Prefab property apply");
  const applyPayload = requireApplyPayload(applyCall.structuredContent);
  if (applyPayload.replayed || !applyPayload.applied ||
      applyPayload.prefabOverrideBefore !== true || applyPayload.prefabOverrideAfter !== false ||
      applyPayload.sourceMatchesInstanceAfter !== true || applyPayload.dependencyHashAfter === hashBefore) {
    throw new Error(`Unexpected apply payload: ${JSON.stringify(applyCall.structuredContent)}`);
  }
  const hashAfter = applyPayload.dependencyHashAfter;

  const assetAfter = await inspectPrefab(prefabPath);
  if (assetAfter.dependencyHash !== hashAfter || assetAfter.guid !== createdGuid) {
    throw new Error("Prefab native GUID/hash readback does not match the property apply result.");
  }

  const instanceAfter = await inspectComponents(firstInstanceId);
  if (readBooleanProperty(requireBoxCollider(instanceAfter), propertyPath) !== true) {
    throw new Error("Applied instance property did not remain true after apply.");
  }

  const immediateReplay = await client.callTool({
    name: "unity_apply_prefab_property_override",
    arguments: {
      componentGlobalObjectId: firstColliderId,
      propertyPath,
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: applyMutationId,
      expectedStateEpoch: firstComponents.stateEpoch,
      expectedStateRevision: firstComponents.stateRevision,
    },
  });
  requireSuccess(immediateReplay, "Immediate property-apply replay");
  const replayPayload = requireApplyPayload(immediateReplay.structuredContent);
  if (!replayPayload.replayed || replayPayload.dependencyHashAfter !== hashAfter) {
    throw new Error("Immediate property-apply replay did not return the completed result.");
  }

  // Instantiate a new copy from the changed asset. This proves the property was persisted to the asset,
  // not merely cleared locally on the first instance.
  const beforeSecondInstance = await waitForStatus();
  const secondInstanceCall = await client.callTool({
    name: "unity_instantiate_prefab",
    arguments: {
      prefabPath,
      expectedPrefabDependencyHash: hashAfter,
      mutationId: secondInstanceMutationId,
      expectedStateEpoch: beforeSecondInstance.stateEpoch,
      expectedStateRevision: beforeSecondInstance.stateRevision,
    },
  });
  requireSuccess(secondInstanceCall, "Second Prefab instantiate");
  const secondInstanceId = readString(secondInstanceCall.structuredContent, "globalObjectId");
  const secondComponents = await inspectComponents(secondInstanceId);
  if (readBooleanProperty(requireBoxCollider(secondComponents), propertyPath) !== true) {
    throw new Error("A fresh Prefab instance did not inherit applied m_IsTrigger=true from the asset.");
  }

  // Create a later override on the original instance. The old apply mutationId must not apply this
  // newer intent, even though it targets the same component/property.
  firstComponents = await inspectComponents(firstInstanceId);
  const setFalse = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId: firstColliderId,
      propertyPath,
      value: { kind: "boolean", boolValue: false },
      mutationId: setFalseMutationId,
      expectedStateEpoch: firstComponents.stateEpoch,
      expectedStateRevision: firstComponents.stateRevision,
    },
  });
  requireSuccess(setFalse, "Later BoxCollider override set false");

  const staleReplay = await client.callTool({
    name: "unity_apply_prefab_property_override",
    arguments: {
      componentGlobalObjectId: firstColliderId,
      propertyPath,
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: applyMutationId,
      expectedStateEpoch: firstComponents.stateEpoch,
      expectedStateRevision: firstComponents.stateRevision,
    },
  });
  if (!staleReplay.isError) {
    throw new Error("Old property-apply mutationId unexpectedly applied a later override.");
  }
  const staleReplayError = readToolText(staleReplay);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Old property-apply mutation returned the wrong stale error: ${staleReplayError}`);
  }

  await deleteGameObject(firstInstanceId, "first instance cleanup");
  await deleteGameObject(secondInstanceId, "second instance cleanup");

  console.log(`[Unity AI Bridge] NOW delete only '${prefabPath}' in Unity's Project window.`);
  await waitForAssetRemoval(prefabPath);

  console.log("[Unity AI Bridge] Prefab property apply reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: ready.unityVersion,
    prefabPath,
    prefabGuid: createdGuid,
    propertyPath,
    componentGlobalObjectId: firstColliderId,
    applyMutationId,
    hashBefore,
    hashAfter,
    applyVerified: true,
    propertyOverrideCleared: true,
    sourceMatchesInstanceAfter: true,
    immediateReplay: true,
    freshInstanceInheritedAppliedValue: true,
    laterOverrideProtectedByStaleReplay: true,
    staleReplayError,
    temporaryInstancesRemoved: true,
    manualAssetRemovalObserved: true,
    temporarySourceRemoved: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Prefab property apply verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForStatus(): Promise<StatusPayload> {
  const deadline = Date.now() + timeoutMs;
  let last = "no status";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError) {
      const parsed = parseStatus(result.structuredContent);
      if (parsed !== null && !parsed.isCompiling) return parsed;
      last = JSON.stringify(result.structuredContent);
    } else {
      last = readToolText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Unity. Last observation: ${last}`);
}

async function resolve(globalObjectId: string): Promise<ResolvedPayload> {
  const result = await client.callTool({ name: "unity_resolve_object", arguments: { globalObjectId } });
  requireSuccess(result, "Object resolve");
  const c = asRecord(result.structuredContent);
  if (c.found !== true || typeof c.stateEpoch !== "string" || !isPositiveInteger(c.stateRevision)) {
    throw new Error(`Invalid resolver payload: ${JSON.stringify(result.structuredContent)}`);
  }
  return { stateEpoch: c.stateEpoch, stateRevision: c.stateRevision };
}

async function inspectPrefab(path: string): Promise<{ guid: string; dependencyHash: string }> {
  const result = await client.callTool({
    name: "unity_inspect_prefab",
    arguments: { path, maxDepth: 1, maxNodes: 20 },
  });
  requireSuccess(result, "Prefab inspect");
  const c = asRecord(result.structuredContent);
  if (typeof c.guid !== "string" || c.guid.length === 0 ||
      typeof c.dependencyHash !== "string" || c.dependencyHash.length === 0) {
    throw new Error(`Invalid Prefab inspect payload: ${JSON.stringify(result.structuredContent)}`);
  }
  return { guid: c.guid, dependencyHash: c.dependencyHash };
}

async function inspectComponents(gameObjectGlobalObjectId: string): Promise<ComponentsPayload> {
  const result = await client.callTool({
    name: "unity_get_components",
    arguments: {
      gameObjectGlobalObjectId,
      maxComponents: 16,
      maxPropertiesPerComponent: 128,
      maxDepth: 4,
    },
  });
  requireSuccess(result, "Component inspect");
  const c = asRecord(result.structuredContent);
  if (!Array.isArray(c.components) || typeof c.stateEpoch !== "string" || !isPositiveInteger(c.stateRevision)) {
    throw new Error(`Invalid component inspect payload: ${JSON.stringify(result.structuredContent)}`);
  }
  return {
    stateEpoch: c.stateEpoch,
    stateRevision: c.stateRevision,
    components: c.components.map(asRecord),
  };
}

function requireBoxCollider(payload: ComponentsPayload): Record<string, unknown> {
  const collider = payload.components.find((entry) => entry.typeName === "UnityEngine.BoxCollider");
  if (collider === undefined || typeof collider.globalObjectId !== "string") {
    throw new Error(`BoxCollider was not found: ${JSON.stringify(payload.components)}`);
  }
  return collider;
}

function readBooleanProperty(component: Record<string, unknown>, path: string): boolean {
  const properties = component.properties;
  if (!Array.isArray(properties)) throw new Error("Component property list is unavailable.");
  const property = properties.map(asRecord).find((entry) => entry.path === path);
  if (property === undefined || property.valueKind !== "boolean" || typeof property.boolValue !== "boolean") {
    throw new Error(`Boolean property '${path}' was not found.`);
  }
  return property.boolValue;
}

function requireApplyPayload(value: unknown): ApplyPayload {
  const c = asRecord(value);
  if (c.applied !== true || typeof c.replayed !== "boolean" ||
      typeof c.dependencyHashAfter !== "string" || c.dependencyHashAfter.length === 0 ||
      typeof c.prefabOverrideBefore !== "boolean" || typeof c.prefabOverrideAfter !== "boolean" ||
      typeof c.sourceMatchesInstanceAfter !== "boolean") {
    throw new Error(`Invalid prefab property apply payload: ${JSON.stringify(value)}`);
  }
  return {
    applied: true,
    replayed: c.replayed,
    dependencyHashAfter: c.dependencyHashAfter,
    prefabOverrideBefore: c.prefabOverrideBefore,
    prefabOverrideAfter: c.prefabOverrideAfter,
    sourceMatchesInstanceAfter: c.sourceMatchesInstanceAfter,
  };
}

async function deleteGameObject(globalObjectId: string, label: string): Promise<void> {
  const state = await resolve(globalObjectId);
  const result = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId,
      mutationId: `verify-prefab-apply-cleanup-${randomUUID()}`,
      expectedStateEpoch: state.stateEpoch,
      expectedStateRevision: state.stateRevision,
    },
  });
  requireSuccess(result, label);
}

async function waitForAssetRemoval(path: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_inspect_asset",
      arguments: { path, maxDependencies: 0 },
    });
    if (result.isError) return;
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for manual removal of '${path}'.`);
}

function requireSuccess(result: { isError?: boolean; content: Array<{ type: string; text?: string }> }, label: string): void {
  if (result.isError) throw new Error(`${label} failed: ${readToolText(result)}`);
}

function readString(value: unknown, key: string): string {
  const c = asRecord(value);
  const result = c[key];
  if (typeof result !== "string" || result.length === 0) {
    throw new Error(`Missing string '${key}' in ${JSON.stringify(value)}`);
  }
  return result;
}

function parseStatus(value: unknown): StatusPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.unityVersion !== "string" || typeof c.activeScene !== "string" ||
      typeof c.isCompiling !== "boolean" || typeof c.stateEpoch !== "string" ||
      !isPositiveInteger(c.stateRevision)) return null;
  return {
    unityVersion: c.unityVersion,
    activeScene: c.activeScene,
    isCompiling: c.isCompiling,
    stateEpoch: c.stateEpoch,
    stateRevision: c.stateRevision,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StatusPayload = {
  unityVersion: string;
  activeScene: string;
  isCompiling: boolean;
  stateEpoch: string;
  stateRevision: number;
};

type ResolvedPayload = { stateEpoch: string; stateRevision: number };
type ComponentsPayload = {
  stateEpoch: string;
  stateRevision: number;
  components: Record<string, unknown>[];
};
type ApplyPayload = {
  applied: true;
  replayed: boolean;
  dependencyHashAfter: string;
  prefabOverrideBefore: boolean;
  prefabOverrideAfter: boolean;
  sourceMatchesInstanceAfter: boolean;
};
