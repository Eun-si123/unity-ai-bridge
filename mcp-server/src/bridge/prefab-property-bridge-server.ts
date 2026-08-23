import { randomUUID } from "node:crypto";

import { AssetBridgeServer } from "./asset-bridge-server.js";
import type { ComponentPropertyPayload } from "./editing-bridge-server.js";

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
  gameObjectGlobalObjectId: string;
  propertyPath: string;
  propertyType: string;
  prefabPath: string;
  prefabGuid: string;
  expectedPrefabDependencyHash: string;
  dependencyHashAfter: string;
  prefabOverrideBefore: boolean;
  prefabOverrideAfter: boolean;
  sourceMatchesInstanceAfter: boolean;
  sceneWasDirtyBefore: boolean;
  sceneIsDirtyAfter: boolean;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  stateEpoch: string;
  stateRevision: number;
  property: ComponentPropertyPayload;
}

const MAX_GLOBAL_OBJECT_ID_LENGTH = 256;
const MAX_PROPERTY_PATH_LENGTH = 512;
const MAX_PREFAB_PATH_LENGTH = 512;
const MAX_HASH_LENGTH = 128;
const MAX_MUTATION_ID_LENGTH = 128;
const MAX_STATE_EPOCH_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class PrefabPropertyBridgeServer extends AssetBridgeServer {
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
    validateHash(options.expectedPrefabDependencyHash);
    validateState(options.expectedStateEpoch, options.expectedStateRevision);
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
        { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
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
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_GLOBAL_OBJECT_ID_LENGTH ||
      !value.startsWith("GlobalObjectId_")) {
    throw new Error(`componentGlobalObjectId must be a Unity GlobalObjectId string of 1..${MAX_GLOBAL_OBJECT_ID_LENGTH} characters.`);
  }
}

function validatePropertyPath(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_PROPERTY_PATH_LENGTH) {
    throw new Error(`propertyPath must be a non-empty string of at most ${MAX_PROPERTY_PATH_LENGTH} characters.`);
  }
}

function validatePrefabPath(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PREFAB_PATH_LENGTH ||
      value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:\//.test(value) ||
      value.includes("../") || value.endsWith("/..") || !value.startsWith("Assets/") ||
      !value.toLowerCase().endsWith(".prefab")) {
    throw new Error("prefabPath must be an exact Assets/.../*.prefab project-relative path with forward slashes and no parent traversal.");
  }
}

function validateHash(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HASH_LENGTH) {
    throw new Error(`expectedPrefabDependencyHash must be 1..${MAX_HASH_LENGTH} characters.`);
  }
}

function validateMutationId(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_MUTATION_ID_LENGTH ||
      !MUTATION_ID_PATTERN.test(value)) {
    throw new Error("mutationId must be 1..128 characters using only letters, digits, '-', '_', '.', and ':'.");
  }
}

function validateState(epoch: string, revision: number): void {
  if (typeof epoch !== "string" || epoch.length === 0 || epoch.length > MAX_STATE_EPOCH_LENGTH) {
    throw new Error(`expectedStateEpoch must be 1..${MAX_STATE_EPOCH_LENGTH} characters.`);
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("expectedStateRevision must be a positive safe integer.");
  }
}

function isPrefabPropertyApplyPayload(value: unknown): value is PrefabPropertyApplyPayload {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.mutationId === "string" && c.mutationId.length > 0 &&
    typeof c.replayed === "boolean" && c.applied === true &&
    typeof c.componentGlobalObjectId === "string" && c.componentGlobalObjectId.length > 0 &&
    typeof c.gameObjectGlobalObjectId === "string" && c.gameObjectGlobalObjectId.length > 0 &&
    typeof c.propertyPath === "string" && c.propertyPath.length > 0 &&
    typeof c.propertyType === "string" && c.propertyType.length > 0 &&
    typeof c.prefabPath === "string" && c.prefabPath.startsWith("Assets/") &&
    typeof c.prefabGuid === "string" && c.prefabGuid.length > 0 &&
    typeof c.expectedPrefabDependencyHash === "string" && c.expectedPrefabDependencyHash.length > 0 &&
    typeof c.dependencyHashAfter === "string" && c.dependencyHashAfter.length > 0 &&
    typeof c.prefabOverrideBefore === "boolean" &&
    typeof c.prefabOverrideAfter === "boolean" &&
    typeof c.sourceMatchesInstanceAfter === "boolean" &&
    typeof c.sceneWasDirtyBefore === "boolean" &&
    typeof c.sceneIsDirtyAfter === "boolean" &&
    typeof c.expectedStateEpoch === "string" && c.expectedStateEpoch.length > 0 &&
    isPositiveInteger(c.expectedStateRevision) &&
    typeof c.stateEpoch === "string" && c.stateEpoch.length > 0 &&
    isPositiveInteger(c.stateRevision) &&
    isComponentPropertyPayload(c.property)
  );
}

function isComponentPropertyPayload(value: unknown): value is ComponentPropertyPayload {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.path === "string" && typeof c.propertyType === "string" &&
    typeof c.valueKind === "string" && typeof c.isArray === "boolean";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
