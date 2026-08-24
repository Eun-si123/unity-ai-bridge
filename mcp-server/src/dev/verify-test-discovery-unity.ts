import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const overallTimeoutMs = 120_000;
const toolTimeoutMs = 45_000;
const pollIntervalMs = 250;
const editorAssembly = "EunSung.UnityAiBridge.Editor.Tests";
const playAssembly = "EunSung.UnityAiBridge.PlayMode.Tests";
const playVerifierFullName =
  "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode";

const client = new Client({
  name: "unity-ai-bridge-test-discovery-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of ["unity_get_status", "unity_list_tests"]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for test.list capability in stable Edit Mode...");
  const initialStatus = await waitForReadyStatus(overallTimeoutMs);

  console.log("[Unity AI Bridge] Discovering EditMode assemblies...");
  const editAssemblies = await listTests({
    testMode: "edit",
    nameContains: "UnityAiBridge",
    offset: 0,
    maxResults: 50,
  });
  requireScope(editAssemblies, "assemblies");
  const discoveredEditorAssembly = editAssemblies.assemblies.find(
    (item) => item.name === editorAssembly,
  );
  if (discoveredEditorAssembly === undefined) {
    throw new Error(`EditMode discovery did not include ${editorAssembly}: ${JSON.stringify(editAssemblies)}`);
  }
  if (discoveredEditorAssembly.testCaseCount < 105) {
    throw new Error(
      `Expected ${editorAssembly} discovery to expose at least the 105-test candidate suite: ${JSON.stringify(discoveredEditorAssembly)}`,
    );
  }

  console.log("[Unity AI Bridge] Discovering the new Test discovery contract tests by exact native full name...");
  const discoveryTests = await listTests({
    testMode: "edit",
    assemblyName: editorAssembly,
    nameContains: "TestDiscoveryControlTests",
    offset: 0,
    maxResults: 20,
  });
  requireScope(discoveryTests, "tests");
  if (discoveryTests.totalMatches !== 5 || discoveryTests.tests.length !== 5) {
    throw new Error(`Expected exactly five TestDiscoveryControlTests leaves: ${JSON.stringify(discoveryTests)}`);
  }
  if (!discoveryTests.tests.every((item) => item.selectableByBridge)) {
    throw new Error(`A verifier discovery test was not selectable by the exact-run contract: ${JSON.stringify(discoveryTests)}`);
  }
  if (!isStrictlySorted(discoveryTests.tests.map((item) => item.fullName))) {
    throw new Error(`Discovered test full names were not deterministic ordinal order: ${JSON.stringify(discoveryTests)}`);
  }

  console.log("[Unity AI Bridge] Verifying deterministic paging with one leaf per page...");
  const firstPage = await listTests({
    testMode: "edit",
    assemblyName: editorAssembly,
    offset: 0,
    maxResults: 1,
  });
  requireScope(firstPage, "tests");
  if (firstPage.returnedCount !== 1 || !firstPage.truncated || firstPage.nextOffset !== 1) {
    throw new Error(`Unexpected first discovery page metadata: ${JSON.stringify(firstPage)}`);
  }
  const secondPage = await listTests({
    testMode: "edit",
    assemblyName: editorAssembly,
    offset: firstPage.nextOffset,
    maxResults: 1,
  });
  requireScope(secondPage, "tests");
  if (secondPage.returnedCount !== 1 || secondPage.offset !== 1) {
    throw new Error(`Unexpected second discovery page metadata: ${JSON.stringify(secondPage)}`);
  }
  const firstName = firstPage.tests[0]?.fullName ?? "";
  const secondName = secondPage.tests[0]?.fullName ?? "";
  if (firstName.length === 0 || secondName.length === 0 || firstName === secondName || firstName.localeCompare(secondName) >= 0) {
    throw new Error(`Discovery paging overlapped or was not sorted. first=${firstName} second=${secondName}`);
  }

  console.log("[Unity AI Bridge] Verifying a page beyond the end never rewinds its cursor...");
  const pastEndOffset = 1_000_000;
  const pastEndPage = await listTests({
    testMode: "edit",
    assemblyName: editorAssembly,
    offset: pastEndOffset,
    maxResults: 1,
  });
  requireScope(pastEndPage, "tests");
  if (
    pastEndPage.returnedCount !== 0 ||
    pastEndPage.nextOffset !== pastEndOffset ||
    pastEndPage.truncated !== false ||
    pastEndPage.tests.length !== 0
  ) {
    throw new Error(`Past-end discovery cursor was not monotonic: ${JSON.stringify(pastEndPage)}`);
  }

  console.log("[Unity AI Bridge] Discovering PlayMode assembly and exact runnable verifier selector...");
  const playAssemblies = await listTests({
    testMode: "play",
    nameContains: "UnityAiBridge",
    offset: 0,
    maxResults: 50,
  });
  requireScope(playAssemblies, "assemblies");
  const discoveredPlayAssembly = playAssemblies.assemblies.find(
    (item) => item.name === playAssembly,
  );
  if (discoveredPlayAssembly === undefined || discoveredPlayAssembly.testCaseCount !== 1) {
    throw new Error(`Expected ${playAssembly} with exactly one verifier test: ${JSON.stringify(playAssemblies)}`);
  }

  const playTests = await listTests({
    testMode: "play",
    assemblyName: playAssembly,
    nameContains: "RunsOneFrameInsidePlayMode",
    offset: 0,
    maxResults: 20,
  });
  requireScope(playTests, "tests");
  if (
    playTests.totalMatches !== 1 ||
    playTests.tests.length !== 1 ||
    playTests.tests[0]?.fullName !== playVerifierFullName ||
    playTests.tests[0]?.selectableByBridge !== true
  ) {
    throw new Error(`PlayMode exact selector discovery mismatch: ${JSON.stringify(playTests)}`);
  }

  console.log("[Unity AI Bridge] Proving an unknown exact assembly fails closed...");
  const unknown = await callTool({
    name: "unity_list_tests",
    arguments: {
      testMode: "edit",
      assemblyName: "UnityAiBridge.Does.Not.Exist.Tests",
      offset: 0,
      maxResults: 20,
    },
  });
  if (!unknown.isError) {
    throw new Error("Unknown Test Framework assembly unexpectedly returned success.");
  }
  const unknownText = readToolText(unknown);
  if (!unknownText.includes("test_assembly_unavailable")) {
    throw new Error(`Unknown assembly did not expose test_assembly_unavailable: ${unknownText}`);
  }

  const finalStatus = await waitForReadyStatus(overallTimeoutMs);
  if (
    finalStatus.stateEpoch !== initialStatus.stateEpoch ||
    finalStatus.stateRevision !== initialStatus.stateRevision
  ) {
    throw new Error(
      `Read-only test discovery changed scene state token. before=${initialStatus.stateEpoch}/${initialStatus.stateRevision} after=${finalStatus.stateEpoch}/${finalStatus.stateRevision}`,
    );
  }

  console.log("[Unity AI Bridge] Test discovery MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: finalStatus.unityVersion,
    editAssembly: editorAssembly,
    editAssemblyTestCaseCount: discoveredEditorAssembly.testCaseCount,
    discoveryContractTestCount: discoveryTests.totalMatches,
    deterministicDiscoveryOrder: true,
    pagingVerified: true,
    pastEndCursorMonotonic: true,
    firstPageFullName: firstName,
    secondPageFullName: secondName,
    playAssembly,
    playAssemblyTestCaseCount: discoveredPlayAssembly.testCaseCount,
    exactPlayModeSelector: playTests.tests[0]?.fullName,
    exactPlayModeSelectorSelectable: playTests.tests[0]?.selectableByBridge,
    unknownAssemblyRejected: true,
    finalPlayModeState: finalStatus.playModeState,
    stateEpoch: finalStatus.stateEpoch,
    stateRevision: finalStatus.stateRevision,
    readOnlyStateTokenUnchanged: true,
    projectMutated: false,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Test discovery MCP verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForReadyStatus(timeout: number): Promise<StatusPayload> {
  const deadline = Date.now() + timeout;
  let last = "No status observation received.";
  while (Date.now() < deadline) {
    try {
      const status = await getStatus();
      last = `${status.playModeState}, compiling=${status.isCompiling}, capabilities=${status.capabilities.join(",")}`;
      if (
        status.playModeState === "edit" &&
        !status.isCompiling &&
        status.capabilities.includes("test.list")
      ) {
        return status;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for test.list in stable Edit Mode. Last observation: ${last}`);
}

async function getStatus(): Promise<StatusPayload> {
  const result = await callTool({ name: "unity_get_status", arguments: {} });
  if (result.isError) {
    throw new Error(`unity_get_status failed: ${readToolText(result)}`);
  }
  const record = requireRecord(result.structuredContent, "editor.status structuredContent");
  const capabilities = record.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.every((item) => typeof item === "string")) {
    throw new Error(`Expected capabilities string array: ${JSON.stringify(record)}`);
  }
  const playModeState = readString(record, "playModeState");
  if (playModeState !== "edit" && playModeState !== "entering_play" && playModeState !== "play" && playModeState !== "exiting_play") {
    throw new Error(`Unexpected playModeState '${playModeState}'.`);
  }
  return {
    unityVersion: readString(record, "unityVersion"),
    playModeState,
    isCompiling: readBoolean(record, "isCompiling"),
    capabilities: capabilities as string[],
    stateEpoch: readString(record, "stateEpoch"),
    stateRevision: readPositiveInteger(record, "stateRevision"),
  };
}

async function listTests(args: Record<string, unknown>): Promise<TestDiscoveryPayload> {
  const result = await callTool({ name: "unity_list_tests", arguments: args });
  if (result.isError) {
    throw new Error(`unity_list_tests failed: ${readToolText(result)}`);
  }
  return parseDiscovery(result.structuredContent);
}

async function callTool(params: { name: string; arguments: Record<string, unknown> }) {
  return client.callTool(params, {
    timeout: toolTimeoutMs,
    maxTotalTimeout: toolTimeoutMs,
  });
}

function parseDiscovery(value: unknown): TestDiscoveryPayload {
  const record = requireRecord(value, "test discovery structuredContent");
  const testMode = readString(record, "testMode");
  if (testMode !== "edit" && testMode !== "play") throw new Error(`Unexpected testMode ${testMode}`);
  const scope = readString(record, "scope");
  if (scope !== "assemblies" && scope !== "tests") throw new Error(`Unexpected scope ${scope}`);
  const assembliesRaw = record.assemblies;
  const testsRaw = record.tests;
  if (!Array.isArray(assembliesRaw) || !Array.isArray(testsRaw)) {
    throw new Error(`Expected assemblies/tests arrays: ${JSON.stringify(record)}`);
  }
  const assemblies = assembliesRaw.map((value) => {
    const item = requireRecord(value, "assembly discovery entry");
    return {
      name: readString(item, "name"),
      testCaseCount: readNonNegativeInteger(item, "testCaseCount"),
    };
  });
  const tests = testsRaw.map((value) => {
    const item = requireRecord(value, "test discovery entry");
    const categories = item.categories;
    if (!Array.isArray(categories) || !categories.every((category) => typeof category === "string")) {
      throw new Error(`Expected categories string array: ${JSON.stringify(item)}`);
    }
    return {
      name: readString(item, "name", true),
      fullName: readString(item, "fullName"),
      uniqueName: readString(item, "uniqueName", true),
      parentFullName: readString(item, "parentFullName", true),
      runState: readString(item, "runState"),
      categories: categories as string[],
      selectableByBridge: readBoolean(item, "selectableByBridge"),
    };
  });
  const payload: TestDiscoveryPayload = {
    testMode,
    scope,
    assemblyName: readString(record, "assemblyName", true),
    nameContains: readString(record, "nameContains", true),
    totalMatches: readNonNegativeInteger(record, "totalMatches"),
    offset: readNonNegativeInteger(record, "offset"),
    maxResults: readPositiveInteger(record, "maxResults"),
    returnedCount: readNonNegativeInteger(record, "returnedCount"),
    nextOffset: readNonNegativeInteger(record, "nextOffset"),
    truncated: readBoolean(record, "truncated"),
    assemblies,
    tests,
  };
  if (payload.nextOffset !== payload.offset + payload.returnedCount) {
    throw new Error(`Discovery nextOffset invariant failed: ${JSON.stringify(payload)}`);
  }
  if (payload.truncated !== (payload.nextOffset < payload.totalMatches)) {
    throw new Error(`Discovery truncated invariant failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function requireScope(
  payload: TestDiscoveryPayload,
  expected: "assemblies" | "tests",
): void {
  if (payload.scope !== expected) {
    throw new Error(`Expected discovery scope=${expected}: ${JSON.stringify(payload)}`);
  }
}

function isStrictlySorted(values: string[]): boolean {
  for (let index = 1; index < values.length; index++) {
    if ((values[index - 1] ?? "").localeCompare(values[index] ?? "") >= 0) return false;
  }
  return true;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`Expected ${key} to be ${allowEmpty ? "a string" : "a non-empty string"}: ${JSON.stringify(record)}`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${key} to be boolean: ${JSON.stringify(record)}`);
  }
  return value;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`Expected ${key} positive safe integer: ${JSON.stringify(record)}`);
  }
  return value as number;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Expected ${key} non-negative safe integer: ${JSON.stringify(record)}`);
  }
  return value as number;
}

function readToolText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const record = item as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StatusPayload {
  unityVersion: string;
  playModeState: "edit" | "entering_play" | "play" | "exiting_play";
  isCompiling: boolean;
  capabilities: string[];
  stateEpoch: string;
  stateRevision: number;
}

interface TestDiscoveryPayload {
  testMode: "edit" | "play";
  scope: "assemblies" | "tests";
  assemblyName: string;
  nameContains: string;
  totalMatches: number;
  offset: number;
  maxResults: number;
  returnedCount: number;
  nextOffset: number;
  truncated: boolean;
  assemblies: Array<{ name: string; testCaseCount: number }>;
  tests: Array<{
    name: string;
    fullName: string;
    uniqueName: string;
    parentFullName: string;
    runState: string;
    categories: string[];
    selectableByBridge: boolean;
  }>;
}
