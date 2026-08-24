import { randomUUID } from "node:crypto";

import { ScriptBridgeServer } from "./script-bridge-server.js";

export interface PrefabPropertyApplyOptions {
  componentGlobalObjectId: string;
  propertyPath: string;
  prefabPath: string;
  expectedPrefabDependencyHash: string;
  mutationId?: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
}

export interface PrefabPropertyApplyPayload {
  mutationId: string;
  replayed: boolean;
  applied: boolean;
  componentGlobalObjectId: string;
  componentTypeName: string;
  propertyPath: string;
  prefabPath: string;
  prefabGuid: string;
  expectedPrefabDependencyHash: string;
  dependencyHashBefore: string;
  dependencyHashAfter: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  stateEpoch: string;
  stateRevision: number;
}

const MAX_GLOBAL_OBJECT_ID_LENGTH = 256;
const MAX_PROPERTY_PATH_LENGTH = 512;
const MAX_PREFAB_PATH_LENGTH = 512;
const MAX_HASH_LENGTH = 128;
const MAX_MUTATION_ID_LENGTH = 128;
const MAX_STATE_EPOCH_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class PrefabPropertyBridgeServer extends ScriptBridgeServer {
  public async requestApplyPrefabPropertyOverride(
    options: PrefabPropertyApplyOptions,
    timeoutMs = 5000,
  ): Promise<PrefabPropertyApplyPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateGlobalObjectId(options.componentGlobalObjectId);
    validatePropertyPath(options.propertyPath);
    validatePrefabPath(options.prefabPath);
    validateDependencyHash(options.expectedPrefabDependencyHash);
    validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);
    const mutationId = options.mutationId ?? randomUUID();
    validateMutationId(mutationId);

    try {
      const result = await this.requestOperation(
        "prefab.property.apply",
        {
          componentGlobalObjectId: options.componentGlobalObjectId,
          propertyPath: options.propertyPath,
          prefabPath: options.prefabPath,
          expectedPrefabDependencyHash: options.expectedPrefabDependencyHash,
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

      if (!isPrefabPropertyApplyPayload(result)) {
        throw new Error("Unity returned an invalid prefab.property.apply payload.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} mutationId=${mutationId}`);
    }
  }
}

function validateGlobalObjectId(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_GLOBAL_OBJECT_ID_LENGTH ||
    !value.startsWith("GlobalObjectId_")
  ) {
    throw new Error(
      `componentGlobalObjectId must be a Unity GlobalObjectId string of at most ${MAX_GLOBAL_OBJECT_ID_LENGTH} characters.`,
    );
  }
}

function validatePropertyPath(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("propertyPath is required.");
  }
  if (value.length > MAX_PROPERTY_PATH_LENGTH) {
    throw new Error(`propertyPath must be at most ${MAX_PROPERTY_PATH_LENGTH} characters.`);
  }
  if (value === "m_Script") {
    throw new Error("propertyPath m_Script is not supported.");
  }
  if (value.includes(".Array.")) {
    throw new Error(
      "Array elements and Array.size are excluded from the first prefab property apply slice.",
    );
  }
}

function validatePrefabPath(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("prefabPath is required.");
  }
  if (value.length > MAX_PREFAB_PATH_LENGTH) {
    throw new Error(`prefabPath must be at most ${MAX_PREFAB_PATH_LENGTH} characters.`);
  }
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.includes("../") ||
    value.endsWith("/..") ||
    !value.startsWith("Assets/")
  ) {
    throw new Error(
      "prefabPath must be a project-relative forward-slash path under Assets with no parent traversal.",
    );
  }
  if (!value.toLowerCase().endsWith(".prefab")) {
    throw new Error("prefabPath must end in .prefab.");
  }
}

function validateDependencyHash(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HASH_LENGTH) {
    throw new Error(
      `expectedPrefabDependencyHash must be 1..${MAX_HASH_LENGTH} characters.`,
    );
  }
}

function validateMutationId(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MUTATION_ID_LENGTH ||
    !MUTATION_ID_PATTERN.test(value)
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

function isPrefabPropertyApplyPayload(value: unknown): value is PrefabPropertyApplyPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    candidate.applied === true &&
    typeof candidate.componentGlobalObjectId === "string" && candidate.componentGlobalObjectId.length > 0 &&
    typeof candidate.componentTypeName === "string" && candidate.componentTypeName.length > 0 &&
    typeof candidate.propertyPath === "string" && candidate.propertyPath.length > 0 &&
    typeof candidate.prefabPath === "string" && candidate.prefabPath.length > 0 &&
    typeof candidate.prefabGuid === "string" && candidate.prefabGuid.length > 0 &&
    typeof candidate.expectedPrefabDependencyHash === "string" && candidate.expectedPrefabDependencyHash.length > 0 &&
    typeof candidate.dependencyHashBefore === "string" && candidate.dependencyHashBefore.length > 0 &&
    typeof candidate.dependencyHashAfter === "string" && candidate.dependencyHashAfter.length > 0 &&
    typeof candidate.expectedStateEpoch === "string" && candidate.expectedStateEpoch.length > 0 &&
    isPositiveInteger(candidate.expectedStateRevision) &&
    typeof candidate.stateEpoch === "string" && candidate.stateEpoch.length > 0 &&
    isPositiveInteger(candidate.stateRevision)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
