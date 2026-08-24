import { randomUUID } from "node:crypto";

import {
  PrefabPropertyBridgeServer,
  type TestRunIssuePayload,
  type TestRunPayload,
  type TestRunStartOptions,
  type TestRunStatus,
} from "./prefab-property-bridge-server.js";

const MAX_TEST_ASSEMBLY_NAME_LENGTH = 256;
const MAX_TEST_NAME_LENGTH = 512;
const MAX_TEST_NAMES = 64;
const MAX_TEST_ISSUES = 100;
const MAX_TEST_DETAIL_LENGTH = 8_000;
const MAX_MUTATION_ID_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DELIVERY_TIMEOUT_MS = 5_000;
const RECONNECT_POLL_MS = 200;

export type AnyTestRunPayload = Omit<TestRunPayload, "testMode"> & {
  testMode: "edit" | "play";
};

interface EditorIdentity {
  editorId: string;
  connectionGeneration: number;
}

class TestRunnerBridgeAccess extends PrefabPropertyBridgeServer {
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
    risk: "read" | "write",
  ): Promise<unknown> {
    return this.requestOperation(operation, args, route, timeoutMs, risk);
  }

  public async waitForEditorAccess(timeoutMs: number): Promise<EditorIdentity> {
    const hello = await this.waitForEditor(timeoutMs);
    return {
      editorId: hello.editorId,
      connectionGeneration: hello.connectionGeneration,
    };
  }
}

export async function requestStartPlayModeTests(
  bridge: PrefabPropertyBridgeServer,
  options: TestRunStartOptions,
  timeoutMs = 180_000,
): Promise<AnyTestRunPayload> {
  const initialEditor = connectedEditor(bridge);
  if (initialEditor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }

  validateTestAssemblyName(options.assemblyName);
  const testNames = normalizeTestNames(options.testNames);
  const mutationId = options.mutationId ?? randomUUID();
  validateMutationId(mutationId);
  const deadlineUnixMs = Date.now() + timeoutMs;
  const args = { assemblyName: options.assemblyName, testNames, mutationId };

  try {
    return await deliverPlayModeStart(
      bridge,
      args,
      Math.min(DELIVERY_TIMEOUT_MS, Math.max(1, remainingMs(deadlineUnixMs))),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAmbiguousDeliveryError(message)) {
      throw new Error(`${message} mutationId=${mutationId}`);
    }

    await waitForSameEditor(bridge, initialEditor.editorId, deadlineUnixMs);
    const remaining = remainingMs(deadlineUnixMs);
    if (remaining <= 0) {
      throw new Error(
        `test.run.playMode.start became ambiguous and the same Editor did not become available for reconciliation before timeout. mutationId=${mutationId}`,
      );
    }

    return await deliverPlayModeStart(
      bridge,
      args,
      Math.min(DELIVERY_TIMEOUT_MS, remaining),
    );
  }
}

export async function requestTestRunAnyMode(
  bridge: PrefabPropertyBridgeServer,
  mutationId: string,
  timeoutMs = 5_000,
): Promise<AnyTestRunPayload> {
  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }
  validateMutationId(mutationId);

  const result = await requestOperation(
    bridge,
    "test.run.get",
    { mutationId },
    editor,
    timeoutMs,
    "read",
  );
  if (!isAnyTestRunPayload(result)) {
    throw new Error("Unity returned an invalid test.run.get payload.");
  }
  return result;
}

async function deliverPlayModeStart(
  bridge: PrefabPropertyBridgeServer,
  args: { assemblyName: string; testNames: string[]; mutationId: string },
  timeoutMs: number,
): Promise<AnyTestRunPayload> {
  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }

  const result = await requestOperation(
    bridge,
    "test.run.playMode.start",
    args,
    editor,
    timeoutMs,
    "write",
  );
  if (!isAnyTestRunPayload(result) || result.testMode !== "play") {
    throw new Error("Unity returned an invalid test.run.playMode.start payload.");
  }
  return result;
}

async function waitForSameEditor(
  bridge: PrefabPropertyBridgeServer,
  editorId: string,
  deadlineUnixMs: number,
): Promise<void> {
  while (remainingMs(deadlineUnixMs) > 0) {
    const current = connectedEditor(bridge);
    if (current !== undefined) {
      if (current.editorId !== editorId) {
        throw new Error(
          `A different Unity Editor connected during PlayMode test-run reconciliation. expectedEditorId=${editorId} observedEditorId=${current.editorId}`,
        );
      }
      return;
    }

    try {
      const hello = await waitForEditor(
        bridge,
        Math.min(2_000, Math.max(1, remainingMs(deadlineUnixMs))),
      );
      if (hello.editorId !== editorId) {
        throw new Error(
          `A different Unity Editor connected during PlayMode test-run reconciliation. expectedEditorId=${editorId} observedEditorId=${hello.editorId}`,
        );
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("different Unity Editor")) throw error;
    }

    await delay(Math.min(RECONNECT_POLL_MS, Math.max(1, remainingMs(deadlineUnixMs))));
  }
}

function access(bridge: PrefabPropertyBridgeServer): TestRunnerBridgeAccess {
  return bridge as unknown as TestRunnerBridgeAccess;
}

function connectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity | undefined {
  return TestRunnerBridgeAccess.prototype.connectedEditorAccess.call(access(bridge));
}

function requestOperation(
  bridge: PrefabPropertyBridgeServer,
  operation: string,
  args: Record<string, unknown>,
  route: EditorIdentity,
  timeoutMs: number,
  risk: "read" | "write",
): Promise<unknown> {
  return TestRunnerBridgeAccess.prototype.requestOperationAccess.call(
    access(bridge),
    operation,
    args,
    route,
    timeoutMs,
    risk,
  );
}

function waitForEditor(
  bridge: PrefabPropertyBridgeServer,
  timeoutMs: number,
): Promise<EditorIdentity> {
  return TestRunnerBridgeAccess.prototype.waitForEditorAccess.call(access(bridge), timeoutMs);
}

function isAnyTestRunPayload(value: unknown): value is AnyTestRunPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.runGuid === "string" && candidate.runGuid.length > 0 &&
    isTestRunStatus(candidate.status) &&
    (candidate.testMode === "edit" || candidate.testMode === "play") &&
    typeof candidate.assemblyName === "string" && candidate.assemblyName.length > 0 &&
    Array.isArray(candidate.testNames) &&
    candidate.testNames.every((name) => typeof name === "string" && name.length > 0) &&
    isNonNegativeInteger(candidate.requestedUnixMs) &&
    isNonNegativeInteger(candidate.startedUnixMs) &&
    isNonNegativeInteger(candidate.finishedUnixMs) &&
    isNonNegativeInteger(candidate.selectedTestCaseCount) &&
    typeof candidate.resultState === "string" &&
    typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds) && candidate.durationSeconds >= 0 &&
    isNonNegativeInteger(candidate.passCount) &&
    isNonNegativeInteger(candidate.failCount) &&
    isNonNegativeInteger(candidate.skipCount) &&
    isNonNegativeInteger(candidate.inconclusiveCount) &&
    isNonNegativeInteger(candidate.assertCount) &&
    Array.isArray(candidate.issues) && candidate.issues.length <= MAX_TEST_ISSUES &&
    candidate.issues.every(isTestRunIssuePayload) &&
    typeof candidate.issuesTruncated === "boolean" &&
    typeof candidate.errorMessage === "string"
  );
}

function isTestRunIssuePayload(value: unknown): value is TestRunIssuePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fullName === "string" && candidate.fullName.length > 0 &&
    typeof candidate.resultState === "string" && candidate.resultState.length > 0 &&
    typeof candidate.durationSeconds === "number" && Number.isFinite(candidate.durationSeconds) && candidate.durationSeconds >= 0 &&
    typeof candidate.message === "string" && candidate.message.length <= MAX_TEST_DETAIL_LENGTH &&
    typeof candidate.stackTrace === "string" && candidate.stackTrace.length <= MAX_TEST_DETAIL_LENGTH &&
    typeof candidate.output === "string" && candidate.output.length <= MAX_TEST_DETAIL_LENGTH
  );
}

function isTestRunStatus(value: unknown): value is TestRunStatus {
  return value === "scheduled" || value === "running" || value === "completed" || value === "error";
}

function validateTestAssemblyName(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("assemblyName is required.");
  }
  if (value.length > MAX_TEST_ASSEMBLY_NAME_LENGTH) {
    throw new Error(`assemblyName must be at most ${MAX_TEST_ASSEMBLY_NAME_LENGTH} characters.`);
  }
  if (value.toLowerCase().endsWith(".dll")) {
    throw new Error("assemblyName must not include the .dll extension.");
  }
}

function normalizeTestNames(values: string[] | undefined): string[] {
  if (values === undefined || values.length === 0) return [];
  if (!Array.isArray(values) || values.length > MAX_TEST_NAMES) {
    throw new Error(`testNames must contain at most ${MAX_TEST_NAMES} exact test names.`);
  }
  const normalized = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("testNames may not contain empty values.");
    }
    if (value.length > MAX_TEST_NAME_LENGTH) {
      throw new Error(`Each test name must be at most ${MAX_TEST_NAME_LENGTH} characters.`);
    }
    normalized.add(value);
  }
  return [...normalized].sort();
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

function isAmbiguousDeliveryError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("timed out") ||
    normalized.includes("disconnected before the request completed") ||
    normalized.includes("no unity editor is connected") ||
    normalized.includes("no unity editor connected within");
}

function remainingMs(deadlineUnixMs: number): number {
  return Math.max(0, deadlineUnixMs - Date.now());
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
