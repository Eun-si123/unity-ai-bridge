import { PrefabPropertyBridgeServer } from "./prefab-property-bridge-server.js";

const MAX_ASSEMBLY_NAME_LENGTH = 256;
const MAX_NAME_CONTAINS_LENGTH = 256;
const MAX_RESULTS = 200;
const MAX_INFORMATIONAL_TEXT_LENGTH = 1_024;
const MAX_CATEGORY_LENGTH = 256;
const MAX_CATEGORIES = 32;
const MAX_EXACT_TEST_NAME_LENGTH = 512;

export type DiscoveryTestMode = "edit" | "play";
export type TestDiscoveryScope = "assemblies" | "tests";

export interface TestDiscoveryOptions {
  testMode: DiscoveryTestMode;
  assemblyName?: string;
  nameContains?: string;
  offset?: number;
  maxResults?: number;
}

export interface TestAssemblyDiscoveryPayload {
  name: string;
  testCaseCount: number;
}

export interface TestCaseDiscoveryPayload {
  name: string;
  fullName: string;
  uniqueName: string;
  parentFullName: string;
  runState: string;
  categories: string[];
  selectableByBridge: boolean;
}

export interface TestDiscoveryPayload {
  testMode: DiscoveryTestMode;
  scope: TestDiscoveryScope;
  assemblyName: string;
  nameContains: string;
  totalMatches: number;
  offset: number;
  maxResults: number;
  returnedCount: number;
  nextOffset: number;
  truncated: boolean;
  assemblies: TestAssemblyDiscoveryPayload[];
  tests: TestCaseDiscoveryPayload[];
}

interface EditorIdentity {
  editorId: string;
  connectionGeneration: number;
}

class TestDiscoveryBridgeAccess extends PrefabPropertyBridgeServer {
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
    risk: "read",
  ): Promise<unknown> {
    return this.requestOperation(operation, args, route, timeoutMs, risk);
  }
}

export async function requestListTests(
  bridge: PrefabPropertyBridgeServer,
  options: TestDiscoveryOptions,
  timeoutMs = 30_000,
): Promise<TestDiscoveryPayload> {
  validateMode(options.testMode);
  const assemblyName = normalizeOptional(
    options.assemblyName,
    MAX_ASSEMBLY_NAME_LENGTH,
    "assemblyName",
    true,
  );
  const nameContains = normalizeOptional(
    options.nameContains,
    MAX_NAME_CONTAINS_LENGTH,
    "nameContains",
    false,
  );
  const offset = options.offset ?? 0;
  const maxResults = options.maxResults ?? 100;
  validateOffset(offset);
  validateMaxResults(maxResults);

  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }

  const result = await requestOperation(
    bridge,
    "test.list",
    {
      testMode: options.testMode,
      assemblyName,
      nameContains,
      offset,
      maxResults,
    },
    editor,
    timeoutMs,
    "read",
  );

  if (!isTestDiscoveryPayload(result)) {
    throw new Error("Unity returned an invalid test.list payload.");
  }
  return result;
}

function access(bridge: PrefabPropertyBridgeServer): TestDiscoveryBridgeAccess {
  return bridge as unknown as TestDiscoveryBridgeAccess;
}

function connectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity | undefined {
  return TestDiscoveryBridgeAccess.prototype.connectedEditorAccess.call(access(bridge));
}

function requestOperation(
  bridge: PrefabPropertyBridgeServer,
  operation: string,
  args: Record<string, unknown>,
  route: EditorIdentity,
  timeoutMs: number,
  risk: "read",
): Promise<unknown> {
  return TestDiscoveryBridgeAccess.prototype.requestOperationAccess.call(
    access(bridge),
    operation,
    args,
    route,
    timeoutMs,
    risk,
  );
}

function isTestDiscoveryPayload(value: unknown): value is TestDiscoveryPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.testMode !== "edit" && candidate.testMode !== "play") ||
    (candidate.scope !== "assemblies" && candidate.scope !== "tests") ||
    typeof candidate.assemblyName !== "string" ||
    typeof candidate.nameContains !== "string" ||
    !isNonNegativeInteger(candidate.totalMatches) ||
    !isNonNegativeInteger(candidate.offset) ||
    !isPositiveInteger(candidate.maxResults) || candidate.maxResults > MAX_RESULTS ||
    !isNonNegativeInteger(candidate.returnedCount) ||
    !isNonNegativeInteger(candidate.nextOffset) ||
    typeof candidate.truncated !== "boolean" ||
    !Array.isArray(candidate.assemblies) ||
    !Array.isArray(candidate.tests)
  ) {
    return false;
  }

  if (candidate.returnedCount > candidate.maxResults) return false;
  const expectedNextOffset = Math.min(
    candidate.totalMatches,
    candidate.offset + candidate.returnedCount,
  );
  if (candidate.nextOffset !== expectedNextOffset) return false;
  if (candidate.truncated !== (candidate.nextOffset < candidate.totalMatches)) return false;

  if (candidate.scope === "assemblies") {
    if (candidate.assemblyName !== "" || candidate.tests.length !== 0) return false;
    if (candidate.assemblies.length !== candidate.returnedCount) return false;
    return candidate.assemblies.every(isAssemblyPayload);
  }

  if (candidate.assemblyName.length === 0 || candidate.assemblies.length !== 0) return false;
  if (candidate.tests.length !== candidate.returnedCount) return false;
  return candidate.tests.every(isTestPayload);
}

function isAssemblyPayload(value: unknown): value is TestAssemblyDiscoveryPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    candidate.name.length <= MAX_ASSEMBLY_NAME_LENGTH &&
    isNonNegativeInteger(candidate.testCaseCount);
}

function isTestPayload(value: unknown): value is TestCaseDiscoveryPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string" &&
    candidate.name.length <= MAX_INFORMATIONAL_TEXT_LENGTH &&
    typeof candidate.fullName === "string" && candidate.fullName.length > 0 &&
    typeof candidate.uniqueName === "string" && candidate.uniqueName.length <= MAX_INFORMATIONAL_TEXT_LENGTH &&
    typeof candidate.parentFullName === "string" && candidate.parentFullName.length <= MAX_INFORMATIONAL_TEXT_LENGTH &&
    typeof candidate.runState === "string" && candidate.runState.length > 0 &&
    Array.isArray(candidate.categories) && candidate.categories.length <= MAX_CATEGORIES &&
    candidate.categories.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= MAX_CATEGORY_LENGTH,
    ) &&
    typeof candidate.selectableByBridge === "boolean" &&
    candidate.selectableByBridge === (candidate.fullName.length <= MAX_EXACT_TEST_NAME_LENGTH);
}

function validateMode(value: string): asserts value is DiscoveryTestMode {
  if (value !== "edit" && value !== "play") {
    throw new Error("testMode must be exactly 'edit' or 'play'.");
  }
}

function normalizeOptional(
  value: string | undefined,
  maximumLength: number,
  name: string,
  rejectDllSuffix: boolean,
): string {
  if (value === undefined || value.length === 0) return "";
  if (value.trim().length === 0) {
    throw new Error(`${name} may not be whitespace-only.`);
  }
  if (value.length > maximumLength) {
    throw new Error(`${name} must be at most ${maximumLength} characters.`);
  }
  if (rejectDllSuffix && value.toLowerCase().endsWith(".dll")) {
    throw new Error("assemblyName must not include the .dll extension.");
  }
  return value;
}

function validateOffset(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error("offset must be an integer between 0 and 2147483647.");
  }
}

function validateMaxResults(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`maxResults must be an integer between 1 and ${MAX_RESULTS}.`);
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
