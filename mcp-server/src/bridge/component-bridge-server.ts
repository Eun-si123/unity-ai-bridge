import { EditingBridgeServer, type GameObjectSnapshotPayload } from "./editing-bridge-server.js";

export interface ComponentInspectOptions {
  gameObjectGlobalObjectId: string;
  maxComponents?: number;
  maxPropertiesPerComponent?: number;
  maxDepth?: number;
}

export interface ComponentPropertyPayload {
  path: string;
  displayName: string;
  depth: number;
  propertyType: string;
  isArray: boolean;
  arraySize: number;
  hasVisibleChildren: boolean;
  valueKind: string;
  stringValue: string;
  longValue: number;
  doubleValue: number;
  boolValue: boolean;
  objectReferenceGlobalObjectId: string;
  objectReferenceInstanceId: number;
  objectReferenceName: string;
  objectReferenceType: string;
}

export interface ComponentInspectEntryPayload {
  index: number;
  missingScript: boolean;
  globalObjectId: string;
  instanceId: number;
  typeName: string;
  assemblyQualifiedName: string;
  scriptAssetPath: string;
  returnedPropertyCount: number;
  truncatedByPropertyLimit: boolean;
  truncatedByDepth: boolean;
  properties: ComponentPropertyPayload[];
}

export interface ComponentInspectPayload {
  gameObject: GameObjectSnapshotPayload;
  componentCount: number;
  returnedComponentCount: number;
  missingScriptCount: number;
  truncatedByComponentLimit: boolean;
  maxComponents: number;
  maxPropertiesPerComponent: number;
  maxDepth: number;
  components: ComponentInspectEntryPayload[];
  stateEpoch: string;
  stateRevision: number;
}

const DEFAULT_MAX_COMPONENTS = 32;
const MAX_COMPONENTS = 64;
const DEFAULT_MAX_PROPERTIES = 128;
const MAX_PROPERTIES = 256;
const DEFAULT_MAX_DEPTH = 4;
const MAX_DEPTH = 8;
const MAX_GLOBAL_OBJECT_ID_LENGTH = 256;

export class ComponentBridgeServer extends EditingBridgeServer {
  public async requestInspectComponents(
    options: ComponentInspectOptions,
    timeoutMs = 5000,
  ): Promise<ComponentInspectPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateGlobalObjectId(options.gameObjectGlobalObjectId);
    const maxComponents = options.maxComponents ?? DEFAULT_MAX_COMPONENTS;
    const maxPropertiesPerComponent = options.maxPropertiesPerComponent ?? DEFAULT_MAX_PROPERTIES;
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    validateIntegerRange(maxComponents, "maxComponents", 1, MAX_COMPONENTS);
    validateIntegerRange(
      maxPropertiesPerComponent,
      "maxPropertiesPerComponent",
      1,
      MAX_PROPERTIES,
    );
    validateIntegerRange(maxDepth, "maxDepth", 0, MAX_DEPTH);

    const result = await this.requestOperation(
      "component.inspect",
      {
        gameObjectGlobalObjectId: options.gameObjectGlobalObjectId,
        maxComponents,
        maxPropertiesPerComponent,
        maxDepth,
      },
      {
        editorId: editor.editorId,
        connectionGeneration: editor.connectionGeneration,
      },
      timeoutMs,
      "read",
    );

    if (!isComponentInspectPayload(result)) {
      throw new Error("Unity returned an invalid component.inspect payload.");
    }
    return result;
  }
}

function validateGlobalObjectId(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("gameObjectGlobalObjectId is required.");
  }
  if (value.length > MAX_GLOBAL_OBJECT_ID_LENGTH) {
    throw new Error(
      `gameObjectGlobalObjectId must be at most ${MAX_GLOBAL_OBJECT_ID_LENGTH} characters.`,
    );
  }
}

function validateIntegerRange(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function isComponentInspectPayload(value: unknown): value is ComponentInspectPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isGameObjectSnapshot(candidate.gameObject) &&
    isNonNegativeInteger(candidate.componentCount) &&
    isNonNegativeInteger(candidate.returnedComponentCount) &&
    isNonNegativeInteger(candidate.missingScriptCount) &&
    typeof candidate.truncatedByComponentLimit === "boolean" &&
    isPositiveInteger(candidate.maxComponents) &&
    isPositiveInteger(candidate.maxPropertiesPerComponent) &&
    isNonNegativeInteger(candidate.maxDepth) &&
    Array.isArray(candidate.components) &&
    candidate.components.length === candidate.returnedComponentCount &&
    candidate.components.every(isComponentEntry) &&
    isStateRevision(candidate.stateEpoch, candidate.stateRevision)
  );
}

function isGameObjectSnapshot(value: unknown): value is GameObjectSnapshotPayload {
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

function isComponentEntry(value: unknown): value is ComponentInspectEntryPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(candidate.index) &&
    typeof candidate.missingScript === "boolean" &&
    typeof candidate.globalObjectId === "string" &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.typeName === "string" &&
    typeof candidate.assemblyQualifiedName === "string" &&
    typeof candidate.scriptAssetPath === "string" &&
    isNonNegativeInteger(candidate.returnedPropertyCount) &&
    typeof candidate.truncatedByPropertyLimit === "boolean" &&
    typeof candidate.truncatedByDepth === "boolean" &&
    Array.isArray(candidate.properties) &&
    candidate.properties.length === candidate.returnedPropertyCount &&
    candidate.properties.every(isComponentProperty)
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
    isNonNegativeInteger(candidate.depth) &&
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
