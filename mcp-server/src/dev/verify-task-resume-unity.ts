import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  isTaskJournalPayload,
  type TaskJournalPayload,
  type TaskStepPlan,
} from "../bridge/task-journal-bridge.js";

const timeoutMs = 90_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-task-resume-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

const cleanupIds = new Set<string>();

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
    "unity_update_game_object",
    "unity_set_transform",
    "unity_delete_game_object",
    "unity_begin_task",
    "unity_get_task_status",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  await waitForCapabilities();
  const initial = await readHierarchy();
  assertPersistentScene(initial.scenePath);

  const happyOriginalName = `MCP_Task_${Date.now()}`;
  const happyCreated = await createAgainstFreshSnapshot(
    happyOriginalName,
    `verify-task-create-${randomUUID()}`,
  );
  cleanupIds.add(happyCreated.globalObjectId);

  const happyInitialTransform = await readTransform(happyCreated.globalObjectId);
  const happyUpdatedName = `${happyOriginalName}_Updated`;
  const happyPosition = {
    x: happyInitialTransform.localPosition.x + 2.5,
    y: happyInitialTransform.localPosition.y - 1.25,
    z: happyInitialTransform.localPosition.z + 4.75,
  };
  const happyEuler = {
    x: happyInitialTransform.localEulerAngles.x + 15,
    y: happyInitialTransform.localEulerAngles.y + 35,
    z: happyInitialTransform.localEulerAngles.z + 10,
  };
  const happyScale = {
    x: happyInitialTransform.localScale.x + 0.25,
    y: happyInitialTransform.localScale.y + 0.5,
    z: happyInitialTransform.localScale.z + 0.75,
  };

  const happyTaskId = `verify-task-${randomUUID()}`;
  const updateMutationId = `verify-task-update-${randomUUID()}`;
  const transformMutationId = `verify-task-transform-${randomUUID()}`;
  const happySteps: TaskStepPlan[] = [
    {
      index: 0,
      operation: "gameObject.update",
      mutationId: updateMutationId,
      globalObjectId: happyCreated.globalObjectId,
      name: happyUpdatedName,
      activeSelf: false,
    },
    {
      index: 1,
      operation: "transform.set",
      mutationId: transformMutationId,
      globalObjectId: happyCreated.globalObjectId,
      localPosition: happyPosition,
      localEulerAngles: happyEuler,
      localScale: happyScale,
    },
  ];

  const begun = await beginTask(happyTaskId, happySteps);
  assertReadyForStep(begun, 0, "gameObject.update", updateMutationId);
  if (
    begun.createdStateEpoch !== begun.currentStateEpoch ||
    begun.createdStateRevision !== begun.currentStateRevision
  ) {
    throw new Error(`task.begin unexpectedly changed Unity state: ${JSON.stringify(begun)}`);
  }

  const outOfOrder = await client.callTool({
    name: "unity_set_transform",
    arguments: {
      globalObjectId: happyCreated.globalObjectId,
      localPosition: happyPosition,
      localEulerAngles: happyEuler,
      localScale: happyScale,
      mutationId: transformMutationId,
      expectedStateEpoch: begun.expectedBoundaryStateEpoch,
      expectedStateRevision: begun.expectedBoundaryStateRevision,
    },
  });
  if (!outOfOrder.isError || !readToolText(outOfOrder).includes("prior step 0")) {
    throw new Error(`Out-of-order reserved task step was not rejected as expected: ${readToolText(outOfOrder)}`);
  }

  const wrongArgs = await client.callTool({
    name: "unity_update_game_object",
    arguments: {
      globalObjectId: happyCreated.globalObjectId,
      name: `${happyUpdatedName}_Wrong`,
      activeSelf: false,
      mutationId: updateMutationId,
      expectedStateEpoch: begun.expectedBoundaryStateEpoch,
      expectedStateRevision: begun.expectedBoundaryStateRevision,
    },
  });
  if (!wrongArgs.isError || !readToolText(wrongArgs).includes("differ from the immutable task plan")) {
    throw new Error(`Wrong reserved task arguments were not rejected as expected: ${readToolText(wrongArgs)}`);
  }

  const afterRejectedAttempts = await resolveObject(happyCreated.globalObjectId);
  if (!afterRejectedAttempts.found || afterRejectedAttempts.name !== happyOriginalName || !afterRejectedAttempts.activeSelf) {
    throw new Error(
      `Rejected task attempts changed native Unity state: ${JSON.stringify(afterRejectedAttempts)}`,
    );
  }

  await updateWithExactTaskBoundary(
    happyCreated.globalObjectId,
    happyUpdatedName,
    false,
    updateMutationId,
    begun,
  );

  const afterUpdate = await getTask(happyTaskId);
  assertReadyForStep(afterUpdate, 1, "transform.set", transformMutationId);
  if (
    afterUpdate.steps[0]?.stepStatus !== "completed" ||
    afterUpdate.steps[0]?.lifecycleStatus !== "completed"
  ) {
    throw new Error(`First task step did not reach verified completion: ${JSON.stringify(afterUpdate)}`);
  }

  const objectAfterUpdate = await resolveObject(happyCreated.globalObjectId);
  if (!objectAfterUpdate.found || objectAfterUpdate.name !== happyUpdatedName || objectAfterUpdate.activeSelf) {
    throw new Error(`First task step native readback mismatch: ${JSON.stringify(objectAfterUpdate)}`);
  }

  await setTransformWithExactTaskBoundary(
    happyCreated.globalObjectId,
    happyPosition,
    happyEuler,
    happyScale,
    transformMutationId,
    afterUpdate,
  );

  const completed = await getTask(happyTaskId);
  if (
    completed.status !== "completed" ||
    completed.safeToExecuteNextStep ||
    completed.nextStepIndex !== -1 ||
    completed.steps.some((step) => step.stepStatus !== "completed")
  ) {
    throw new Error(`Task did not reach completed state: ${JSON.stringify(completed)}`);
  }

  const completedTransform = await readTransform(happyCreated.globalObjectId);
  assertVectorApproximately(completedTransform.localPosition, happyPosition, "completed localPosition");
  assertVectorApproximately(completedTransform.localScale, happyScale, "completed localScale");

  const driftOriginalName = `MCP_Task_Drift_${Date.now()}`;
  const driftTarget = await createAgainstFreshSnapshot(
    driftOriginalName,
    `verify-task-drift-target-${randomUUID()}`,
  );
  cleanupIds.add(driftTarget.globalObjectId);

  const driftTaskId = `verify-task-drift-${randomUUID()}`;
  const driftMutationId = `verify-task-drift-update-${randomUUID()}`;
  const driftTask = await beginTask(driftTaskId, [
    {
      index: 0,
      operation: "gameObject.update",
      mutationId: driftMutationId,
      globalObjectId: driftTarget.globalObjectId,
      name: `${driftOriginalName}_ShouldNotApply`,
      activeSelf: false,
    },
  ]);
  assertReadyForStep(driftTask, 0, "gameObject.update", driftMutationId);

  const unrelated = await createAgainstFreshSnapshot(
    `MCP_Task_Unrelated_${Date.now()}`,
    `verify-task-unrelated-${randomUUID()}`,
  );
  cleanupIds.add(unrelated.globalObjectId);

  const blocked = await getTask(driftTaskId);
  if (
    blocked.status !== "blocked" ||
    blocked.resumeState !== "blocked_state_drift" ||
    blocked.safeToExecuteNextStep ||
    blocked.currentStateMatchesExpectedBoundary
  ) {
    throw new Error(`External Unity state drift did not block task resume: ${JSON.stringify(blocked)}`);
  }

  const blockedExecution = await client.callTool({
    name: "unity_update_game_object",
    arguments: {
      globalObjectId: driftTarget.globalObjectId,
      name: `${driftOriginalName}_ShouldNotApply`,
      activeSelf: false,
      mutationId: driftMutationId,
      expectedStateEpoch: driftTask.expectedBoundaryStateEpoch,
      expectedStateRevision: driftTask.expectedBoundaryStateRevision,
    },
  });
  if (!blockedExecution.isError || !readToolText(blockedExecution).includes("state")) {
    throw new Error(`State-drifted task step was not rejected: ${readToolText(blockedExecution)}`);
  }

  const driftReadback = await resolveObject(driftTarget.globalObjectId);
  if (!driftReadback.found || driftReadback.name !== driftOriginalName || !driftReadback.activeSelf) {
    throw new Error(`Blocked drift task changed native target state: ${JSON.stringify(driftReadback)}`);
  }

  console.log("[Unity AI Bridge] Bounded task journal/resume verification PASS:");
  console.log(JSON.stringify({
    unityVersion: (await readStatus()).unityVersion,
    activeScenePath: initial.scenePath,
    happyTaskId,
    taskBeginReadOnly: true,
    outOfOrderStepRejectedBeforeMutation: true,
    wrongArgumentsRejectedBeforeMutation: true,
    firstStepCompletedAndNextBoundaryExposed: true,
    secondStepCompleted: true,
    taskReachedCompletedState: true,
    driftTaskId,
    externalStateDriftBlockedResume: true,
    blockedTaskTargetUnchanged: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Bounded task journal/resume verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  for (const globalObjectId of Array.from(cleanupIds)) {
    await bestEffortDelete(globalObjectId);
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
        capabilities.includes("task.begin") &&
        capabilities.includes("task.get") &&
        capabilities.includes("gameObject.update") &&
        capabilities.includes("transform.set") &&
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
    `Timed out waiting for task journal capabilities. Last observation: ${last}. Reimport/restart Unity if it is still running an older Agent assembly.`,
  );
}

async function beginTask(taskId: string, steps: TaskStepPlan[]): Promise<TaskJournalPayload> {
  const result = await client.callTool({
    name: "unity_begin_task",
    arguments: { taskId, steps },
  });
  if (result.isError) throw new Error(`unity_begin_task failed: ${readToolText(result)}`);
  if (!isTaskJournalPayload(result.structuredContent)) {
    throw new Error(`Invalid task.begin structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
}

async function getTask(taskId: string): Promise<TaskJournalPayload> {
  const result = await client.callTool({
    name: "unity_get_task_status",
    arguments: { taskId },
  });
  if (result.isError) throw new Error(`unity_get_task_status failed: ${readToolText(result)}`);
  if (!isTaskJournalPayload(result.structuredContent)) {
    throw new Error(`Invalid task.get structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
}

function assertReadyForStep(
  task: TaskJournalPayload,
  index: number,
  operation: string,
  mutationId: string,
): void {
  if (
    task.status !== "ready" ||
    !task.safeToExecuteNextStep ||
    !task.currentStateMatchesExpectedBoundary ||
    task.nextStepIndex !== index ||
    task.nextOperation !== operation ||
    task.nextMutationId !== mutationId
  ) {
    throw new Error(`Task is not safely ready for expected step ${index}: ${JSON.stringify(task)}`);
  }
}

async function updateWithExactTaskBoundary(
  globalObjectId: string,
  name: string,
  activeSelf: boolean,
  mutationId: string,
  task: TaskJournalPayload,
): Promise<void> {
  const result = await client.callTool({
    name: "unity_update_game_object",
    arguments: {
      globalObjectId,
      name,
      activeSelf,
      mutationId,
      expectedStateEpoch: task.expectedBoundaryStateEpoch,
      expectedStateRevision: task.expectedBoundaryStateRevision,
    },
  });
  if (result.isError) throw new Error(`Reserved gameObject.update failed: ${readToolText(result)}`);
}

async function setTransformWithExactTaskBoundary(
  globalObjectId: string,
  localPosition: Vector3,
  localEulerAngles: Vector3,
  localScale: Vector3,
  mutationId: string,
  task: TaskJournalPayload,
): Promise<void> {
  const result = await client.callTool({
    name: "unity_set_transform",
    arguments: {
      globalObjectId,
      localPosition,
      localEulerAngles,
      localScale,
      mutationId,
      expectedStateEpoch: task.expectedBoundaryStateEpoch,
      expectedStateRevision: task.expectedBoundaryStateRevision,
    },
  });
  if (result.isError) throw new Error(`Reserved transform.set failed: ${readToolText(result)}`);
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

async function bestEffortDelete(globalObjectId: string): Promise<void> {
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const current = await resolveObject(globalObjectId);
      if (!current.found) return;
      const result = await client.callTool({
        name: "unity_delete_game_object",
        arguments: {
          globalObjectId,
          mutationId: `verify-task-cleanup-${randomUUID()}`,
          expectedStateEpoch: current.stateEpoch,
          expectedStateRevision: current.stateRevision,
        },
      });
      if (!result.isError) return;
      if (!readToolText(result).includes("state_revision_mismatch")) return;
    }
  } catch {
    // Cleanup is best-effort; the primary verifier result remains authoritative.
  }
}

async function readStatus(): Promise<StatusPayload> {
  const result = await client.callTool({ name: "unity_get_status", arguments: {} });
  if (result.isError || !isStatusPayload(result.structuredContent)) {
    throw new Error(`Invalid Unity status: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function readHierarchy(): Promise<HierarchyPayload> {
  const result = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: { maxDepth: 1, maxNodes: 32 },
  });
  if (result.isError || !isHierarchyPayload(result.structuredContent)) {
    throw new Error(`Invalid Unity hierarchy: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function resolveObject(globalObjectId: string): Promise<ObjectPayload> {
  const result = await client.callTool({
    name: "unity_resolve_object",
    arguments: { globalObjectId },
  });
  if (result.isError || !isObjectPayload(result.structuredContent)) {
    throw new Error(`Invalid object.resolve response: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function readTransform(globalObjectId: string): Promise<TransformPayload> {
  const result = await client.callTool({
    name: "unity_get_transform",
    arguments: { globalObjectId },
  });
  if (result.isError || !isTransformPayload(result.structuredContent)) {
    throw new Error(`Invalid transform.get response: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

function assertPersistentScene(scenePath: string): void {
  if (!scenePath || !scenePath.endsWith(".unity")) {
    throw new Error(`Verifier requires a saved active Scene. Received '${scenePath}'.`);
  }
}

function assertVectorApproximately(actual: Vector3, expected: Vector3, label: string): void {
  const tolerance = 0.0001;
  if (
    Math.abs(actual.x - expected.x) > tolerance ||
    Math.abs(actual.y - expected.y) > tolerance ||
    Math.abs(actual.z - expected.z) > tolerance
  ) {
    throw new Error(`${label} mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

function readToolText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .filter((entry): entry is { type: string; text: string } =>
      isRecord(entry) && entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVector(value: unknown): value is Vector3 {
  return (
    isRecord(value) &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y) &&
    typeof value.z === "number" && Number.isFinite(value.z)
  );
}

function isStatusPayload(value: unknown): value is StatusPayload {
  return (
    isRecord(value) &&
    typeof value.unityVersion === "string" &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    Number.isInteger(value.stateRevision) && value.stateRevision > 0
  );
}

function isHierarchyPayload(value: unknown): value is HierarchyPayload {
  return (
    isRecord(value) &&
    typeof value.scenePath === "string" &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    Number.isInteger(value.stateRevision) && value.stateRevision > 0
  );
}

function isCreatePayload(value: unknown): value is CreatePayload {
  return (
    isRecord(value) &&
    typeof value.globalObjectId === "string" && value.globalObjectId.length > 0 &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    Number.isInteger(value.stateRevision) && value.stateRevision > 0
  );
}

function isObjectPayload(value: unknown): value is ObjectPayload {
  return (
    isRecord(value) &&
    typeof value.found === "boolean" &&
    typeof value.name === "string" &&
    typeof value.activeSelf === "boolean" &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    Number.isInteger(value.stateRevision) && value.stateRevision > 0
  );
}

function isTransformPayload(value: unknown): value is TransformPayload {
  return (
    isRecord(value) &&
    isVector(value.localPosition) &&
    isVector(value.localEulerAngles) &&
    isVector(value.localScale) &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    Number.isInteger(value.stateRevision) && value.stateRevision > 0
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Vector3 = { x: number; y: number; z: number };
type StatusPayload = { unityVersion: string; stateEpoch: string; stateRevision: number };
type HierarchyPayload = { scenePath: string; stateEpoch: string; stateRevision: number };
type CreatePayload = { globalObjectId: string; stateEpoch: string; stateRevision: number };
type ObjectPayload = {
  found: boolean;
  name: string;
  activeSelf: boolean;
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
