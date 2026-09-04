import test from "node:test";
import assert from "node:assert/strict";

import {
  isCheckpointRestorePayload,
  isCheckpointSnapshotPayload,
} from "../src/bridge/checkpoint-bridge.js";

const checkpointId = `cp-${"a".repeat(64)}`;

function checkpointSnapshot() {
  return {
    checkpointId,
    globalObjectId: "GlobalObjectId_V1-2-example-1-0",
    scenePath: "Assets/SampleScene.unity",
    parentGlobalObjectId: "",
    name: "Checkpoint Target",
    activeSelf: true,
    localPosition: { x: 1, y: 2, z: 3 },
    localEulerAngles: { x: 10, y: 20, z: 30 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
    capturedStateEpoch: "epoch-a",
    capturedStateRevision: 42,
    capturedUnixMs: 1_788_000_000_000,
    retainedCheckpointCount: 1,
    maximumRetainedCheckpoints: 16,
  };
}

function restorePayload() {
  return {
    checkpointId,
    mutationId: "restore-1",
    replayed: false,
    changed: true,
    requestedGlobalObjectId: "GlobalObjectId_V1-2-example-1-0",
    expectedStateEpoch: "epoch-before",
    expectedStateRevision: 43,
    gameObject: {
      globalObjectId: "GlobalObjectId_V1-2-example-1-0",
      instanceId: 100,
      name: "Checkpoint Target",
      activeSelf: true,
      activeInHierarchy: true,
      childCount: 0,
      sceneName: "SampleScene",
      scenePath: "Assets/SampleScene.unity",
      hierarchyPath: "Checkpoint Target",
      siblingIndex: 0,
      sceneIsDirty: true,
      stateEpoch: "epoch-before",
      stateRevision: 44,
    },
    transform: {
      globalObjectId: "GlobalObjectId_V1-2-example-1-0",
      instanceId: 100,
      name: "Checkpoint Target",
      sceneName: "SampleScene",
      scenePath: "Assets/SampleScene.unity",
      hierarchyPath: "Checkpoint Target",
      sceneIsDirty: true,
      localPosition: { x: 1, y: 2, z: 3 },
      localEulerAngles: { x: 10, y: 20, z: 30 },
      localRotation: { x: 0, y: 0, z: 0, w: 1 },
      localScale: { x: 1, y: 1, z: 1 },
      worldPosition: { x: 1, y: 2, z: 3 },
      worldRotation: { x: 0, y: 0, z: 0, w: 1 },
      lossyScale: { x: 1, y: 1, z: 1 },
      stateEpoch: "epoch-before",
      stateRevision: 44,
    },
  };
}

test("checkpoint snapshot validator accepts the bounded first-slice contract", () => {
  assert.equal(isCheckpointSnapshotPayload(checkpointSnapshot()), true);
});

test("checkpoint snapshot validator rejects forged ids and retention overflow", () => {
  assert.equal(
    isCheckpointSnapshotPayload({ ...checkpointSnapshot(), checkpointId: "cp-not-a-hash" }),
    false,
  );
  assert.equal(
    isCheckpointSnapshotPayload({ ...checkpointSnapshot(), retainedCheckpointCount: 17 }),
    false,
  );
});

test("checkpoint snapshot validator rejects non-finite transform values", () => {
  assert.equal(
    isCheckpointSnapshotPayload({
      ...checkpointSnapshot(),
      localPosition: { x: Number.POSITIVE_INFINITY, y: 2, z: 3 },
    }),
    false,
  );
});

test("checkpoint restore validator requires one consistent native target and state token", () => {
  assert.equal(isCheckpointRestorePayload(restorePayload()), true);

  const wrongTarget = restorePayload();
  wrongTarget.transform.globalObjectId = "GlobalObjectId_V1-2-other-1-0";
  assert.equal(isCheckpointRestorePayload(wrongTarget), false);

  const wrongState = restorePayload();
  wrongState.transform.stateRevision = 45;
  assert.equal(isCheckpointRestorePayload(wrongState), false);
});

test("checkpoint restore validator rejects malformed mutation and checkpoint ids", () => {
  assert.equal(
    isCheckpointRestorePayload({ ...restorePayload(), mutationId: "bad mutation/id" }),
    false,
  );
  assert.equal(
    isCheckpointRestorePayload({ ...restorePayload(), checkpointId: `cp-${"A".repeat(64)}` }),
    false,
  );
});
