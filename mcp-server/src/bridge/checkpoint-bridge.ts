import { PrefabPropertyBridgeServer } from "./prefab-property-bridge-server.js";

const CHECKPOINT_ID_PATTERN = /^cp-[0-9a-f]{64}$/;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAXIMUM_RETAINED_CHECKPOINTS = 16;

type Vector3Payload = { x: number; y: number; z: number };
type QuaternionPayload = { x: number; y: number; z: number; w: number };

export type CheckpointSnapshotPayload = {
  checkpointId: string;
  globalObjectId: string;
  scenePath: string;
  parentGlobalObjectId: string;
  name: string;
  activeSelf: boolean;
  localPosition: Vector3Payload;
  localEulerAngles: Vector3Payload;
  localRotation: QuaternionPayload;
  localScale: Vector3Payload;
  capturedStateEpoch: string;
  capturedStateRevision: number;
  capturedUnixMs: number;
  retainedCheckpointCount: number;
  maximumRetainedCheckpoints: 16;
};

export type CheckpointRestoreOptions = {
  checkpointId: string;
  mutationId: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
};

export type CheckpointRestorePayload = {
  checkpointId: string;
  mutationId: string;
  replayed: boolean;
  changed: boolean;
  requestedGlobalObjectId: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  gameObject: Record<string, unknown> & {
    globalObjectId: string;
    name: string;
    activeSelf: boolean;
    scenePath: string;
    sceneIsDirty: boolean;
    stateEpoch: string;
    stateRevision: number;
  };
  transform: Record<string, unknown> & {
    globalObjectId: string;
    scenePath: string;
    localPosition: Vector3Payload;
    localEulerAngles: Vector3Payload;
    localRotation: QuaternionPayload;
    localScale: Vector3Payload;
    stateEpoch: string;
    stateRevision: number;
  };
};

interface EditorIdentity {
  editorId: string;
  connectionGeneration: number;
}

class CheckpointBridgeAccess extends PrefabPropertyBridgeServer {
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
    route: EditorIdentity,
    timeoutMs: number,
    risk: "read" | "write",
  ): Promise<unknown> {
    return this.requestOperation(operation, args, route, timeoutMs, risk);
  }
}

export async function requestCheckpointCapture(
  bridge: PrefabPropertyBridgeServer,
  globalObjectId: string,
  timeoutMs = 5_000,
): Promise<CheckpointSnapshotPayload> {
  validateGlobalObjectId(globalObjectId);
  const editor = requireConnectedEditor(bridge);
  const raw = await requestOperation(
    bridge,
    "checkpoint.capture",
    { globalObjectId },
    editor,
    timeoutMs,
    "read",
  );
  if (!isCheckpointSnapshotPayload(raw)) {
    throw new Error("Unity returned an invalid checkpoint.capture payload.");
  }
  return raw;
}

export async function requestCheckpointGet(
  bridge: PrefabPropertyBridgeServer,
  checkpointId: string,
  timeoutMs = 5_000,
): Promise<CheckpointSnapshotPayload> {
  validateCheckpointId(checkpointId);
  const editor = requireConnectedEditor(bridge);
  const raw = await requestOperation(
    bridge,
    "checkpoint.get",
    { checkpointId },
    editor,
    timeoutMs,
    "read",
  );
  if (!isCheckpointSnapshotPayload(raw) || raw.checkpointId !== checkpointId) {
    throw new Error("Unity returned an invalid checkpoint.get payload.");
  }
  return raw;
}

export async function requestCheckpointRestore(
  bridge: PrefabPropertyBridgeServer,
  options: CheckpointRestoreOptions,
  timeoutMs = 5_000,
): Promise<CheckpointRestorePayload> {
  validateCheckpointId(options.checkpointId);
  validateMutationId(options.mutationId);
  validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);
  const editor = requireConnectedEditor(bridge);
  const raw = await requestOperation(
    bridge,
    "checkpoint.restore",
    {
      checkpointId: options.checkpointId,
      mutationId: options.mutationId,
      expectedStateEpoch: options.expectedStateEpoch,
      expectedStateRevision: options.expectedStateRevision,
    },
    editor,
    timeoutMs,
    "write",
  );
  if (!isCheckpointRestorePayload(raw)) {
    throw new Error("Unity returned an invalid checkpoint.restore payload.");
  }
  if (raw.checkpointId !== options.checkpointId || raw.mutationId !== options.mutationId) {
    throw new Error("Unity checkpoint.restore result identity did not match the request.");
  }
  return raw;
}

export function isCheckpointSnapshotPayload(value: unknown): value is CheckpointSnapshotPayload {
  if (!isRecord(value)) return false;
  return typeof value.checkpointId === "string" && CHECKPOINT_ID_PATTERN.test(value.checkpointId) &&
    typeof value.globalObjectId === "string" && value.globalObjectId.length > 0 &&
    typeof value.scenePath === "string" && value.scenePath.length > 0 &&
    typeof value.parentGlobalObjectId === "string" &&
    typeof value.name === "string" &&
    typeof value.activeSelf === "boolean" &&
    isVector3(value.localPosition) &&
    isVector3(value.localEulerAngles) &&
    isQuaternion(value.localRotation) &&
    isVector3(value.localScale) &&
    typeof value.capturedStateEpoch === "string" && value.capturedStateEpoch.length > 0 &&
    isPositiveInteger(value.capturedStateRevision) &&
    isPositiveInteger(value.capturedUnixMs) &&
    isPositiveInteger(value.retainedCheckpointCount) &&
    value.retainedCheckpointCount <= MAXIMUM_RETAINED_CHECKPOINTS &&
    value.maximumRetainedCheckpoints === MAXIMUM_RETAINED_CHECKPOINTS;
}

export function isCheckpointRestorePayload(value: unknown): value is CheckpointRestorePayload {
  if (!isRecord(value) ||
    typeof value.checkpointId !== "string" || !CHECKPOINT_ID_PATTERN.test(value.checkpointId) ||
    typeof value.mutationId !== "string" || !validMutationId(value.mutationId) ||
    typeof value.replayed !== "boolean" ||
    typeof value.changed !== "boolean" ||
    typeof value.requestedGlobalObjectId !== "string" || value.requestedGlobalObjectId.length === 0 ||
    typeof value.expectedStateEpoch !== "string" || value.expectedStateEpoch.length === 0 ||
    !isPositiveInteger(value.expectedStateRevision) ||
    !isGameObjectReadback(value.gameObject) ||
    !isTransformReadback(value.transform)) {
    return false;
  }

  return value.gameObject.globalObjectId === value.requestedGlobalObjectId &&
    value.transform.globalObjectId === value.requestedGlobalObjectId &&
    value.gameObject.scenePath === value.transform.scenePath &&
    value.gameObject.stateEpoch === value.transform.stateEpoch &&
    value.gameObject.stateRevision === value.transform.stateRevision;
}

function isGameObjectReadback(value: unknown): value is CheckpointRestorePayload["gameObject"] {
  return isRecord(value) &&
    typeof value.globalObjectId === "string" && value.globalObjectId.length > 0 &&
    typeof value.name === "string" &&
    typeof value.activeSelf === "boolean" &&
    typeof value.scenePath === "string" && value.scenePath.length > 0 &&
    typeof value.sceneIsDirty === "boolean" &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    isPositiveInteger(value.stateRevision);
}

function isTransformReadback(value: unknown): value is CheckpointRestorePayload["transform"] {
  return isRecord(value) &&
    typeof value.globalObjectId === "string" && value.globalObjectId.length > 0 &&
    typeof value.scenePath === "string" && value.scenePath.length > 0 &&
    isVector3(value.localPosition) &&
    isVector3(value.localEulerAngles) &&
    isQuaternion(value.localRotation) &&
    isVector3(value.localScale) &&
    typeof value.stateEpoch === "string" && value.stateEpoch.length > 0 &&
    isPositiveInteger(value.stateRevision);
}

function isVector3(value: unknown): value is Vector3Payload {
  return isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z);
}

function isQuaternion(value: unknown): value is QuaternionPayload {
  return isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.w);
}

function validateGlobalObjectId(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    throw new Error("globalObjectId must be a non-empty string of at most 512 characters.");
  }
}

function validateCheckpointId(value: string): void {
  if (typeof value !== "string" || !CHECKPOINT_ID_PATTERN.test(value)) {
    throw new Error("checkpointId must be the exact cp-<lowercase sha256> id returned by Unity.");
  }
}

function validateMutationId(value: string): void {
  if (!validMutationId(value)) {
    throw new Error(
      "mutationId must be 1..128 characters using only letters, digits, '.', '_', ':', or '-'.",
    );
  }
}

function validMutationId(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && MUTATION_ID_PATTERN.test(value);
}

function validateStateExpectation(epoch: string, revision: number): void {
  if (typeof epoch !== "string" || epoch.length < 1 || epoch.length > 128) {
    throw new Error("expectedStateEpoch must be 1..128 characters.");
  }
  if (!isPositiveInteger(revision)) {
    throw new Error("expectedStateRevision must be a positive safe integer.");
  }
}

function requireConnectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity {
  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }
  return editor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function access(bridge: PrefabPropertyBridgeServer): CheckpointBridgeAccess {
  return bridge as unknown as CheckpointBridgeAccess;
}

function connectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity | undefined {
  return CheckpointBridgeAccess.prototype.connectedEditorAccess.call(access(bridge));
}

function requestOperation(
  bridge: PrefabPropertyBridgeServer,
  operation: string,
  args: Record<string, unknown>,
  route: EditorIdentity,
  timeoutMs: number,
  risk: "read" | "write",
): Promise<unknown> {
  return CheckpointBridgeAccess.prototype.requestOperationAccess.call(
    access(bridge),
    operation,
    args,
    route,
    timeoutMs,
    risk,
  );
}
