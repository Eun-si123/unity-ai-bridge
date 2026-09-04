import { PrefabPropertyBridgeServer } from "./prefab-property-bridge-server.js";

const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_HISTORY_RESULTS = 32;

export type BridgeActionHistoryEntry = {
  operation: string;
  mutationId: string;
  undoGroup: number;
  undoGroupName: string;
  scenePath: string;
  completedUnixMs: number;
  stateBeforeEpoch: string;
  stateBeforeRevision: number;
  stateAfterEpoch: string;
  stateAfterRevision: number;
  undone: boolean;
  undoPerformedUnixMs: number;
  undoStateEpoch: string;
  undoStateRevision: number;
  isLatest: boolean;
  safeToUndoNow: boolean;
  unsafeReason: string;
};

export type BridgeActionHistoryPayload = {
  journalKind: "bridge_action_history_v1";
  sessionScope: "current_editor_session";
  coverage: "editor_mutation_transaction_scene_edits_v1";
  returnedCount: number;
  maximumResults: 32;
  stateEpoch: string;
  stateRevision: number;
  currentUndoGroup: number;
  currentUndoGroupName: string;
  actions: BridgeActionHistoryEntry[];
};

export type BridgeActionUndoPayload = {
  operation: string;
  mutationId: string;
  undone: true;
  undoGroup: number;
  undoGroupName: string;
  observedUndoGroup: number;
  observedUndoName: string;
  priorStateEpoch: string;
  priorStateRevision: number;
  stateEpoch: string;
  stateRevision: number;
  sceneIsDirty: boolean;
};

export type BridgeActionUndoOptions = {
  mutationId: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
};

interface EditorIdentity {
  editorId: string;
  connectionGeneration: number;
}

class BridgeActionAccess extends PrefabPropertyBridgeServer {
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

export async function requestBridgeActionHistory(
  bridge: PrefabPropertyBridgeServer,
  maxResults = 10,
  timeoutMs = 5_000,
): Promise<BridgeActionHistoryPayload> {
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > MAX_HISTORY_RESULTS) {
    throw new Error(`maxResults must be an integer from 1 to ${MAX_HISTORY_RESULTS}.`);
  }

  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }

  const raw = await requestOperation(
    bridge,
    "action.history",
    { maxResults },
    editor,
    timeoutMs,
    "read",
  );
  if (!isBridgeActionHistoryPayload(raw)) {
    throw new Error("Unity returned an invalid action.history payload.");
  }
  return raw;
}

export async function requestUndoLastBridgeAction(
  bridge: PrefabPropertyBridgeServer,
  options: BridgeActionUndoOptions,
  timeoutMs = 5_000,
): Promise<BridgeActionUndoPayload> {
  validateMutationId(options.mutationId);
  validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);
  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }

  const raw = await requestOperation(
    bridge,
    "action.undoLast",
    {
      mutationId: options.mutationId,
      expectedStateEpoch: options.expectedStateEpoch,
      expectedStateRevision: options.expectedStateRevision,
    },
    editor,
    timeoutMs,
    "write",
  );
  if (!isBridgeActionUndoPayload(raw)) {
    throw new Error("Unity returned an invalid action.undoLast payload.");
  }
  return raw;
}

export function isBridgeActionHistoryPayload(value: unknown): value is BridgeActionHistoryPayload {
  if (!isRecord(value)) return false;
  if (
    value.journalKind !== "bridge_action_history_v1" ||
    value.sessionScope !== "current_editor_session" ||
    value.coverage !== "editor_mutation_transaction_scene_edits_v1" ||
    !isNonNegativeInteger(value.returnedCount) ||
    value.maximumResults !== MAX_HISTORY_RESULTS ||
    typeof value.stateEpoch !== "string" ||
    value.stateEpoch.length === 0 ||
    !isPositiveInteger(value.stateRevision) ||
    !isNonNegativeInteger(value.currentUndoGroup) ||
    typeof value.currentUndoGroupName !== "string" ||
    !Array.isArray(value.actions) ||
    value.actions.length > MAX_HISTORY_RESULTS ||
    value.returnedCount !== value.actions.length
  ) {
    return false;
  }

  let latestCount = 0;
  for (let index = 0; index < value.actions.length; index += 1) {
    const action = value.actions[index];
    if (!isBridgeActionHistoryEntry(action)) return false;
    if (action.isLatest) latestCount += 1;
    if (action.isLatest !== (index === 0)) return false;
    if (action.safeToUndoNow && (!action.isLatest || action.undone || action.unsafeReason !== "")) {
      return false;
    }
    if (!action.safeToUndoNow && action.unsafeReason.length === 0) return false;
  }

  return value.actions.length === 0 ? latestCount === 0 : latestCount === 1;
}

export function isBridgeActionUndoPayload(value: unknown): value is BridgeActionUndoPayload {
  if (!isRecord(value)) return false;
  return typeof value.operation === "string" &&
    value.operation.length > 0 &&
    typeof value.mutationId === "string" &&
    validMutationId(value.mutationId) &&
    value.undone === true &&
    isNonNegativeInteger(value.undoGroup) &&
    typeof value.undoGroupName === "string" &&
    value.undoGroupName.length > 0 &&
    value.observedUndoGroup === value.undoGroup &&
    value.observedUndoName === value.undoGroupName &&
    typeof value.priorStateEpoch === "string" &&
    value.priorStateEpoch.length > 0 &&
    isPositiveInteger(value.priorStateRevision) &&
    typeof value.stateEpoch === "string" &&
    value.stateEpoch.length > 0 &&
    isPositiveInteger(value.stateRevision) &&
    typeof value.sceneIsDirty === "boolean" &&
    (value.stateEpoch !== value.priorStateEpoch || value.stateRevision !== value.priorStateRevision);
}

function isBridgeActionHistoryEntry(value: unknown): value is BridgeActionHistoryEntry {
  if (!isRecord(value)) return false;
  if (
    typeof value.operation !== "string" || value.operation.length === 0 ||
    typeof value.mutationId !== "string" || !validMutationId(value.mutationId) ||
    !isNonNegativeInteger(value.undoGroup) ||
    typeof value.undoGroupName !== "string" || value.undoGroupName.length === 0 ||
    typeof value.scenePath !== "string" ||
    !isPositiveInteger(value.completedUnixMs) ||
    typeof value.stateBeforeEpoch !== "string" || value.stateBeforeEpoch.length === 0 ||
    !isPositiveInteger(value.stateBeforeRevision) ||
    typeof value.stateAfterEpoch !== "string" || value.stateAfterEpoch.length === 0 ||
    !isPositiveInteger(value.stateAfterRevision) ||
    typeof value.undone !== "boolean" ||
    !isNonNegativeInteger(value.undoPerformedUnixMs) ||
    typeof value.undoStateEpoch !== "string" ||
    !isNonNegativeInteger(value.undoStateRevision) ||
    typeof value.isLatest !== "boolean" ||
    typeof value.safeToUndoNow !== "boolean" ||
    typeof value.unsafeReason !== "string"
  ) {
    return false;
  }

  if (value.undone) {
    return value.undoPerformedUnixMs > 0 &&
      value.undoStateEpoch.length > 0 &&
      value.undoStateRevision > 0 &&
      !value.safeToUndoNow;
  }

  return value.undoPerformedUnixMs === 0 &&
    value.undoStateEpoch === "" &&
    value.undoStateRevision === 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function access(bridge: PrefabPropertyBridgeServer): BridgeActionAccess {
  return bridge as unknown as BridgeActionAccess;
}

function connectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity | undefined {
  return BridgeActionAccess.prototype.connectedEditorAccess.call(access(bridge));
}

function requestOperation(
  bridge: PrefabPropertyBridgeServer,
  operation: string,
  args: Record<string, unknown>,
  route: EditorIdentity,
  timeoutMs: number,
  risk: "read" | "write",
): Promise<unknown> {
  return BridgeActionAccess.prototype.requestOperationAccess.call(
    access(bridge),
    operation,
    args,
    route,
    timeoutMs,
    risk,
  );
}
