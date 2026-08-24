import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const overallTimeoutMs = 180_000;
const shortToolTimeoutMs = 15_000;
const pollIntervalMs = 250;
const assemblyName = "EunSung.UnityAiBridge.Editor.Tests";
const exactTestName =
  "UnityAiBridge.Tests.Editor.TestRunnerControlTests.Get_RejectsMalformedOrUnknownMutationIdsWithoutStartingTests";

const client = new Client({
  name: "unity-ai-bridge-test-runner-verifier",
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
  for (const required of [
    "unity_get_status",
    "unity_start_editmode_tests",
    "unity_get_test_run",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Test Runner capabilities in stable Edit Mode...");
  const status = await waitForReadyStatus(overallTimeoutMs);

  const mutationId = `verify-test-runner-${Date.now()}`;
  console.log(`[Unity AI Bridge] Scheduling exact EditMode test: ${exactTestName}`);
  const started = await startRun(mutationId, [exactTestName]);
  if (started.replayed) {
    throw new Error(`Initial start unexpectedly reported replayed=true: ${JSON.stringify(started)}`);
  }
  if (started.runGuid.length === 0) {
    throw new Error("Initial Test Runner start returned an empty Unity runGuid.");
  }
  const runGuid = started.runGuid;

  console.log("[Unity AI Bridge] Replaying the same mutationId; no second Unity test run may be scheduled...");
  const immediateReplay = await startRun(mutationId, [exactTestName]);
  if (!immediateReplay.replayed) {
    throw new Error(`Same-id start did not report replayed=true: ${JSON.stringify(immediateReplay)}`);
  }
  if (immediateReplay.runGuid !== runGuid) {
    throw new Error(
      `Same-id replay changed Unity runGuid. expected=${runGuid} observed=${immediateReplay.runGuid}`,
    );
  }

  console.log("[Unity AI Bridge] Polling the asynchronous Unity Test Framework result...");
  const terminal = await waitForTerminalRun(mutationId, runGuid, overallTimeoutMs);
  if (terminal.status !== "completed") {
    throw new Error(`Test run ended in non-completed status: ${JSON.stringify(terminal, null, 2)}`);
  }
  if (terminal.resultState !== "Passed") {
    throw new Error(`Expected root resultState=Passed: ${JSON.stringify(terminal, null, 2)}`);
  }
  if (terminal.passCount !== 1 || terminal.failCount !== 0) {
    throw new Error(`Expected exactly one passing selected test: ${JSON.stringify(terminal, null, 2)}`);
  }
  if (terminal.skipCount !== 0 || terminal.inconclusiveCount !== 0 || terminal.issues.length !== 0) {
    throw new Error(`Selected verifier test was not a clean pass: ${JSON.stringify(terminal, null, 2)}`);
  }
  if (terminal.selectedTestCaseCount !== 1) {
    throw new Error(`Expected selectedTestCaseCount=1: ${JSON.stringify(terminal, null, 2)}`);
  }

  console.log("[Unity AI Bridge] Replaying the completed mutationId; terminal result must stay readback-only...");
  const completedReplay = await startRun(mutationId, [exactTestName]);
  if (!completedReplay.replayed || completedReplay.runGuid !== runGuid) {
    throw new Error(`Completed same-id replay did not preserve the original run: ${JSON.stringify(completedReplay)}`);
  }
  const afterCompletedReplay = await getRun(mutationId);
  if (
    afterCompletedReplay.runGuid !== runGuid ||
    afterCompletedReplay.status !== "completed" ||
    afterCompletedReplay.passCount !== 1 ||
    afterCompletedReplay.failCount !== 0
  ) {
    throw new Error(`Completed replay changed terminal run state: ${JSON.stringify(afterCompletedReplay)}`);
  }

  console.log("[Unity AI Bridge] Proving same mutationId with a different selection is rejected...");
  const conflict = await callToolWithTimeout(
    {
      name: "unity_start_editmode_tests",
      arguments: {
        assemblyName,
        testNames: [
          "UnityAiBridge.Tests.Editor.TestRunnerControlTests.IntentFingerprint_RejectsMissingOrDllAssemblyNames",
        ],
        mutationId,
      },
    },
    shortToolTimeoutMs,
  );
  if (!conflict.isError) {
    throw new Error("Same mutationId with a different test selection unexpectedly succeeded.");
  }
  const conflictText = readToolText(conflict);
  if (!conflictText.includes("mutation_id_conflict")) {
    throw new Error(`Mutation conflict did not expose mutation_id_conflict: ${conflictText}`);
  }

  const finalStatus = await waitForReadyStatus(overallTimeoutMs);
  console.log("[Unity AI Bridge] Test Runner MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: finalStatus.unityVersion,
    assemblyName,
    exactTestName,
    mutationId,
    runGuid,
    initialStatus: started.status,
    immediateReplayReadOnly: immediateReplay.replayed,
    terminalStatus: terminal.status,
    resultState: terminal.resultState,
    selectedTestCaseCount: terminal.selectedTestCaseCount,
    passCount: terminal.passCount,
    failCount: terminal.failCount,
    skipCount: terminal.skipCount,
    inconclusiveCount: terminal.inconclusiveCount,
    issueCount: terminal.issues.length,
    issuesTruncated: terminal.issuesTruncated,
    completedReplayReadOnly: completedReplay.replayed,
    runGuidStableAcrossReplays: true,
    conflictingSameIdSelectionRejected: true,
    finalPlayModeState: finalStatus.playModeState,
    projectMutationClaimedByBridge: false,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Test Runner MCP verification FAILED:\n${message}`);
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
        status.capabilities.includes("test.run.editMode.start") &&
        status.capabilities.includes("test.run.get")
      ) {
        return status;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for Test Runner capabilities in stable Edit Mode. Last observation: ${last}`);
}

async function startRun(mutationId: string, testNames: string[]): Promise<TestRunPayload> {
  const result = await callToolWithTimeout(
    {
      name: "unity_start_editmode_tests",
      arguments: { assemblyName, testNames, mutationId },
    },
    shortToolTimeoutMs,
  );
  if (result.isError) {
    throw new Error(`unity_start_editmode_tests failed: ${readToolText(result)}`);
  }
  return parseTestRun(result.structuredContent);
}

async function getRun(mutationId: string): Promise<TestRunPayload> {
  const result = await callToolWithTimeout(
    {
      name: "unity_get_test_run",
      arguments: { mutationId },
    },
    shortToolTimeoutMs,
  );
  if (result.isError) {
    throw new Error(`unity_get_test_run failed: ${readToolText(result)}`);
  }
  return parseTestRun(result.structuredContent);
}

async function waitForTerminalRun(
  mutationId: string,
  expectedRunGuid: string,
  timeout: number,
): Promise<TestRunPayload> {
  const deadline = Date.now() + timeout;
  let last: TestRunPayload | undefined;

  while (Date.now() < deadline) {
    const current = await getRun(mutationId);
    last = current;
    if (current.runGuid !== expectedRunGuid) {
      throw new Error(
        `Test run GUID changed while polling. expected=${expectedRunGuid} observed=${current.runGuid}`,
      );
    }
    if (current.status === "completed" || current.status === "error") {
      return current;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for Unity Test Framework completion. Last observation: ${JSON.stringify(last)}`,
  );
}

async function getStatus(): Promise<StatusPayload> {
  const result = await callToolWithTimeout(
    { name: "unity_get_status", arguments: {} },
    shortToolTimeoutMs,
  );
  if (result.isError) {
    throw new Error(`unity_get_status failed: ${readToolText(result)}`);
  }
  return parseStatus(result.structuredContent);
}

async function callToolWithTimeout(
  params: { name: string; arguments: Record<string, unknown> },
  timeout: number,
) {
  return client.callTool(params, {
    timeout,
    maxTotalTimeout: timeout,
  });
}

function parseStatus(value: unknown): StatusPayload {
  const record = requireRecord(value, "editor.status structuredContent");
  const capabilities = record.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.every((item) => typeof item === "string")) {
    throw new Error(`Expected capabilities string array: ${JSON.stringify(record)}`);
  }
  const playModeState = readString(record, "playModeState");
  if (!isPlayModeState(playModeState)) {
    throw new Error(`Unexpected playModeState '${playModeState}'.`);
  }
  return {
    unityVersion: readString(record, "unityVersion"),
    playModeState,
    isCompiling: readBoolean(record, "isCompiling"),
    capabilities: capabilities as string[],
  };
}

function parseTestRun(value: unknown): TestRunPayload {
  const record = requireRecord(value, "test run structuredContent");
  const status = readString(record, "status");
  if (!isTestRunStatus(status)) {
    throw new Error(`Unexpected Test Runner status '${status}'.`);
  }
  const testNames = record.testNames;
  if (!Array.isArray(testNames) || !testNames.every((item) => typeof item === "string")) {
    throw new Error(`Expected testNames string array: ${JSON.stringify(record)}`);
  }
  const issues = record.issues;
  if (!Array.isArray(issues)) {
    throw new Error(`Expected issues array: ${JSON.stringify(record)}`);
  }
  return {
    mutationId: readString(record, "mutationId"),
    replayed: readBoolean(record, "replayed"),
    runGuid: readString(record, "runGuid"),
    status,
    testMode: readString(record, "testMode"),
    assemblyName: readString(record, "assemblyName"),
    testNames: testNames as string[],
    selectedTestCaseCount: readNonNegativeInteger(record, "selectedTestCaseCount"),
    resultState: readString(record, "resultState", true),
    passCount: readNonNegativeInteger(record, "passCount"),
    failCount: readNonNegativeInteger(record, "failCount"),
    skipCount: readNonNegativeInteger(record, "skipCount"),
    inconclusiveCount: readNonNegativeInteger(record, "inconclusiveCount"),
    issues,
    issuesTruncated: readBoolean(record, "issuesTruncated"),
    errorMessage: readString(record, "errorMessage", true),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string {
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

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Expected ${key} to be a non-negative safe integer: ${JSON.stringify(record)}`);
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

function isPlayModeState(value: string): value is "edit" | "entering_play" | "play" | "exiting_play" {
  return value === "edit" || value === "entering_play" || value === "play" || value === "exiting_play";
}

function isTestRunStatus(value: string): value is TestRunStatus {
  return value === "scheduled" || value === "running" || value === "completed" || value === "error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TestRunStatus = "scheduled" | "running" | "completed" | "error";

interface StatusPayload {
  unityVersion: string;
  playModeState: "edit" | "entering_play" | "play" | "exiting_play";
  isCompiling: boolean;
  capabilities: string[];
}

interface TestRunPayload {
  mutationId: string;
  replayed: boolean;
  runGuid: string;
  status: TestRunStatus;
  testMode: string;
  assemblyName: string;
  testNames: string[];
  selectedTestCaseCount: number;
  resultState: string;
  passCount: number;
  failCount: number;
  skipCount: number;
  inconclusiveCount: number;
  issues: unknown[];
  issuesTruncated: boolean;
  errorMessage: string;
}
