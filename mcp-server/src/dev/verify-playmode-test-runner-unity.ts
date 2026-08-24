import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const overallTimeoutMs = 180_000;
const longToolTimeoutMs = 180_000;
const shortToolTimeoutMs = 15_000;
const pollIntervalMs = 300;
const assemblyName = "EunSung.UnityAiBridge.PlayMode.Tests";
const exactTestName =
  "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode";

const client = new Client({
  name: "unity-ai-bridge-playmode-test-runner-verifier",
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
    "unity_start_playmode_tests",
    "unity_get_test_run",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for PlayMode Test Runner capabilities in stable Edit Mode...");
  const initial = await waitForReadyStatus(overallTimeoutMs);
  const settingsBefore = {
    enterPlayModeOptionsEnabled: initial.enterPlayModeOptionsEnabled,
    disableDomainReload: initial.disableDomainReload,
    disableSceneReload: initial.disableSceneReload,
  };

  const mutationId = `verify-playmode-tests-${Date.now()}`;
  console.log(`[Unity AI Bridge] Scheduling exact PlayMode test: ${exactTestName}`);
  const started = await startRunEventually(mutationId, [exactTestName], overallTimeoutMs);
  if (started.runGuid.length === 0) {
    throw new Error("Initial PlayMode Test Runner start returned an empty Unity runGuid.");
  }
  if (started.testMode !== "play") {
    throw new Error(`Expected testMode=play: ${JSON.stringify(started)}`);
  }
  const runGuid = started.runGuid;

  console.log("[Unity AI Bridge] Replaying the same mutationId through possible PlayMode reload; no second run may be scheduled...");
  const immediateReplay = await startRunEventually(mutationId, [exactTestName], overallTimeoutMs);
  if (!immediateReplay.replayed) {
    throw new Error(`Same-id PlayMode start did not report replayed=true: ${JSON.stringify(immediateReplay)}`);
  }
  if (immediateReplay.runGuid !== runGuid) {
    throw new Error(
      `Same-id PlayMode replay changed Unity runGuid. expected=${runGuid} observed=${immediateReplay.runGuid}`,
    );
  }

  console.log("[Unity AI Bridge] Polling through PlayMode/domain-reload transitions for the asynchronous result...");
  const terminal = await waitForTerminalRun(mutationId, runGuid, overallTimeoutMs);
  if (terminal.status !== "completed") {
    throw new Error(`PlayMode test run ended in non-completed status: ${JSON.stringify(terminal, null, 2)}`);
  }
  if (terminal.testMode !== "play" || terminal.resultState !== "Passed") {
    throw new Error(`Expected a passed PlayMode root result: ${JSON.stringify(terminal, null, 2)}`);
  }
  if (
    terminal.selectedTestCaseCount !== 1 ||
    terminal.passCount !== 1 ||
    terminal.failCount !== 0 ||
    terminal.skipCount !== 0 ||
    terminal.inconclusiveCount !== 0 ||
    terminal.issues.length !== 0
  ) {
    throw new Error(`Expected exactly one clean passing PlayMode test: ${JSON.stringify(terminal, null, 2)}`);
  }

  console.log("[Unity AI Bridge] Waiting for Unity Test Framework to restore stable Edit Mode...");
  const finalStatus = await waitForReadyStatus(overallTimeoutMs);
  if (
    finalStatus.enterPlayModeOptionsEnabled !== settingsBefore.enterPlayModeOptionsEnabled ||
    finalStatus.disableDomainReload !== settingsBefore.disableDomainReload ||
    finalStatus.disableSceneReload !== settingsBefore.disableSceneReload
  ) {
    throw new Error("PlayMode Test Runner verification changed the user's Enter Play Mode settings.");
  }

  console.log("[Unity AI Bridge] Replaying the completed mutationId; terminal result must stay readback-only...");
  const completedReplay = await startRunEventually(mutationId, [exactTestName], overallTimeoutMs);
  if (!completedReplay.replayed || completedReplay.runGuid !== runGuid) {
    throw new Error(`Completed same-id PlayMode replay did not preserve the original run: ${JSON.stringify(completedReplay)}`);
  }
  const afterCompletedReplay = await getRunEventually(mutationId, overallTimeoutMs);
  if (
    afterCompletedReplay.runGuid !== runGuid ||
    afterCompletedReplay.status !== "completed" ||
    afterCompletedReplay.testMode !== "play" ||
    afterCompletedReplay.passCount !== 1 ||
    afterCompletedReplay.failCount !== 0
  ) {
    throw new Error(`Completed PlayMode replay changed terminal run state: ${JSON.stringify(afterCompletedReplay)}`);
  }

  console.log("[Unity AI Bridge] Proving same mutationId with a different PlayMode selection is rejected...");
  const conflict = await callToolWithTimeout(
    {
      name: "unity_start_playmode_tests",
      arguments: {
        assemblyName,
        testNames: ["UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.DifferentSelection"],
        mutationId,
      },
    },
    shortToolTimeoutMs,
  );
  if (!conflict.isError) {
    throw new Error("Same mutationId with a different PlayMode test selection unexpectedly succeeded.");
  }
  const conflictText = readToolText(conflict);
  if (!conflictText.includes("mutation_id_conflict")) {
    throw new Error(`PlayMode mutation conflict did not expose mutation_id_conflict: ${conflictText}`);
  }

  console.log("[Unity AI Bridge] PlayMode Test Runner MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: finalStatus.unityVersion,
    assemblyName,
    exactTestName,
    mutationId,
    runGuid,
    initialStatus: started.status,
    initialDeliveryReconciled: started.replayed,
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
    enterPlayModeOptionsEnabled: finalStatus.enterPlayModeOptionsEnabled,
    disableDomainReload: finalStatus.disableDomainReload,
    disableSceneReload: finalStatus.disableSceneReload,
    userEnterPlayModeSettingsPreserved: true,
    exactFinalEditStateRestored: true,
    verifierTestProvedApplicationIsPlayingAcrossFrame: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] PlayMode Test Runner MCP verification FAILED:\n${message}`);
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
        status.capabilities.includes("test.run.playMode.start") &&
        status.capabilities.includes("test.run.get")
      ) {
        return status;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for PlayMode Test Runner capabilities in stable Edit Mode. Last observation: ${last}`);
}

async function startRunEventually(
  mutationId: string,
  testNames: string[],
  timeout: number,
): Promise<TestRunPayload> {
  const deadline = Date.now() + timeout;
  let last = "No start result received.";

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    try {
      const result = await callToolWithTimeout(
        {
          name: "unity_start_playmode_tests",
          arguments: { assemblyName, testNames, mutationId },
        },
        Math.min(longToolTimeoutMs, remaining),
      );
      if (!result.isError) return parseTestRun(result.structuredContent);
      last = readToolText(result);
      if (!isTransientLifecycleMessage(last)) {
        throw new Error(`unity_start_playmode_tests failed: ${last}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      last = message;
      if (!isTransientLifecycleMessage(message)) throw error;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out starting/reconciling PlayMode tests. Last observation: ${last}`);
}

async function getRunEventually(mutationId: string, timeout: number): Promise<TestRunPayload> {
  const deadline = Date.now() + timeout;
  let last = "No test-run result received.";

  while (Date.now() < deadline) {
    try {
      const result = await callToolWithTimeout(
        {
          name: "unity_get_test_run",
          arguments: { mutationId },
        },
        shortToolTimeoutMs,
      );
      if (!result.isError) return parseTestRun(result.structuredContent);
      last = readToolText(result);
      if (!isTransientLifecycleMessage(last)) {
        throw new Error(`unity_get_test_run failed: ${last}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      last = message;
      if (!isTransientLifecycleMessage(message)) throw error;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out reading PlayMode test run. Last observation: ${last}`);
}

async function waitForTerminalRun(
  mutationId: string,
  expectedRunGuid: string,
  timeout: number,
): Promise<TestRunPayload> {
  const deadline = Date.now() + timeout;
  let last: TestRunPayload | undefined;

  while (Date.now() < deadline) {
    const current = await getRunEventually(
      mutationId,
      Math.min(15_000, Math.max(1, deadline - Date.now())),
    );
    last = current;
    if (current.runGuid !== expectedRunGuid) {
      throw new Error(
        `PlayMode test run GUID changed while polling. expected=${expectedRunGuid} observed=${current.runGuid}`,
      );
    }
    if (current.status === "completed" || current.status === "error") {
      return current;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for PlayMode Unity Test Framework completion. Last observation: ${JSON.stringify(last)}`,
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
    enterPlayModeOptionsEnabled: readBoolean(record, "enterPlayModeOptionsEnabled"),
    disableDomainReload: readBoolean(record, "disableDomainReload"),
    disableSceneReload: readBoolean(record, "disableSceneReload"),
  };
}

function parseTestRun(value: unknown): TestRunPayload {
  const record = requireRecord(value, "test run structuredContent");
  const status = readString(record, "status");
  if (!isTestRunStatus(status)) {
    throw new Error(`Unexpected Test Runner status '${status}'.`);
  }
  const testMode = readString(record, "testMode");
  if (testMode !== "edit" && testMode !== "play") {
    throw new Error(`Unexpected testMode '${testMode}'.`);
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
    testMode,
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

function isTransientLifecycleMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("no unity editor") ||
    normalized.includes("disconnected") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("connection");
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
  enterPlayModeOptionsEnabled: boolean;
  disableDomainReload: boolean;
  disableSceneReload: boolean;
}

interface TestRunPayload {
  mutationId: string;
  replayed: boolean;
  runGuid: string;
  status: TestRunStatus;
  testMode: "edit" | "play";
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
