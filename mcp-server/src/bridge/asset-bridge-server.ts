import { randomUUID } from "node:crypto";

import { ComponentPropertyBridgeServer } from "./component-property-bridge-server.js";

export interface AssetSearchOptions {
  filter?: string;
  searchInFolders?: string[];
  maxResults?: number;
}

export interface AssetSummaryPayload {
  guid: string;
  path: string;
  name: string;
  extension: string;
  mainTypeName: string;
  isFolder: boolean;
}

export interface AssetSearchPayload {
  filter: string;
  searchInFolders: string[];
  maxResults: number;
  totalMatches: number;
  returnedCount: number;
  truncated: boolean;
  assets: AssetSummaryPayload[];
}

export interface AssetDependencyPayload {
  guid: string;
  path: string;
  mainTypeName: string;
}

export interface AssetInspectOptions {
  path: string;
  maxDependencies?: number;
}

export interface AssetInspectPayload {
  guid: string;
  path: string;
  name: string;
  extension: string;
  mainTypeName: string;
  mainAssetInstanceId: number;
  mainAssetName: string;
  importerTypeName: string;
  dependencyHash: string;
  labels: string[];
  directDependencyCount: number;
  returnedDependencyCount: number;
  dependenciesTruncated: boolean;
  directDependencies: AssetDependencyPayload[];
}

export interface PrefabInspectOptions {
  path: string;
  maxDepth?: number;
  maxNodes?: number;
}

export interface PrefabNodePayload {
  relativePath: string;
  name: string;
  depth: number;
  siblingIndex: number;
  childCount: number;
  activeSelf: boolean;
  componentTypeNames: string[];
}

export interface PrefabInspectPayload {
  guid: string;
  path: string;
  dependencyHash: string;
  prefabAssetType: string;
  rootName: string;
  totalNodeCount: number;
  returnedNodeCount: number;
  maxDepth: number;
  maxNodes: number;
  truncatedByDepth: boolean;
  truncatedByNodes: boolean;
  nodes: PrefabNodePayload[];
}

export interface PrefabInstantiateOptions {
  prefabPath: string;
  expectedPrefabDependencyHash: string;
  mutationId?: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
}

export interface PrefabInstantiatePayload {
  mutationId: string;
  replayed: boolean;
  prefabGuid: string;
  prefabPath: string;
  expectedPrefabDependencyHash: string;
  globalObjectId: string;
  instanceId: number;
  name: string;
  hierarchyPath: string;
  sceneName: string;
  scenePath: string;
  siblingIndex: number;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  stateEpoch: string;
  stateRevision: number;
}

const DEFAULT_SEARCH_FOLDERS = ["Assets"] as const;
const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 200;
const MAX_FILTER_LENGTH = 256;
const MAX_FOLDER_COUNT = 16;
const MAX_PATH_LENGTH = 512;
const DEFAULT_MAX_DEPENDENCIES = 64;
const MAX_DEPENDENCIES = 256;
const DEFAULT_PREFAB_MAX_DEPTH = 8;
const MAX_PREFAB_DEPTH = 32;
const DEFAULT_PREFAB_MAX_NODES = 100;
const MAX_PREFAB_NODES = 500;
const MAX_HASH_LENGTH = 128;
const MAX_MUTATION_ID_LENGTH = 128;
const MAX_STATE_EPOCH_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class AssetBridgeServer extends ComponentPropertyBridgeServer {
  public async requestSearchAssets(
    options: AssetSearchOptions = {},
    timeoutMs = 5000,
  ): Promise<AssetSearchPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    const filter = options.filter ?? "";
    const searchInFolders = options.searchInFolders ?? [...DEFAULT_SEARCH_FOLDERS];
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    validateFilter(filter);
    validateSearchFolders(searchInFolders);
    validateIntegerRange(maxResults, "maxResults", 1, MAX_RESULTS);

    const result = await this.requestOperation(
      "asset.search",
      { filter, searchInFolders, maxResults },
      { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
      timeoutMs,
      "read",
    );

    if (!isAssetSearchPayload(result)) {
      throw new Error("Unity returned an invalid asset.search payload.");
    }
    return result;
  }

  public async requestInspectAsset(
    options: AssetInspectOptions,
    timeoutMs = 5000,
  ): Promise<AssetInspectPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateProjectPath(options.path, "path");
    const maxDependencies = options.maxDependencies ?? DEFAULT_MAX_DEPENDENCIES;
    validateIntegerRange(maxDependencies, "maxDependencies", 0, MAX_DEPENDENCIES);

    const result = await this.requestOperation(
      "asset.inspect",
      { path: options.path, maxDependencies },
      { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
      timeoutMs,
      "read",
    );

    if (!isAssetInspectPayload(result)) {
      throw new Error("Unity returned an invalid asset.inspect payload.");
    }
    return result;
  }

  public async requestInspectPrefab(
    options: PrefabInspectOptions,
    timeoutMs = 5000,
  ): Promise<PrefabInspectPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }
    validateProjectPath(options.path, "path");
    const maxDepth = options.maxDepth ?? DEFAULT_PREFAB_MAX_DEPTH;
    const maxNodes = options.maxNodes ?? DEFAULT_PREFAB_MAX_NODES;
    validateIntegerRange(maxDepth, "maxDepth", 0, MAX_PREFAB_DEPTH);
    validateIntegerRange(maxNodes, "maxNodes", 1, MAX_PREFAB_NODES);

    const result = await this.requestOperation(
      "prefab.inspect",
      { path: options.path, maxDepth, maxNodes },
      { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
      timeoutMs,
      "read",
    );
    if (!isPrefabInspectPayload(result)) {
      throw new Error("Unity returned an invalid prefab.inspect payload.");
    }
    return result;
  }

  public async requestInstantiatePrefab(
    options: PrefabInstantiateOptions,
    timeoutMs = 5000,
  ): Promise<PrefabInstantiatePayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateProjectPath(options.prefabPath, "prefabPath");
    validateDependencyHash(options.expectedPrefabDependencyHash);
    validateStateExpectation(options.expectedStateEpoch, options.expectedStateRevision);
    const mutationId = options.mutationId ?? randomUUID();
    validateMutationId(mutationId);

    try {
      const result = await this.requestOperation(
        "prefab.instantiate",
        {
          prefabPath: options.prefabPath,
          expectedPrefabDependencyHash: options.expectedPrefabDependencyHash,
          mutationId,
          expectedStateEpoch: options.expectedStateEpoch,
          expectedStateRevision: options.expectedStateRevision,
        },
        { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
        timeoutMs,
        "write",
      );
      if (!isPrefabInstantiatePayload(result)) {
        throw new Error("Unity returned an invalid prefab.instantiate payload.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} mutationId=${mutationId}`);
    }
  }
}

function validateFilter(value: string): void {
  if (typeof value !== "string") {
    throw new Error("filter must be a string.");
  }
  if (value.length > MAX_FILTER_LENGTH) {
    throw new Error(`filter must be at most ${MAX_FILTER_LENGTH} characters.`);
  }
}

function validateSearchFolders(value: string[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FOLDER_COUNT) {
    throw new Error(`searchInFolders must contain 1..${MAX_FOLDER_COUNT} project folders.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const folder = value[index];
    if (folder === undefined) {
      throw new Error(`searchInFolders[${index}] is missing.`);
    }
    validateProjectPath(folder, `searchInFolders[${index}]`);
  }
}

function validateProjectPath(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  if (value.length > MAX_PATH_LENGTH) {
    throw new Error(`${name} must be at most ${MAX_PATH_LENGTH} characters.`);
  }
  if (value.includes("\\")) {
    throw new Error(`${name} must use forward slashes.`);
  }
  if (
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.includes("../") ||
    value.endsWith("/..")
  ) {
    throw new Error(`${name} must be project-relative and may not contain parent traversal.`);
  }
  if (
    value !== "Assets" &&
    !value.startsWith("Assets/") &&
    value !== "Packages" &&
    !value.startsWith("Packages/")
  ) {
    throw new Error(`${name} must be under Assets or Packages.`);
  }
}

function validateIntegerRange(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function validateDependencyHash(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HASH_LENGTH) {
    throw new Error(`expectedPrefabDependencyHash must be 1..${MAX_HASH_LENGTH} characters.`);
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
  if (typeof epoch !== "string" || epoch.length === 0 || epoch.length > MAX_STATE_EPOCH_LENGTH) {
    throw new Error(`expectedStateEpoch must be 1..${MAX_STATE_EPOCH_LENGTH} characters.`);
  }
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error("expectedStateRevision must be a positive safe integer.");
  }
}

function isAssetSearchPayload(value: unknown): value is AssetSearchPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.filter === "string" &&
    Array.isArray(candidate.searchInFolders) &&
    candidate.searchInFolders.every((entry) => typeof entry === "string") &&
    isPositiveInteger(candidate.maxResults) &&
    isNonNegativeInteger(candidate.totalMatches) &&
    isNonNegativeInteger(candidate.returnedCount) &&
    typeof candidate.truncated === "boolean" &&
    Array.isArray(candidate.assets) &&
    candidate.assets.length === candidate.returnedCount &&
    candidate.assets.every(isAssetSummaryPayload)
  );
}

function isAssetSummaryPayload(value: unknown): value is AssetSummaryPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.guid === "string" && candidate.guid.length > 0 &&
    typeof candidate.path === "string" && candidate.path.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.extension === "string" &&
    typeof candidate.mainTypeName === "string" &&
    typeof candidate.isFolder === "boolean"
  );
}

function isAssetInspectPayload(value: unknown): value is AssetInspectPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.guid === "string" && candidate.guid.length > 0 &&
    typeof candidate.path === "string" && candidate.path.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.extension === "string" &&
    typeof candidate.mainTypeName === "string" && candidate.mainTypeName.length > 0 &&
    typeof candidate.mainAssetInstanceId === "number" && Number.isSafeInteger(candidate.mainAssetInstanceId) &&
    typeof candidate.mainAssetName === "string" &&
    typeof candidate.importerTypeName === "string" &&
    typeof candidate.dependencyHash === "string" && candidate.dependencyHash.length > 0 &&
    Array.isArray(candidate.labels) && candidate.labels.every((entry) => typeof entry === "string") &&
    isNonNegativeInteger(candidate.directDependencyCount) &&
    isNonNegativeInteger(candidate.returnedDependencyCount) &&
    typeof candidate.dependenciesTruncated === "boolean" &&
    Array.isArray(candidate.directDependencies) &&
    candidate.directDependencies.length === candidate.returnedDependencyCount &&
    candidate.directDependencies.every(isAssetDependencyPayload)
  );
}

function isAssetDependencyPayload(value: unknown): value is AssetDependencyPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.guid === "string" &&
    typeof candidate.path === "string" && candidate.path.length > 0 &&
    typeof candidate.mainTypeName === "string"
  );
}

function isPrefabInspectPayload(value: unknown): value is PrefabInspectPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.guid === "string" && candidate.guid.length > 0 &&
    typeof candidate.path === "string" && candidate.path.length > 0 &&
    typeof candidate.dependencyHash === "string" && candidate.dependencyHash.length > 0 &&
    typeof candidate.prefabAssetType === "string" && candidate.prefabAssetType.length > 0 &&
    typeof candidate.rootName === "string" &&
    isNonNegativeInteger(candidate.totalNodeCount) &&
    isNonNegativeInteger(candidate.returnedNodeCount) &&
    isNonNegativeInteger(candidate.maxDepth) &&
    isPositiveInteger(candidate.maxNodes) &&
    typeof candidate.truncatedByDepth === "boolean" &&
    typeof candidate.truncatedByNodes === "boolean" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.length === candidate.returnedNodeCount &&
    candidate.nodes.every(isPrefabNodePayload)
  );
}

function isPrefabNodePayload(value: unknown): value is PrefabNodePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.relativePath === "string" &&
    typeof candidate.name === "string" &&
    isNonNegativeInteger(candidate.depth) &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    isNonNegativeInteger(candidate.childCount) &&
    typeof candidate.activeSelf === "boolean" &&
    Array.isArray(candidate.componentTypeNames) &&
    candidate.componentTypeNames.every((entry) => typeof entry === "string")
  );
}

function isPrefabInstantiatePayload(value: unknown): value is PrefabInstantiatePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.prefabGuid === "string" && candidate.prefabGuid.length > 0 &&
    typeof candidate.prefabPath === "string" && candidate.prefabPath.length > 0 &&
    typeof candidate.expectedPrefabDependencyHash === "string" && candidate.expectedPrefabDependencyHash.length > 0 &&
    typeof candidate.globalObjectId === "string" && candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" && Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    typeof candidate.expectedStateEpoch === "string" && candidate.expectedStateEpoch.length > 0 &&
    isPositiveInteger(candidate.expectedStateRevision) &&
    typeof candidate.stateEpoch === "string" && candidate.stateEpoch.length > 0 &&
    isPositiveInteger(candidate.stateRevision)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
