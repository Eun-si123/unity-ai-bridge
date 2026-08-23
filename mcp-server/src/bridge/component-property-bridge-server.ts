import { randomUUID } from "node:crypto";

import {
  EditingBridgeServer,
  type ComponentPropertyPayload,
  type ComponentSnapshotPayload,
} from "./editing-bridge-server.js";
import type { Vector3Payload } from "./local-bridge-server.js";

export type ComponentPropertyValue =
  | { kind: "boolean"; boolValue: boolean }
  | { kind: "integer"; longValue: number }
  | { kind: "number"; doubleValue: number }
  | { kind: "string"; stringValue: string }
  | { kind: "vector3"; vector3Value: Vector3Payload };

export interface ComponentPropertySetOptions {
  componentGlobalObjectId: string;
  propertyPath: string;
  value: ComponentPropertyValue;
  mutationId?: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
}

export interface ComponentPropertySetPayload {
  mutationId: string;
  replayed: boolean;
  changed: boolean;
  requestedComponentGlobalObjectId: string;
  requestedPropertyPath: string;
  requestedValue: ComponentPropertyValue;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  component: ComponentSnapshotPayload;
  property: ComponentPropertyPayload;
}

const MAX_GLOBAL_OBJECT_ID_LENGTH = 256;
const MAX_PROPERTY_PATH_LENGTH = 512;
const MAX_STRING_VALUE_LENGTH = 4096;
const MAX_MUTATION_ID_LENGTH = 128;
const MAX_STATE_EPOCH_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class ComponentPropertyBridgeServer extends EditingBridgeServer {
  public async requestSetComponentProperty(
    options: ComponentPropertySetOptions,
    timeoutMs = 5000,
  ): Promise<ComponentPropertySetPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    const mutationId = options.mutationId ?? randomUUID();
    validateGlobalObjectId(options.componentGlobalObjectId);
    validatePropertyPath(options.propertyPath);
    validatePropertyValue(options.value);
    validateMutationId(mutationId);
    validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);

    try {
      const result = await this.requestOperation(
        "component.property.set",
        {
          componentGlobalObjectId: options.componentGlobalObjectId,
          propertyPath: options.propertyPath,
          value: options.value,
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

      if (!isComponentPropertySetPayload(result)) {
        throw new Error("Unity returned an invalid component.property.set payload.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} mutationId=${mutationId}`);
    }
  }
}

function validateGlobalObjectId(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("componentGlobalObjectId is required.");
  }
  if (value.length > MAX_GLOBAL_OBJECT_ID_LENGTH) {
    throw new Error(
      `componentGlobalObjectId must be at most ${MAX_GLOBAL_OBJECT_ID_LENGTH} characters.`,
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
}

function validatePropertyValue(value: ComponentPropertyValue): void {
  if (typeof value !== "object" || value === null || typeof value.kind !== "string") {
    throw new Error("value is required.");
  }

  switch (value.kind) {
    case "boolean":
      if (typeof value.boolValue !== "boolean") {
        throw new Error("boolean Component property values require boolValue.");
      }
      return;
    case "integer":
      if (!Number.isSafeInteger(value.longValue)) {
        throw new Error("integer Component property values require a safe integer longValue.");
      }
      return;
    case "number":
      if (typeof value.doubleValue !== "number" || !Number.isFinite(value.doubleValue)) {
        throw new Error("number Component property values require a finite doubleValue.");
      }
      return;
    case "string":
      if (typeof value.stringValue !== "string") {
        throw new Error("string Component property values require stringValue.");
      }
      if (value.stringValue.length > MAX_STRING_VALUE_LENGTH) {
        throw new Error(
          `stringValue must be at most ${MAX_STRING_VALUE_LENGTH} characters.`,
        );
      }
      return;
    case "vector3":
      if (!isVector3(value.vector3Value)) {
        throw new Error(
          "vector3 Component property values require vector3Value with finite x/y/z numbers.",
        );
      }
      return;
    default:
      throw new Error(
        "Component property value kind must be one of boolean, integer, number, string, vector3.",
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

function isComponentPropertySetPayload(value: unknown): value is ComponentPropertySetPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.changed === "boolean" &&
    typeof candidate.requestedComponentGlobalObjectId === "string" &&
    candidate.requestedComponentGlobalObjectId.length > 0 &&
    typeof candidate.requestedPropertyPath === "string" &&
    candidate.requestedPropertyPath.length > 0 &&
    isComponentPropertyValue(candidate.requestedValue) &&
    typeof candidate.expectedStateEpoch === "string" &&
    candidate.expectedStateEpoch.length > 0 &&
    typeof candidate.expectedStateRevision === "number" &&
    Number.isSafeInteger(candidate.expectedStateRevision) &&
    candidate.expectedStateRevision > 0 &&
    isComponentSnapshot(candidate.component) &&
    isComponentProperty(candidate.property)
  );
}

function isComponentPropertyValue(value: unknown): value is ComponentPropertyValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "boolean":
      return typeof candidate.boolValue === "boolean";
    case "integer":
      return typeof candidate.longValue === "number" && Number.isSafeInteger(candidate.longValue);
    case "number":
      return typeof candidate.doubleValue === "number" && Number.isFinite(candidate.doubleValue);
    case "string":
      return typeof candidate.stringValue === "string";
    case "vector3":
      return isVector3(candidate.vector3Value);
    default:
      return false;
  }
}

function isComponentSnapshot(value: unknown): value is ComponentSnapshotPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.typeName === "string" &&
    candidate.typeName.length > 0 &&
    typeof candidate.assemblyQualifiedName === "string" &&
    typeof candidate.gameObjectGlobalObjectId === "string" &&
    candidate.gameObjectGlobalObjectId.length > 0 &&
    typeof candidate.gameObjectInstanceId === "number" &&
    Number.isSafeInteger(candidate.gameObjectInstanceId) &&
    typeof candidate.gameObjectName === "string" &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    typeof candidate.componentIndex === "number" &&
    Number.isSafeInteger(candidate.componentIndex) &&
    candidate.componentIndex >= 0 &&
    typeof candidate.stateEpoch === "string" &&
    candidate.stateEpoch.length > 0 &&
    typeof candidate.stateRevision === "number" &&
    Number.isSafeInteger(candidate.stateRevision) &&
    candidate.stateRevision > 0
  );
}

function isComponentProperty(value: unknown): value is ComponentPropertyPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.depth === "number" &&
    Number.isSafeInteger(candidate.depth) &&
    candidate.depth >= 0 &&
    typeof candidate.propertyType === "string" &&
    typeof candidate.isArray === "boolean" &&
    typeof candidate.arraySize === "number" &&
    Number.isSafeInteger(candidate.arraySize) &&
    typeof candidate.hasVisibleChildren === "boolean" &&
    typeof candidate.valueKind === "string" &&
    typeof candidate.stringValue === "string" &&
    typeof candidate.longValue === "number" &&
    Number.isFinite(candidate.longValue) &&
    typeof candidate.doubleValue === "number" &&
    Number.isFinite(candidate.doubleValue) &&
    typeof candidate.boolValue === "boolean" &&
    typeof candidate.objectReferenceGlobalObjectId === "string" &&
    typeof candidate.objectReferenceInstanceId === "number" &&
    Number.isSafeInteger(candidate.objectReferenceInstanceId) &&
    typeof candidate.objectReferenceName === "string" &&
    typeof candidate.objectReferenceType === "string"
  );
}

function isVector3(value: unknown): value is Vector3Payload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    typeof candidate.z === "number" &&
    Number.isFinite(candidate.z)
  );
}
