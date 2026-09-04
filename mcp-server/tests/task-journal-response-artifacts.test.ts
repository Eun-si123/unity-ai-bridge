import test from "node:test";
import assert from "node:assert/strict";

import type { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { requestTaskBegin, type TaskStepPlan } from "../src/bridge/task-journal-bridge.js";

const target = "GlobalObjectId_V1-2-example-1-0";

function plan(): TaskStepPlan[] {
  return [
    {
      index: 0,
      operation: "gameObject.update",
      mutationId: "task-step-update-1",
      globalObjectId: target,
      name: "Task Updated",
      activeSelf: true,
    },
  ];
}

function payload(localPosition: unknown) {
  return {
    taskId: "task-1",
    found: true,
    replayed: false,
    journalKind: "bounded_task_journal_v1",
    sessionScope: "current_editor_session",
    supportedOperations: ["gameObject.update", "transform.set"],
    createdUnixMs: 1_788_000_000_000,
    createdStateEpoch: "epoch-a",
    createdStateRevision: 40,
    currentStateEpoch: "epoch-a",
    currentStateRevision: 40,
    expectedBoundaryStateEpoch: "epoch-a",
    expectedBoundaryStateRevision: 40,
    currentStateMatchesExpectedBoundary: true,
    status: "ready",
    resumeState: "execute_next_reserved_step",
    safeToExecuteNextStep: true,
    nextStepIndex: 0,
    nextOperation: "gameObject.update",
    nextMutationId: "task-step-update-1",
    steps: [
      {
        index: 0,
        operation: "gameObject.update",
        mutationId: "task-step-update-1",
        globalObjectId: target,
        name: "Task Updated",
        activeSelf: true,
        localPosition,
        localEulerAngles: {},
        localScale: { x: 0, y: 0, z: 0 },
        stepStatus: "pending",
        lifecycleStatus: "not_found",
        startedUnixMs: 0,
        finishedUnixMs: 0,
        finishedStateEpoch: "",
        finishedStateRevision: 0,
        failureKind: "",
      },
    ],
    retainedTaskCount: 1,
    maximumRetainedTasks: 16,
    maximumStepsPerTask: 8,
  };
}

function bridgeFor(result: unknown): PrefabPropertyBridgeServer {
  return {
    connectedEditor: {
      editorId: "editor-a",
      connectionGeneration: 7,
    },
    requestOperation: async () => result,
  } as unknown as PrefabPropertyBridgeServer;
}

test("task.begin normalizes Unity JsonUtility null-vector artifacts on update status", async () => {
  const result = await requestTaskBegin(bridgeFor(payload(undefined)), "task-1", plan());

  assert.equal(result.steps[0]?.localPosition, null);
  assert.equal(result.steps[0]?.localEulerAngles, null);
  assert.equal(result.steps[0]?.localScale, null);
});

test("task.begin still rejects non-zero irrelevant Transform response fields", async () => {
  await assert.rejects(
    () => requestTaskBegin(bridgeFor(payload({ x: 1, y: 0, z: 0 })), "task-1", plan()),
    /invalid task\.begin payload/,
  );
});
