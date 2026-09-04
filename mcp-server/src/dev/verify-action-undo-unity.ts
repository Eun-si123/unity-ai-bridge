import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  isBridgeActionHistoryPayload,
  isBridgeActionUndoPayload,
  type BridgeActionHistoryPayload,
  type BridgeActionUndoPayload,
} from "../bridge/action-bridge.js";

const timeoutMs = 90_000;
const pollIntervalMs = 300;
const client = new Client({
  name: "unity-ai-bridge-action-undo-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

let cleanupGlobalObjectId: string | undefined;
let cleanupName: string | undefined;

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of [
    "unity_get_status",
    "unity_get_hierarchy",
    "unity_create_game_object",
    "unity_resolve_object",
    "unity_get_transform",
    "unity_set_transform",
    "unity_delete_game_object",
    "unity_get_bridge_action_history",
    "unity_undo_last_bridge_action",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  await waitForCapabilities();
  const initialHierarchy = await readHierarchy();
  assertPersistentScene(initialHierarchy.scenePath);

  // 1) Latest create is safe to undo, and native state proves the object is gone.
  const firstName = `MCP_ActionUndo_Create_${Date.now()}`;
  const firstCreateMutationId = `verify-action-undo-create-${randomUUID()}`;
  const firstCreate = await createAgainstFreshSnapshot(firstName, firstCreateMutationId);
  cleanupGlobalObjectId = firstCreate.globalObjectId;
  cleanupName = firstName;

  const firstHistory = await readActionHistory(10);
  const firstAction = requireSafeLatest(firstHistory, firstCreateMutationId, "gameObject.create");
  const firstUndo = await undoLast(firstAction.mutationId, firstHistory);
  assertUndoMatchesAction(firstUndo, firstAction.undoGroup, firstAction.undoGroupName);

  const firstAfterUndo = await resolveObject(firstCreate.globalObjectId);
  if (firstAfterUndo.found) {
    throw new Error(`Created verifier object still exists after safe Undo: ${JSON.stringify(firstAfterUndo)}`);
  }
  cleanupGlobalObjectId = undefined;
  cleanupName = undefined;

  const historyAfterFirstUndo = await readActionHistory(10);
  const firstUndoneRecord = requireLatestEntry(historyAfterFirstUndo, "after first Undo");
  if (
    firstUndoneRecord.mutationId !== firstCreateMutationId ||
    !firstUndoneRecord.undone ||
    firstUndoneRecord.safeToUndoNow ||
    firstUndoneRecord.unsafeReason !== "latest_action_already_undone"
  ) {
    throw new Error(
      `Undone latest action did not become fail-closed: ${JSON.stringify(firstUndoneRecord)}`,
    );
  }

  // 2) An older bridge action must be refused while the real latest Transform remains undoable.
  const secondName = `MCP_ActionUndo_Transform_${Date.now()}`;
  const secondCreateMutationId = `verify-action-undo-second-create-${randomUUID()}`;
  const secondCreate = await createAgainstFreshSnapshot(secondName, secondCreateMutationId);
  cleanupGlobalObjectId = secondCreate.globalObjectId;
  cleanupName = secondName;

  const baseline = await readTransform(secondCreate.globalObjectId);
  const requestedPosition = {
    x: baseline.localPosition.x + 2.25,
    y: baseline.localPosition.y - 1.5,
    z: baseline.localPosition.z + 4.75,
  };
  const transformMutationId = `verify-action-undo-transform-${randomUUID()}`;
  await setTransformAgainstFreshReadback(
    secondCreate.globalObjectId,
    requestedPosition,
    transformMutationId,
  );

  const transformed = await readTransform(secondCreate.globalObjectId);
  assertVectorApproximately(transformed.localPosition, requestedPosition, "transformed localPosition");

  const transformHistory = await readActionHistory(10);
  const transformAction = requireSafeLatest(transformHistory, transformMutationId, "transform.set");
  const createRecord = transformHistory.actions.find(
    (action) => action.mutationId === secondCreateMutationId,
  );
  if (createRecord === undefined || createRecord.isLatest || createRecord.safeToUndoNow) {
    throw new Error(
      `Older create action was not represented as non-latest/unsafe: ${JSON.stringify(createRecord)}`,
    );
  }

  const oldUndoAttempt = await client.callTool({
    name: "unity_undo_last_bridge_action",
    arguments: {
      mutationId: secondCreateMutationId,
      expectedStateEpoch: transformHistory.stateEpoch,
      expectedStateRevision: transformHistory.stateRevision,
    },
  });
  if (!oldUndoAttempt.isError) {
    throw new Error(
      `Older mutationId unexpectedly succeeded as an Undo target: ${JSON.stringify(oldUndoAttempt.structuredContent)}`,
    );
  }
  const oldUndoError = readToolText(oldUndoAttempt);
  if (!oldUndoError.includes("not the latest bridge action")) {
    throw new Error(`Older-action Undo failed for an unexpected reason: ${oldUndoError}`);
  }

  const stillTransformed = await readTransform(secondCreate.globalObjectId);
  assertVectorApproximately(
    stillTransformed.localPosition,
    requestedPosition,
    "localPosition after rejected older-action Undo",
  );

  const transformUndo = await undoLast(transformAction.mutationId, transformHistory);
  assertUndoMatchesAction(transformUndo, transformAction.undoGroup, transformAction.undoGroupName);

  const restored = await readTransform(secondCreate.globalObjectId);
  assertVectorApproximately(restored.localPosition, baseline.localPosition, "restored localPosition");
  assertVectorApproximately(restored.localScale, baseline.localScale, "restored localScale");
  assertVectorApproximately(
    restored.localEulerAngles,
    baseline.localEulerAngles,
    "restored localEulerAngles",
    0.01,
  );

  const historyAfterTransformUndo = await readActionHistory(10);
  const transformUndoneRecord = requireLatestEntry(historyAfterTransformUndo, "after Transform Undo");
  if (
    transformUndoneRecord.mutationId !== transformMutationId ||
    !transformUndoneRecord.undone ||
    transformUndoneRecord.safeToUndoNow
  ) {
    throw new Error(
      `Transform action remained undoable after one safe Undo: ${JSON.stringify(transformUndoneRecord)}`,
    );
  }

  await deleteAgainstFreshSnapshot(
    secondCreate.globalObjectId,
    `verify-action-undo-cleanup-${randomUUID()}`,
  );
  cleanupGlobalObjectId = undefined;
  cleanupName = undefined;

  const finalHierarchy = await readHierarchy();
  const remaining = finalHierarchy.nodes.filter(
    (node) =>
      node.globalObjectId === secondCreate.globalObjectId ||
      node.name === firstName ||
      node.name === secondName,
  );
  if (remaining.length !== 0) {
    throw new Error(`Action Undo verifier left temporary objects behind: ${JSON.stringify(remaining)}`);
  }

  console.log("[Unity AI Bridge] Bridge action history + safe last-action Undo verification PASS:");
  console.log(JSON.stringify({
    unityVersion: (await readStatus()).unityVersion,
    activeScenePath: initialHierarchy.scenePath,
    firstCreateMutationId,
    firstCreateUndoGroup: firstAction.undoGroup,
    firstCreateUndoVerifiedByNativeAbsence: true,
    firstCreateCannotUndoTwice: true,
    secondCreateMutationId,
    transformMutationId,
    transformUndoGroup: transformAction.undoGroup,
    olderCreateUndoRejected: true,
    rejectedOlderUndoLeftTransformUnchanged: true,
    transformRestoredExactly: true,
    latestUndoneActionNotReexposedAsSafe: true,
    temporaryObjectRemaining: false,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Bridge action Undo verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  if (cleanupGlobalObjectId !== undefined) {
    await bestEffortDelete(cleanupGlobalObjectId);
  }
  await client.close();
}

async function waitForCapabilities(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No Unity status received.";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError && isRecord(result.structuredContent)) {
      const capabilities = result.structuredContent.capabilities;
      if (
        Array.isArray(capabilities) &&
        capabilities.includes("action.history") &&
        capabilities.includes("action.undoLast") &&
        capabilities.includes("state.revision.v1")
      ) {
        return;
      }
      last = JSON.stringify(result.structuredContent);
    } else {
      last = readToolText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for action.history/action.undoLast capabilities. Last observation: ${last}. Reimport/restart Unity if it is still running an older Agent assembly.`,
  );
}

async function readActionHistory(maxResults: number): Promise<BridgeActionHistoryPayload> {
  const result = await client.callTool({
    name: "unity_get_bridge_action_history",
    arguments: { maxResults },
  });
  if (result.isError) {
    throw new Error(`unity_get_bridge_action_history failed: ${readToolText(result)}`);
  }
  if (!isBridgeActionHistoryPayload(result.structuredContent)) {
    throw new Error(
      `Invalid action history structuredContent: ${JSON.stringify(result.structuredContent)}`,
    );
  }
  return result.structuredContent;
}

async function undoLast(
  mutationId: string,
  history: BridgeActionHistoryPayload,
): Promise<BridgeActionUndoPayload> {
  const result = await client.callTool({
    name: "unity_undo_last_bridge_action",
    arguments: {
      mutationId,
      expectedStateEpoch: history.stateEpoch,
      expectedStateRevision: history.stateRevision,
    },
  });
  if (result.isError) {
    throw new Error(`unity_undo_last_bridge_action failed: ${readToolText(result)}`);
  }
  if (!isBridgeActionUndoPayload(result.structuredContent)) {
    throw new Error(
      `Invalid safe Undo structuredContent: ${JSON.stringify(result.structuredContent)}`,
    );
  }
  return result.structuredContent;
}

function requireSafeLatest(
  history: BridgeActionHistoryPayload,
  mutationId: string,
  operation: string,
): BridgeActionHistoryPayload["actions"][number] {
  const action = requireLatestEntry(history, `while requiring safe ${operation}`);
  if (
    action.mutationId !== mutationId ||
    action.operation !== operation ||
    !action.isLatest ||
    !action.safeToUndoNow ||
    action.unsafeReason !== ""
  ) {
    throw new Error(
      `Expected latest ${operation}/${mutationId} to be the exact safe Unity Undo top: ${JSON.stringify(action)}`,
    );
  }
  if (
    action.stateAfterEpoch !== history.stateEpoch ||
    action.stateAfterRevision !== history.stateRevision
  ) {
    throw new Error(
      `History current state does not match latest action completion state: history=${history.stateEpoch}/${history.stateRevision} action=${action.stateAfterEpoch}/${action.stateAfterRevision}`,
    );
  }
  return action;
}

function requireLatestEntry(
  history: BridgeActionHistoryPayload,
  context: string,
): BridgeActionHistoryPayload["actions"][number] {
  const action = history.actions[0];
  if (action === undefined) {
    throw new Error(`Action history unexpectedly empty ${context}.`);
  }
  return action;
}

function assertUndoMatchesAction(
  undo: BridgeActionUndoPayload,
  undoGroup: number,
  undoName: string,
): void {
  if (
    !undo.undone ||
    undo.undoGroup !== undoGroup ||
    undo.observedUndoGroup !== undoGroup ||
    undo.undoGroupName !== undoName ||
    undo.observedUndoName !== undoName
  ) {
    throw new Error(`Undo event did not match recorded bridge action: ${JSON.stringify(undo)}`);
  }
}

async function createAgainstFreshSnapshot(name: string, mutationId: string): Promise<CreatePayload> {
  let last = "No attempt.";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await readHierarchy();
    assertPersistentScene(snapshot.scenePath);
    const result = await client.callTool({
      name: "unity_create_game_object",
      arguments: {
        name,
        mutationId,
        expectedStateEpoch: snapshot.stateEpoch,
        expectedStateRevision: snapshot.stateRevision,
      },
    });
    if (!result.isError) {
      if (!isCreatePayload(result.structuredContent)) {
        throw new Error(`Invalid create structuredContent: ${JSON.stringify(result.structuredContent)}`);
      }
      return result.structuredContent;
    }
    last = readToolText(result);
    if (last.includes("state_revision_mismatch")) continue;
    throw new Error(`Create failed unexpectedly: ${last}`);
  }
  throw new Error(`Could not obtain a stable create window: ${last}`);
}

async function setTransformAgainstFreshReadback(
  globalObjectId: string,
  localPosition: Vector3,
  mutationId: string,
): Promise<void> {
  let last = "No attempt.";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const current = await readTransform(globalObjectId);
    const result = await client.callTool({
      name: "unity_set_transform",
      arguments: {
        globalObjectId,
        localPosition,
        localEulerAngles: current.localEulerAngles,
        localScale: current.localScale,
        mutationId,
        expectedStateEpoch: current.stateEpoch,
        expectedStateRevision: current.stateRevision,
      },
    });
    if (!result.isError) return;
    last = readToolText(result);
    if (last.includes("state_revision_mismatch")) continue;
    throw new Error(`Transform set failed unexpectedly: ${last}`);
  }
  throw new Error(`Could not obtain a stable transform write window: ${last}`);
}

async function deleteAgainstFreshSnapshot(globalObjectId: string, mutationId: string): Promise<void> {
  let last = "No attempt.";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await readHierarchy();
    const result = await client.callTool({
      name: "unity_delete_game_object",
      arguments: {
        globalObjectId,
        mutationId,
        expectedStateEpoch: snapshot.stateEpoch,
        expectedStateRevision: snapshot.stateRevision,
      },
    });
    if (!result.isError) return;
    last = readToolText(result);
    if (last.includes("state_revision_mismatch")) continue;
    throw new Error(`Delete failed unexpectedly: ${last}`);
  }
  throw new Error(`Could not obtain a stable delete window: ${last}`);
}

async function bestEffortDelete(globalObjectId: string): Promise<void> {
  try {
    const resolved = await resolveObject(globalObjectId);
    if (!resolved.found) return;
    await deleteAgainstFreshSnapshot(
      globalObjectId,
      `verify-action-undo-best-effort-cleanup-${randomUUID()}`,
    );
  } catch (error) {
    console.error(
      `[Unity AI Bridge] Cleanup warning: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (cleanupName !== undefined) {
      console.error(`[Unity AI Bridge] Temporary object may remain: ${cleanupName}`);
    }
  }
}

async function readHierarchy(): Promise<HierarchyPayload> {
  const result = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: { maxDepth: 32, maxNodes: 500 },
  });
  if (result.isError || !isHierarchyPayload(result.structuredContent)) {
    throw new Error(`Hierarchy read failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function readTransform(globalObjectId: string): Promise<TransformPayload> {
  const result = await client.callTool({
    name: "unity_get_transform",
    arguments: { globalObjectId },
  });
  if (result.isError || !isTransformPayload(result.structuredContent)) {
    throw new Error(`Transform read failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function resolveObject(globalObjectId: string): Promise<ResolvePayload> {
  const result = await client.callTool({
    name: "unity_resolve_object",
    arguments: { globalObjectId },
  });
  if (result.isError || !isResolvePayload(result.structuredContent)) {
    throw new Error(`Object resolve failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function readStatus(): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: "unity_get_status", arguments: {} });
  if (result.isError || !isRecord(result.structuredContent)) {
    throw new Error(`Status read failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

function assertPersistentScene(scenePath: string): void {
  if (scenePath.length === 0) {
    throw new Error(
      "The active Unity scene is unsaved/temporary. Open or save a persistent scene asset before running verify:action-undo.",
    );
  }
}

function assertVectorApproximately(
  actual: Vector3,
  expected: Vector3,
  label: string,
  tolerance = 0.0001,
): void {
  if (
    Math.abs(actual.x - expected.x) > tolerance ||
    Math.abs(actual.y - expected.y) > tolerance ||
    Math.abs(actual.z - expected.z) > tolerance
  ) {
    throw new Error(
      `${label} mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
}

function readToolText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "No tool text.";
  return result.content
    .filter((item): item is { type: string; text: string } =>
      isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isState(value: Record<string, unknown>): boolean {
  return typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    Number.isSafeInteger(value.stateRevision) && (value.stateRevision as number) > 0;
}

function isCreatePayload(value: unknown): value is CreatePayload {
  return isRecord(value) &&
    typeof value.globalObjectId === "string" && value.globalObjectId.length > 0 &&
    typeof value.name === "string" &&
    isState(value);
}

function isHierarchyPayload(value: unknown): value is HierarchyPayload {
  return isRecord(value) &&
    typeof value.scenePath === "string" &&
    Array.isArray(value.nodes) &&
    isState(value);
}

function isResolvePayload(value: unknown): value is ResolvePayload {
  return isRecord(value) && typeof value.found === "boolean" && isState(value);
}

function isVector3(value: unknown): value is Vector3 {
  return isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.z === "number";
}

function isTransformPayload(value: unknown): value is TransformPayload {
  return isRecord(value) &&
    isVector3(value.localPosition) &&
    isVector3(value.localEulerAngles) &&
    isVector3(value.localScale) &&
    isState(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Vector3 = { x: number; y: number; z: number };
type CreatePayload = {
  globalObjectId: string;
  name: string;
  stateEpoch: string;
  stateRevision: number;
};
type HierarchyPayload = {
  scenePath: string;
  stateEpoch: string;
  stateRevision: number;
  nodes: Array<{ globalObjectId: string; name: string }>;
};
type ResolvePayload = {
  found: boolean;
  stateEpoch: string;
  stateRevision: number;
};
type TransformPayload = {
  localPosition: Vector3;
  localEulerAngles: Vector3;
  localScale: Vector3;
  stateEpoch: string;
  stateRevision: number;
};
