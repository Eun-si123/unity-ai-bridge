import test from "node:test";
import assert from "node:assert/strict";

import {
  isTaskJournalPayload,
  validateTaskSteps,
  type TaskStepPlan,
} from "../src/bridge/task-journal-bridge.js";

const target = "GlobalObjectId_V1-2-example-1-0";

function plans(): TaskStepPlan[] {
  return [
    {
      index: 0,
      operation: "gameObject.update",
      mutationId: "task-step-update-1",
      globalObjectId: target,
      name: "Task Updated",
      activeSelf: true,
    },
    {
      index: 1,
      operation: "transform.set",
      mutationId: "task-step-transform-1",
      globalObjectId: target,
      localPosition: { x: 2, y: 3, z: 4 },
      localEulerAngles: { x: 10, y: 20, z: 30 },
      localScale: { x: 1.5, y: 1.25, z: 0.75 },
    },
  ];
}

function readyPayload() {
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
        localPosition: null,
        localEulerAngles: null,
        localScale: null,
        stepStatus: "pending",
        lifecycleStatus: "not_found",
        startedUnixMs: 0,
        finishedUnixMs: 0,
        finishedStateEpoch: "",
        finishedStateRevision: 0,
        failureKind: "",
      },
      {
        index: 1,
        operation: "transform.set",
        mutationId: "task-step-transform-1",
        globalObjectId: target,
        name: "",
        activeSelf: false,
        localPosition: { x: 2, y: 3, z: 4 },
        localEulerAngles: { x: 10, y: 20, z: 30 },
        localScale: { x: 1.5, y: 1.25, z: 0.75 },
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

test("task plan validator accepts the bounded update/transform slice", () => {
  assert.doesNotThrow(() => validateTaskSteps(plans()));
});

test("task plan validator rejects duplicate mutation ids and index drift", () => {
  const duplicate = plans();
  duplicate[1] = { ...duplicate[1], mutationId: duplicate[0]!.mutationId } as TaskStepPlan;
  assert.throws(() => validateTaskSteps(duplicate), /unique mutationId/);

  const wrongIndex = plans();
  wrongIndex[1] = { ...wrongIndex[1], index: 7 } as TaskStepPlan;
  assert.throws(() => validateTaskSteps(wrongIndex), /index must equal 1/);
});

test("task plan validator rejects non-finite transform values", () => {
  const invalid = plans();
  invalid[1] = {
    ...invalid[1],
    localPosition: { x: Number.POSITIVE_INFINITY, y: 3, z: 4 },
  } as TaskStepPlan;
  assert.throws(() => validateTaskSteps(invalid), /finite/);
});

test("task status validator accepts ready resume guidance", () => {
  assert.equal(isTaskJournalPayload(readyPayload()), true);
});

test("task status validator rejects unsafe ready claims", () => {
  assert.equal(
    isTaskJournalPayload({
      ...readyPayload(),
      currentStateMatchesExpectedBoundary: false,
    }),
    false,
  );
  assert.equal(
    isTaskJournalPayload({
      ...readyPayload(),
      nextMutationId: "different-mutation",
    }),
    false,
  );
});

test("task status validator accepts conservative not_found and rejects malformed bounds", () => {
  const missing = {
    ...readyPayload(),
    found: false,
    createdUnixMs: 0,
    createdStateEpoch: "",
    createdStateRevision: 0,
    expectedBoundaryStateEpoch: "",
    expectedBoundaryStateRevision: 0,
    currentStateMatchesExpectedBoundary: false,
    status: "not_found",
    resumeState: "task_not_retained",
    safeToExecuteNextStep: false,
    nextStepIndex: -1,
    nextOperation: "",
    nextMutationId: "",
    steps: [],
  };
  assert.equal(isTaskJournalPayload(missing), true);
  assert.equal(isTaskJournalPayload({ ...missing, retainedTaskCount: 17 }), false);
});
