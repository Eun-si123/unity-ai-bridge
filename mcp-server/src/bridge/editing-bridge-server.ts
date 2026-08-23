import { randomUUID } from "node:crypto";

import { LocalBridgeServer } from "./local-bridge-server.js";

export interface GameObjectSnapshotPayload {
  globalObjectId: string;
  instanceId: number;
  name: string;
  activeSelf: boolean;
  activeInHierarchy: boolean;
  childCount: number;
  sceneName: string;
  scenePath: string;
  hierarchyPath: string;
  siblingIndex: number;
  sceneIsDirty: boolean;
  stateEpoch: string;
  stateRevision: number;
}

export interface GameObjectUpdateOptions {
  globalObjectId: string;
  name: string;
  activeSelf: boolean;
  mutationId?: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
}

export interface GameObjectUpdatePayload {
  mutationId: string;
  replayed: boolean;
  changed: boolean;
  requestedGlobalObjectId: string;
  requestedName: string;
  requestedActiveSelf: boolean;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  gameObject: GameObjectSnapshotPayload;
}

export interface GameObjectDeleteOptions {
  globalObjectId: string;
  mutationId?: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
}

export interface GameObjectDeletePayload {
  mutationId: string;
  replayed: boolean;
  deleted: boolean;
  requestedGlobalObjectId: string;
  deletedName: string;
  deletedSceneName: string;
  deletedScenePath: string;
  deletedHierarchyPath: string;
  deletedChildCount: number;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  stateEpoch: string;
  stateRevision: number;
}

const MAX_GLOBAL_OBJECT_ID_LENGTH = 256;
const MAX_GAMEOBJECT_NAME_LENGTH = 128;
const MAX_MUTATION_ID_LENGTH = 128;
const MAX_STATE_EPOCH_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class EditingBridgeServer extends LocalBridgeServer {
  public async requestUpdateGameObject(
    options: GameObjectUpdateOptions,
    timeoutMs = 5000,
  ): Promise<GameObjectUpdatePayload> {
    const editor = this.requireConnectedEditorMetadata();
    const mutationId = options.mutationId ?? randomUUID();

    validateGlobalObjectId(options.globalObjectId);
    validateName(options.name);
    if (typeof options.activeSelf !== "boolean") {
      throw new Error("activeSelf must be a boolean.");
    }
    validateMutationId(mutationId);
    validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);

    try {
      const result = await this.requestOperation(
        "gameObject.update",
        {
          globalObjectId: options.globalObjectId,
          name: options.name,
          activeSelf: options.activeSelf,
          mutationId,
          expectedStateEpoch: options.expectedStateEpoch,
          expectedStateRevision: options.expectedStateRevision,
        },
        {
          editorId: editor.editorId,
          connectionGeneration: editor.connectionGeneration,
        },
        timeoutMs,
        "write",
      );

      if (!isGameObjectUpdatePayload(result)) {
        throw new Error("Unity returned an invalid gameObject.update payload.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} mutationId=${mutationId}`);
    }
  }

  public async requestDeleteGameObject(
    options: GameObjectDeleteOptions,
    timeoutMs = 5000,
  ): Promise<GameObjectDeletePayload> {
    const editor = this.requireConnectedEditorMetadata();
    const mutationId = options.mutationId ?? randomUUID();

    validateGlobalObjectId(options.globalObjectId);
    validateMutationId(mutationId);
    validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);

    try {
      const result = await this.requestOperation(
        "gameObject.delete",
        {
          globalObjectId: options.globalObjectId,
          mutationId,
          expectedStateEpoch: options.expectedStateEpoch,
          expectedStateRevision: options.expectedStateRevision,
        },
        {
          editorId: editor.editorId,
          connectionGeneration: editor.connectionGeneration,
        },
        timeoutMs,
        "destructive",
      );

      if (!isGameObjectDeletePayload(result)) {
        throw new Error("Unity returned an invalid gameObject.delete payload.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} mutationId=${mutationId}`);
    }
  }

  private requireConnectedEditorMetadata(): {
    editorId: string;
    connectionGeneration: number;
  } {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }
    return {
      editorId: editor.editorId,
      connectionGeneration: editor.connectionGeneration,
    };
  }
}

function validateGlobalObjectId(globalObjectId: string): void {
  if (typeof globalObjectId !== "string" || globalObjectId.trim().length === 0) {
    throw new Error("globalObjectId is required.");
  }
  if (globalObjectId.length > MAX_GLOBAL_OBJECT_ID_LENGTH) {
    throw new Error(`globalObjectId must be at most ${MAX_GLOBAL_OBJECT_ID_LENGTH} characters.`);
  }
}

function validateName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("name must contain at least one non-whitespace character.");
  }
  if (name.length > MAX_GAMEOBJECT_NAME_LENGTH) {
    throw new Error(`name must be at most ${MAX_GAMEOBJECT_NAME_LENGTH} characters.`);
  }
}

function validateMutationId(mutationId: string): void {
  if (
    typeof mutationId !== "string" ||
    mutationId.length === 0 ||
    mutationId.length > MAX_MUTATION_ID_LENGTH ||
    !MUTATION_ID_PATTERN.test(mutationId)
  ) {
    throw new Error(
      "mutationId must be 1..128 characters using only letters, digits, '-', '_', '.', and ':'.",
    );
  }
}

function validateStateExpectation(epoch: string, revision: number): void {
  if (
    typeof epoch !== "string" ||
    epoch.length === 0 ||
    epoch.length > MAX_STATE_EPOCH_LENGTH
  ) {
    throw new Error(
      `expectedStateEpoch must be a non-empty string of at most ${MAX_STATE_EPOCH_LENGTH} characters.`,
    );
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("expectedStateRevision must be a positive safe integer.");
  }
}

function isGameObjectSnapshotPayload(value: unknown): value is GameObjectSnapshotPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.activeSelf === "boolean" &&
    typeof candidate.activeInHierarchy === "boolean" &&
    isNonNegativeInteger(candidate.childCount) &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    typeof candidate.sceneIsDirty === "boolean" &&
    isStateRevision(candidate.stateEpoch, candidate.stateRevision)
  );
}

function isGameObjectUpdatePayload(value: unknown): value is GameObjectUpdatePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.changed === "boolean" &&
    typeof candidate.requestedGlobalObjectId === "string" &&
    candidate.requestedGlobalObjectId.length > 0 &&
    typeof candidate.requestedName === "string" &&
    typeof candidate.requestedActiveSelf === "boolean" &&
    typeof candidate.expectedStateEpoch === "string" &&
    candidate.expectedStateEpoch.length > 0 &&
    isPositiveInteger(candidate.expectedStateRevision) &&
    isGameObjectSnapshotPayload(candidate.gameObject)
  );
}

function isGameObjectDeletePayload(value: unknown): value is GameObjectDeletePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    candidate.deleted === true &&
    typeof candidate.requestedGlobalObjectId === "string" &&
    candidate.requestedGlobalObjectId.length > 0 &&
    typeof candidate.deletedName === "string" &&
    typeof candidate.deletedSceneName === "string" &&
    typeof candidate.deletedScenePath === "string" &&
    typeof candidate.deletedHierarchyPath === "string" &&
    isNonNegativeInteger(candidate.deletedChildCount) &&
    typeof candidate.expectedStateEpoch === "string" &&
    candidate.expectedStateEpoch.length > 0 &&
    isPositiveInteger(candidate.expectedStateRevision) &&
    isStateRevision(candidate.stateEpoch, candidate.stateRevision)
  );
}

function isStateRevision(epoch: unknown, revision: unknown): boolean {
  return (
    typeof epoch === "string" &&
    epoch.length > 0 &&
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision > 0
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
