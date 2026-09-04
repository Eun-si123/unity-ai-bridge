import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  isCheckpointRestorePayload,
  isCheckpointSnapshotPayload,
  type CheckpointRestorePayload,
  type CheckpointSnapshotPayload,
} from "../bridge/checkpoint-bridge.js";

const timeoutMs = 90_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-checkpoint-restore-verifier",
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
    "unity_update_game_object",
    "unity_delete_game_object",
    "unity_capture_checkpoint",
    "unity_get_checkpoint",
    "unity_restore_checkpoint",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  await waitForCapabilities();
  const initialHierarchy = await readHierarchy();
  assertPersistentScene(initialHierarchy.scenePath);

  const originalName = `MCP_Checkpoint_${Date.now()}`;
  const createMutationId = `verify-checkpoint-create-${randomUUID()}`;
  const created = await createAgainstFreshSnapshot(originalName, createMutationId);
  cleanupGlobalObjectId = created.globalObjectId;
  cleanupName = originalName;

  const initialObject = await resolveObject(created.globalObjectId);
  if (!initialObject.found || initialObject.name !== originalName || !initialObject.activeSelf) {
    throw new Error(`Unexpected initial object readback: ${JSON.stringify(initialObject)}`);
  }
  const initialTransform = await readTransform(created.globalObjectId);

  const stateBeforeCapture = await readState();
  const checkpoint = await captureCheckpoint(created.globalObjectId);
  const stateAfterCapture = await readState();
  assertSameState(stateBeforeCapture, stateAfterCapture, "checkpoint.capture");
  assertCheckpointIdentity(checkpoint, created.globalObjectId, initialHierarchy.scenePath);

  const duplicateCheckpoint = await captureCheckpoint(created.globalObjectId);
  const stateAfterDuplicateCapture = await readState();
  assertSameState(stateAfterCapture, stateAfterDuplicateCapture, "duplicate checkpoint.capture");
  if (duplicateCheckpoint.checkpointId !== checkpoint.checkpointId) {
    throw new Error(
      `Unchanged state produced a different checkpointId: first=${checkpoint.checkpointId} second=${duplicateCheckpoint.checkpointId}`,
    );
  }

  const stateBeforeGet = await readState();
  const checkpointReadback = await getCheckpoint(checkpoint.checkpointId);
  const stateAfterGet = await readState();
  assertSameState(stateBeforeGet, stateAfterGet, "checkpoint.get");
  if (
    checkpointReadback.checkpointId !== checkpoint.checkpointId ||
    checkpointReadback.globalObjectId !== checkpoint.globalObjectId ||
    checkpointReadback.scenePath !== checkpoint.scenePath ||
    checkpointReadback.name !== checkpoint.name ||
    checkpointReadback.activeSelf !== checkpoint.activeSelf
  ) {
    throw new Error(
      `checkpoint.get did not return the exact retained checkpoint identity: ${JSON.stringify(checkpointReadback)}`,
    );
  }

  const changedName = `${originalName}_Changed`;
  await updateGameObjectAgainstFreshSnapshot(
    created.globalObjectId,
    changedName,
    false,
    `verify-checkpoint-update-${randomUUID()}`,
  );

  const beforeChangedTransform = await readTransform(created.globalObjectId);
  const changedPosition = {
    x: beforeChangedTransform.localPosition.x + 4.5,
    y: beforeChangedTransform.localPosition.y - 2.25,
    z: beforeChangedTransform.localPosition.z + 7.75,
  };
  const changedEuler = {
    x: beforeChangedTransform.localEulerAngles.x + 25,
    y: beforeChangedTransform.localEulerAngles.y + 40,
    z: beforeChangedTransform.localEulerAngles.z + 15,
  };
  const changedScale = {
    x: beforeChangedTransform.localScale.x + 0.5,
    y: beforeChangedTransform.localScale.y + 0.75,
    z: beforeChangedTransform.localScale.z + 1.25,
  };
  await setTransformAgainstFreshReadback(
    created.globalObjectId,
    changedPosition,
    changedEuler,
    changedScale,
    `verify-checkpoint-transform-${randomUUID()}`,
  );

  const changedObjectReadback = await resolveObject(created.globalObjectId);
  const changedTransformReadback = await readTransform(created.globalObjectId);
  if (
    !changedObjectReadback.found ||
    changedObjectReadback.name !== changedName ||
    changedObjectReadback.activeSelf !== false
  ) {
    throw new Error(`GameObject mutation did not take effect before restore: ${JSON.stringify(changedObjectReadback)}`);
  }
  assertVectorApproximately(
    changedTransformReadback.localPosition,
    changedPosition,
    "changed localPosition",
  );
  assertVectorApproximately(changedTransformReadback.localScale, changedScale, "changed localScale");

  const preRestoreState = await readState();
  const restoreMutationId = `verify-checkpoint-restore-${randomUUID()}`;
  const restored = await restoreCheckpoint(
    checkpoint.checkpointId,
    restoreMutationId,
    preRestoreState,
  );
  if (!restored.changed || restored.replayed) {
    throw new Error(`First checkpoint restore did not report a changed non-replay result: ${JSON.stringify(restored)}`);
  }

  const restoredObject = await resolveObject(created.globalObjectId);
  const restoredTransform = await readTransform(created.globalObjectId);
  if (
    !restoredObject.found ||
    restoredObject.name !== checkpoint.name ||
    restoredObject.activeSelf !== checkpoint.activeSelf
  ) {
    throw new Error(`Native GameObject state did not match the checkpoint after restore: ${JSON.stringify(restoredObject)}`);
  }
  assertVectorApproximately(restoredTransform.localPosition, checkpoint.localPosition, "restored localPosition");
  assertVectorApproximately(restoredTransform.localScale, checkpoint.localScale, "restored localScale");
  assertQuaternionEquivalent(restoredTransform.localRotation, checkpoint.localRotation, "restored localRotation");

  const stateBeforeReplay = await readState();
  const replay = await restoreCheckpoint(
    checkpoint.checkpointId,
    restoreMutationId,
    preRestoreState,
  );
  const stateAfterReplay = await readState();
  if (!replay.replayed) {
    throw new Error(`Same-id checkpoint restore did not return replayed=true: ${JSON.stringify(replay)}`);
  }
  assertSameState(stateBeforeReplay, stateAfterReplay, "same-id checkpoint.restore replay");

  await deleteAgainstFreshSnapshot(
    created.globalObjectId,
    `verify-checkpoint-delete-${randomUUID()}`,
  );
  cleanupGlobalObjectId = undefined;
  cleanupName = undefined;

  const missingAfterDelete = await resolveObject(created.globalObjectId);
  if (missingAfterDelete.found) {
    throw new Error(`Verifier target still exists after delete: ${JSON.stringify(missingAfterDelete)}`);
  }

  const afterDeleteState = await readState();
  const deletedRestoreAttempt = await client.callTool({
    name: "unity_restore_checkpoint",
    arguments: {
      checkpointId: checkpoint.checkpointId,
      mutationId: `verify-checkpoint-deleted-restore-${randomUUID()}`,
      expectedStateEpoch: afterDeleteState.stateEpoch,
      expectedStateRevision: afterDeleteState.stateRevision,
    },
  });
  if (!deletedRestoreAttempt.isError) {
    throw new Error(
      `Deleted target was unexpectedly recreated/restored from checkpoint: ${JSON.stringify(deletedRestoreAttempt.structuredContent)}`,
    );
  }
  const deletedRestoreError = readToolText(deletedRestoreAttempt);
  if (
    !deletedRestoreError.includes("no longer exists") &&
    !deletedRestoreError.includes("unavailable")
  ) {
    throw new Error(`Deleted-target restore failed for an unexpected reason: ${deletedRestoreError}`);
  }

  const finalResolve = await resolveObject(created.globalObjectId);
  const finalHierarchy = await readHierarchy();
  const remaining = finalHierarchy.nodes.filter(
    (node) => node.globalObjectId === created.globalObjectId || node.name === originalName || node.name === changedName,
  );
  if (finalResolve.found || remaining.length !== 0) {
    throw new Error(
      `Checkpoint verifier left/recreated a temporary object: resolve=${JSON.stringify(finalResolve)} hierarchy=${JSON.stringify(remaining)}`,
    );
  }

  console.log("[Unity AI Bridge] Bounded checkpoint restore verification PASS:");
  console.log(JSON.stringify({
    unityVersion: (await readStatus()).unityVersion,
    activeScenePath: initialHierarchy.scenePath,
    createMutationId,
    checkpointId: checkpoint.checkpointId,
    checkpointMaximumRetained: checkpoint.maximumRetainedCheckpoints,
    captureReadOnlyStateTokenUnchanged: true,
    deterministicCheckpointId: true,
    checkpointGetReadOnly: true,
    checkpointGetExact: true,
    restoreMutationId,
    restoreChanged: true,
    restoredNameAndActive: true,
    restoredTransformExactly: true,
    restoreSameIdReplayReadOnly: true,
    deletedTargetRestoreRejected: true,
    checkpointDidNotRecreateDeletedTarget: true,
    temporaryObjectRemaining: false,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Bounded checkpoint restore verification FAILED:\n${message}`);
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
        capabilities.includes("checkpoint.capture") &&
        capabilities.includes("checkpoint.get") &&
        capabilities.includes("checkpoint.restore") &&
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
    `Timed out waiting for checkpoint capabilities. Last observation: ${last}. Reimport/restart Unity if it is still running an older Agent assembly.`,
  );
}

async function captureCheckpoint(globalObjectId: string): Promise<CheckpointSnapshotPayload> {
  const result = await client.callTool({
    name: "unity_capture_checkpoint",
    arguments: { globalObjectId },
  });
  if (result.isError) throw new Error(`unity_capture_checkpoint failed: ${readToolText(result)}`);
  if (!isCheckpointSnapshotPayload(result.structuredContent)) {
    throw new Error(`Invalid checkpoint.capture structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
}

async function getCheckpoint(checkpointId: string): Promise<CheckpointSnapshotPayload> {
  const result = await client.callTool({
    name: "unity_get_checkpoint",
    arguments: { checkpointId },
  });
  if (result.isError) throw new Error(`unity_get_checkpoint failed: ${readToolText(result)}`);
  if (!isCheckpointSnapshotPayload(result.structuredContent)) {
    throw new Error(`Invalid checkpoint.get structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
}

async function restoreCheckpoint(
  checkpointId: string,
  mutationId: string,
  state: StatePayload,
): Promise<CheckpointRestorePayload> {
  const result = await client.callTool({
    name: "unity_restore_checkpoint",
    arguments: {
      checkpointId,
      mutationId,
      expectedStateEpoch: state.stateEpoch,
      expectedStateRevision: state.stateRevision,
    },
  });
  if (result.isError) throw new Error(`unity_restore_checkpoint failed: ${readToolText(result)}`);
  if (!isCheckpointRestorePayload(result.structuredContent)) {
    throw new Error(`Invalid checkpoint.restore structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
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

async function updateGameObjectAgainstFreshSnapshot(
  globalObjectId: string,
  name: string,
  activeSelf: boolean,
  mutationId: string,
): Promise<void> {
  let last = "No attempt.";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const current = await resolveObject(globalObjectId);
    if (!current.found) throw new Error("Update target disappeared before GameObject update.");
    const result = await client.callTool({
      name: "unity_update_game_object",
      arguments: {
        globalObjectId,
        name,
        activeSelf,
        mutationId,
        expectedStateEpoch: current.stateEpoch,
        expectedStateRevision: current.stateRevision,
      },
    });
    if (!result.isError) return;
    last = readToolText(result);
    if (last.includes("state_revision_mismatch")) continue;
    throw new Error(`GameObject update failed unexpectedly: ${last}`);
  }
  throw new Error(`Could not obtain a stable GameObject update window: ${last}`);
}

async function setTransformAgainstFreshReadback(
  globalObjectId: string,
  localPosition: Vector3,
  localEulerAngles: Vector3,
  localScale: Vector3,
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
        localEulerAngles,
        localScale,
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
      `verify-checkpoint-best-effort-cleanup-${randomUUID()}`,
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

async function readStatus(): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: "unity_get_status", arguments: {} });
  if (result.isError || !isRecord(result.structuredContent)) {
    throw new Error(`Status read failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function readState(): Promise<StatePayload> {
  const status = await readStatus();
  if (!isState(status)) {
    throw new Error(`Status did not contain a valid state token: ${JSON.stringify(status)}`);
  }
  return { stateEpoch: status.stateEpoch, stateRevision: status.stateRevision };
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

function assertCheckpointIdentity(
  checkpoint: CheckpointSnapshotPayload,
  globalObjectId: string,
  scenePath: string,
): void {
  if (checkpoint.globalObjectId !== globalObjectId || checkpoint.scenePath !== scenePath) {
    throw new Error(
      `Checkpoint identity mismatch: expected target=${globalObjectId} scene=${scenePath}, actual=${JSON.stringify(checkpoint)}`,
    );
  }
  if (checkpoint.maximumRetainedCheckpoints !== 16) {
    throw new Error(`Unexpected checkpoint retention bound: ${checkpoint.maximumRetainedCheckpoints}`);
  }
}

function assertSameState(before: StatePayload, after: StatePayload, label: string): void {
  if (before.stateEpoch !== after.stateEpoch || before.stateRevision !== after.stateRevision) {
    throw new Error(`${label} changed Unity state token: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
}

function assertPersistentScene(scenePath: string): void {
  if (scenePath.length === 0) {
    throw new Error(
      "The active Unity scene is unsaved/temporary. Open or save a persistent scene asset before running verify:checkpoint-restore.",
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
    throw new Error(`${label} mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

function assertQuaternionEquivalent(
  actual: Quaternion,
  expected: Quaternion,
  label: string,
  toleranceDegrees = 0.01,
): void {
  const dot = Math.min(
    1,
    Math.abs(actual.x * expected.x + actual.y * expected.y + actual.z * expected.z + actual.w * expected.w),
  );
  const angleDegrees = (2 * Math.acos(dot) * 180) / Math.PI;
  if (angleDegrees > toleranceDegrees) {
    throw new Error(
      `${label} mismatch: angle=${angleDegrees} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
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

function isState(value: Record<string, unknown>): value is Record<string, unknown> & StatePayload {
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
  return isRecord(value) &&
    typeof value.found === "boolean" &&
    typeof value.name === "string" &&
    typeof value.activeSelf === "boolean" &&
    isState(value);
}

function isVector3(value: unknown): value is Vector3 {
  return isRecord(value) &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y) &&
    typeof value.z === "number" && Number.isFinite(value.z);
}

function isQuaternion(value: unknown): value is Quaternion {
  return isRecord(value) &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y) &&
    typeof value.z === "number" && Number.isFinite(value.z) &&
    typeof value.w === "number" && Number.isFinite(value.w);
}

function isTransformPayload(value: unknown): value is TransformPayload {
  return isRecord(value) &&
    isVector3(value.localPosition) &&
    isVector3(value.localEulerAngles) &&
    isQuaternion(value.localRotation) &&
    isVector3(value.localScale) &&
    isState(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StatePayload = { stateEpoch: string; stateRevision: number };
type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number; w: number };
type CreatePayload = {
  globalObjectId: string;
  name: string;
  stateEpoch: string;
  stateRevision: number;
};
type HierarchyPayload = StatePayload & {
  scenePath: string;
  nodes: Array<{ globalObjectId: string; name: string }>;
};
type ResolvePayload = StatePayload & {
  found: boolean;
  name: string;
  activeSelf: boolean;
};
type TransformPayload = StatePayload & {
  localPosition: Vector3;
  localEulerAngles: Vector3;
  localRotation: Quaternion;
  localScale: Vector3;
};
