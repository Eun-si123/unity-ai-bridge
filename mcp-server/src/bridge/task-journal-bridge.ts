import { PrefabPropertyBridgeServer } from "./prefab-property-bridge-server.js";
import type { BridgeRoute, RiskClass } from "../protocol/bridge.js";

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_ID_LENGTH = 128;
export const MAXIMUM_RETAINED_TASKS = 16;
export const MAXIMUM_TASK_STEPS = 8;
export const TASK_OPERATIONS = ["gameObject.update", "transform.set"] as const;

export type TaskOperation = (typeof TASK_OPERATIONS)[number];
export type Vector3Payload = { x: number; y: number; z: number };

export type GameObjectUpdateTaskStep = {
  index: number;
  operation: "gameObject.update";
  mutationId: string;
  globalObjectId: string;
  name: string;
  activeSelf: boolean;
};

export type TransformSetTaskStep = {
  index: number;
  operation: "transform.set";
  mutationId: string;
  globalObjectId: string;
  localPosition: Vector3Payload;
  localEulerAngles: Vector3Payload;
  localScale: Vector3Payload;
};

export type TaskStepPlan = GameObjectUpdateTaskStep | TransformSetTaskStep;

export type TaskStepStatusPayload = {
  index: number;
  operation: TaskOperation;
  mutationId: string;
  globalObjectId: string;
  name: string;
  activeSelf: boolean;
  localPosition: Vector3Payload | null;
  localEulerAngles: Vector3Payload | null;
  localScale: Vector3Payload | null;
  stepStatus: "pending" | "started" | "completed" | "failed" | "conflict";
  lifecycleStatus: string;
  startedUnixMs: number;
  finishedUnixMs: number;
  finishedStateEpoch: string;
  finishedStateRevision: number;
  failureKind: string;
};

export type TaskJournalPayload = {
  taskId: string;
  found: boolean;
  replayed: boolean;
  journalKind: "bounded_task_journal_v1";
  sessionScope: "current_editor_session";
  supportedOperations: TaskOperation[];
  createdUnixMs: number;
  createdStateEpoch: string;
  createdStateRevision: number;
  currentStateEpoch: string;
  currentStateRevision: number;
  expectedBoundaryStateEpoch: string;
  expectedBoundaryStateRevision: number;
  currentStateMatchesExpectedBoundary: boolean;
  status: "not_found" | "ready" | "waiting_reconciliation" | "completed" | "blocked";
  resumeState: string;
  safeToExecuteNextStep: boolean;
  nextStepIndex: number;
  nextOperation: "" | TaskOperation;
  nextMutationId: string;
  steps: TaskStepStatusPayload[];
  retainedTaskCount: number;
  maximumRetainedTasks: 16;
  maximumStepsPerTask: 8;
};

interface EditorIdentity {
  editorId: string;
  connectionGeneration: number;
}

class TaskJournalBridgeAccess extends PrefabPropertyBridgeServer {
  public connectedEditorAccess(): EditorIdentity | undefined {
    const current = this.connectedEditor;
    return current === undefined
      ? undefined
      : {
          editorId: current.editorId,
          connectionGeneration: current.connectionGeneration,
        };
  }

  public requestOperationAccess(
    operation: string,
    args: Record<string, unknown>,
    route: BridgeRoute,
    timeoutMs: number,
    risk: RiskClass,
  ): Promise<unknown> {
    return this.requestOperation(operation, args, route, timeoutMs, risk);
  }
}

export async function requestTaskBegin(
  bridge: PrefabPropertyBridgeServer,
  taskId: string,
  steps: TaskStepPlan[],
  timeoutMs = 5_000,
): Promise<TaskJournalPayload> {
  validateId(taskId, "taskId");
  validateTaskSteps(steps);
  const wireSteps = canonicalizeTaskSteps(steps);
  const editor = requireConnectedEditor(bridge);
  const raw = await requestOperation(
    bridge,
    "task.begin",
    { taskId, steps: wireSteps },
    editor,
    timeoutMs,
    "read",
  );
  if (!isTaskJournalPayload(raw) || !raw.found || raw.taskId !== taskId) {
    throw new Error("Unity returned an invalid task.begin payload.");
  }
  return raw;
}

export async function requestTaskGet(
  bridge: PrefabPropertyBridgeServer,
  taskId: string,
  timeoutMs = 5_000,
): Promise<TaskJournalPayload> {
  validateId(taskId, "taskId");
  const editor = requireConnectedEditor(bridge);
  const raw = await requestOperation(
    bridge,
    "task.get",
    { taskId },
    editor,
    timeoutMs,
    "read",
  );
  if (!isTaskJournalPayload(raw) || raw.taskId !== taskId) {
    throw new Error("Unity returned an invalid task.get payload.");
  }
  return raw;
}

export function validateTaskSteps(steps: TaskStepPlan[]): void {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAXIMUM_TASK_STEPS) {
    throw new Error(`steps must contain between 1 and ${MAXIMUM_TASK_STEPS} entries.`);
  }

  const mutationIds = new Set<string>();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step === undefined) {
      throw new Error(`steps[${index}] is required.`);
    }
    if (step.index !== index) {
      throw new Error(`steps[${index}].index must equal ${index}.`);
    }
    validateId(step.mutationId, `steps[${index}].mutationId`);
    validateGlobalObjectId(step.globalObjectId, `steps[${index}].globalObjectId`);
    if (mutationIds.has(step.mutationId)) {
      throw new Error("Each task step must use a unique mutationId.");
    }
    mutationIds.add(step.mutationId);

    if (step.operation === "gameObject.update") {
      if (typeof step.name !== "string" || step.name.trim().length === 0 || step.name.length > 128) {
        throw new Error(`steps[${index}].name must contain 1..128 characters with non-whitespace content.`);
      }
      if (typeof step.activeSelf !== "boolean") {
        throw new Error(`steps[${index}].activeSelf must be boolean.`);
      }
      continue;
    }

    if (step.operation === "transform.set") {
      validateVector(step.localPosition, `steps[${index}].localPosition`);
      validateVector(step.localEulerAngles, `steps[${index}].localEulerAngles`);
      validateVector(step.localScale, `steps[${index}].localScale`);
      continue;
    }

    throw new Error(`steps[${index}].operation is not supported by the bounded task journal.`);
  }
}

function canonicalizeTaskSteps(steps: TaskStepPlan[]): TaskStepPlan[] {
  return steps.map((step) => {
    if (step.operation === "gameObject.update") {
      return {
        index: step.index,
        operation: step.operation,
        mutationId: step.mutationId,
        globalObjectId: step.globalObjectId,
        name: step.name,
        activeSelf: step.activeSelf,
      };
    }

    return {
      index: step.index,
      operation: step.operation,
      mutationId: step.mutationId,
      globalObjectId: step.globalObjectId,
      localPosition: { ...step.localPosition },
      localEulerAngles: { ...step.localEulerAngles },
      localScale: { ...step.localScale },
    };
  });
}

export function isTaskJournalPayload(value: unknown): value is TaskJournalPayload {
  if (!isRecord(value)) return false;
  if (
    typeof value.taskId !== "string" ||
    !ID_PATTERN.test(value.taskId) ||
    typeof value.found !== "boolean" ||
    typeof value.replayed !== "boolean" ||
    value.journalKind !== "bounded_task_journal_v1" ||
    value.sessionScope !== "current_editor_session" ||
    !Array.isArray(value.supportedOperations) ||
    value.supportedOperations.length !== TASK_OPERATIONS.length ||
    !TASK_OPERATIONS.every((operation) => value.supportedOperations.includes(operation)) ||
    typeof value.currentStateEpoch !== "string" ||
    value.currentStateEpoch.length === 0 ||
    !isPositiveInteger(value.currentStateRevision) ||
    typeof value.currentStateMatchesExpectedBoundary !== "boolean" ||
    typeof value.safeToExecuteNextStep !== "boolean" ||
    !Number.isInteger(value.nextStepIndex) ||
    typeof value.nextOperation !== "string" ||
    typeof value.nextMutationId !== "string" ||
    !Array.isArray(value.steps) ||
    !Number.isInteger(value.retainedTaskCount) ||
    value.retainedTaskCount < 0 ||
    value.retainedTaskCount > MAXIMUM_RETAINED_TASKS ||
    value.maximumRetainedTasks !== MAXIMUM_RETAINED_TASKS ||
    value.maximumStepsPerTask !== MAXIMUM_TASK_STEPS
  ) {
    return false;
  }

  if (!isTaskStatus(value.status) || typeof value.resumeState !== "string") return false;

  if (!value.found) {
    return (
      value.status === "not_found" &&
      value.steps.length === 0 &&
      value.nextStepIndex === -1 &&
      value.nextOperation === "" &&
      value.nextMutationId === "" &&
      value.safeToExecuteNextStep === false
    );
  }

  if (
    !isPositiveInteger(value.createdUnixMs) ||
    typeof value.createdStateEpoch !== "string" ||
    value.createdStateEpoch.length === 0 ||
    !isPositiveInteger(value.createdStateRevision) ||
    typeof value.expectedBoundaryStateEpoch !== "string" ||
    value.expectedBoundaryStateEpoch.length === 0 ||
    !isPositiveInteger(value.expectedBoundaryStateRevision) ||
    value.steps.length < 1 ||
    value.steps.length > MAXIMUM_TASK_STEPS ||
    !value.steps.every((step, index) => isTaskStepStatus(step, index))
  ) {
    return false;
  }

  if (value.safeToExecuteNextStep) {
    return (
      value.status === "ready" &&
      value.currentStateMatchesExpectedBoundary &&
      value.nextStepIndex >= 0 &&
      value.nextStepIndex < value.steps.length &&
      isTaskOperation(value.nextOperation) &&
      value.nextMutationId === value.steps[value.nextStepIndex]?.mutationId
    );
  }

  return true;
}

function isTaskStepStatus(value: unknown, index: number): value is TaskStepStatusPayload {
  if (!isRecord(value)) return false;
  if (
    value.index !== index ||
    !isTaskOperation(value.operation) ||
    typeof value.mutationId !== "string" ||
    !ID_PATTERN.test(value.mutationId) ||
    typeof value.globalObjectId !== "string" ||
    value.globalObjectId.length === 0 ||
    typeof value.name !== "string" ||
    typeof value.activeSelf !== "boolean" ||
    !isStepStatus(value.stepStatus) ||
    typeof value.lifecycleStatus !== "string" ||
    !isNonNegativeInteger(value.startedUnixMs) ||
    !isNonNegativeInteger(value.finishedUnixMs) ||
    typeof value.finishedStateEpoch !== "string" ||
    !isNonNegativeInteger(value.finishedStateRevision) ||
    typeof value.failureKind !== "string"
  ) {
    return false;
  }

  if (value.operation === "gameObject.update") {
    return (
      value.name.trim().length > 0 &&
      value.name.length <= 128 &&
      value.localPosition === null &&
      value.localEulerAngles === null &&
      value.localScale === null
    );
  }

  return (
    value.name === "" &&
    isVector(value.localPosition) &&
    isVector(value.localEulerAngles) &&
    isVector(value.localScale)
  );
}

function access(bridge: PrefabPropertyBridgeServer): TaskJournalBridgeAccess {
  return bridge as unknown as TaskJournalBridgeAccess;
}

function requireConnectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity {
  const current = TaskJournalBridgeAccess.prototype.connectedEditorAccess.call(access(bridge));
  if (current === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }
  return current;
}

function requestOperation(
  bridge: PrefabPropertyBridgeServer,
  operation: string,
  args: Record<string, unknown>,
  route: EditorIdentity,
  timeoutMs: number,
  risk: RiskClass,
): Promise<unknown> {
  return TaskJournalBridgeAccess.prototype.requestOperationAccess.call(
    access(bridge),
    operation,
    args,
    route,
    timeoutMs,
    risk,
  );
}

function validateId(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_LENGTH ||
    !ID_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be 1..${MAX_ID_LENGTH} characters using letters, digits, '.', '_', ':', or '-'.`);
  }
}

function validateGlobalObjectId(value: string, label: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new Error(`${label} must be a non-empty Unity GlobalObjectId string.`);
  }
}

function validateVector(value: Vector3Payload, label: string): void {
  if (!isVector(value)) {
    throw new Error(`${label} must contain finite x/y/z numbers.`);
  }
}

function isVector(value: unknown): value is Vector3Payload {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.z === "number" &&
    Number.isFinite(value.z)
  );
}

function isTaskOperation(value: unknown): value is TaskOperation {
  return value === "gameObject.update" || value === "transform.set";
}

function isTaskStatus(value: unknown): value is TaskJournalPayload["status"] {
  return (
    value === "not_found" ||
    value === "ready" ||
    value === "waiting_reconciliation" ||
    value === "completed" ||
    value === "blocked"
  );
}

function isStepStatus(value: unknown): value is TaskStepStatusPayload["stepStatus"] {
  return (
    value === "pending" ||
    value === "started" ||
    value === "completed" ||
    value === "failed" ||
    value === "conflict"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
