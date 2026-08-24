import { randomUUID } from "node:crypto";

import { ScriptBridgeServer } from "./script-bridge-server.js";

export type StablePlayMode = "edit" | "play";
export type PlayModeState = StablePlayMode | "entering_play" | "exiting_play";
export type TestRunStatus = "scheduled" | "running" | "completed" | "error";

export interface PlayModeSetOptions {
  targetMode: StablePlayMode;
  expectedCurrentMode: StablePlayMode;
  mutationId?: string;
}

export interface PlayModeSnapshotPayload {
  mode: PlayModeState;
  isPlaying: boolean;
  isPaused: boolean;
  isPlayingOrWillChangePlaymode: boolean;
  enterPlayModeOptionsEnabled: boolean;
  disableDomainReload: boolean;
  disableSceneReload: boolean;
}

export interface PlayModeTransitionPayload {
  mutationId: string;
  replayed: boolean;
  reconciled: boolean;
  changed: boolean;
  transitionRequested: boolean;
  targetMode: StablePlayMode;
  expectedCurrentMode: StablePlayMode;
  requestedUnixMs: number;
  before: PlayModeSnapshotPayload;
  afterRequest: PlayModeSnapshotPayload;
}

export interface PlayModeSetPayload extends PlayModeTransitionPayload {
  finalMode: StablePlayMode;
  finalIsPlaying: boolean;
  finalIsPaused: boolean;
  finalIsPlayingOrWillChangePlaymode: boolean;
  enterPlayModeOptionsEnabled: boolean;
  disableDomainReload: boolean;
  disableSceneReload: boolean;
  reloadObserved: boolean;
  initialConnectionGeneration: number;
  finalConnectionGeneration: number;
}

export interface TestRunStartOptions {
  assemblyName: string;
  testNames?: string[];
  mutationId?: string;
}

export interface TestRunIssuePayload {
  fullName: string;
  resultState: string;
  durationSeconds: number;
  message: string;
  stackTrace: string;
  output: string;
}

export interface TestRunPayload {
  mutationId: string;
  replayed: boolean;
  runGuid: string;
  status: TestRunStatus;
  testMode: "edit";
  assemblyName: string;
  testNames: string[];
  requestedUnixMs: number;
  startedUnixMs: number;
  finishedUnixMs: number;
  selectedTestCaseCount: number;
  resultState: string;
  durationSeconds: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  inconclusiveCount: number;
  assertCount: number;
  issues: TestRunIssuePayload[];
  issuesTruncated: boolean;
  errorMessage: string;
}

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
const MAX_TEST_ASSEMBLY_NAME_LENGTH = 256;
const MAX_TEST_NAME_LENGTH = 512;
const MAX_TEST_NAMES = 64;
const MAX_TEST_ISSUES = 100;
const MAX_TEST_DETAIL_LENGTH = 8_000;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const PLAY_MODE_DELIVERY_TIMEOUT_MS = 5_000;
const PLAY_MODE_POLL_INTERVAL_MS = 200;

export class PrefabPropertyBridgeServer extends ScriptBridgeServer {
  public async requestSetPlayMode(
    options: PlayModeSetOptions,
    timeoutMs = 180_000,
  ): Promise<PlayModeSetPayload> {
    const initialEditor = this.connectedEditor;
    if (initialEditor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateStablePlayMode(options.targetMode, "targetMode");
    validateStablePlayMode(options.expectedCurrentMode, "expectedCurrentMode");
    const mutationId = options.mutationId ?? randomUUID();
    validateMutationId(mutationId);

    const args = {
      targetMode: options.targetMode,
      expectedCurrentMode: options.expectedCurrentMode,
      mutationId,
    };
    const deadlineUnixMs = Date.now() + timeoutMs;

    let transition: PlayModeTransitionPayload;
    try {
      transition = await this.deliverPlayModeTransition(
        args,
        Math.min(PLAY_MODE_DELIVERY_TIMEOUT_MS, Math.max(1, remainingMs(deadlineUnixMs))),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isAmbiguousPlayModeDeliveryError(message)) {
        throw new Error(`${message} mutationId=${mutationId}`);
      }

      await this.waitForSameEditorForPlayMode(initialEditor.editorId, deadlineUnixMs);
      const remaining = remainingMs(deadlineUnixMs);
      if (remaining <= 0) {
        throw new Error(
          `editor.playMode.set delivery became ambiguous and the same Editor did not become available for reconciliation before timeout. mutationId=${mutationId}`,
        );
      }

      transition = await this.deliverPlayModeTransition(
        args,
        Math.min(PLAY_MODE_DELIVERY_TIMEOUT_MS, remaining),
      );
    }

    const finalStatus = await this.waitForStablePlayMode(
      initialEditor.editorId,
      options.targetMode,
      deadlineUnixMs,
    );
    const finalEditor = this.connectedEditor;
    if (finalEditor === undefined || finalEditor.editorId !== initialEditor.editorId) {
      throw new Error(
        `The expected Unity Editor was not connected after the Play Mode transition. mutationId=${mutationId}`,
      );
    }

    return {
      ...transition,
      finalMode: options.targetMode,
      finalIsPlaying: finalStatus.isPlaying,
      finalIsPaused: finalStatus.isPaused,
      finalIsPlayingOrWillChangePlaymode: finalStatus.isPlayingOrWillChangePlaymode,
      enterPlayModeOptionsEnabled: finalStatus.enterPlayModeOptionsEnabled,
      disableDomainReload: finalStatus.disableDomainReload,
      disableSceneReload: finalStatus.disableSceneReload,
      reloadObserved: finalEditor.connectionGeneration !== initialEditor.connectionGeneration,
      initialConnectionGeneration: initialEditor.connectionGeneration,
      finalConnectionGeneration: finalEditor.connectionGeneration,
    };
  }

  public async requestStartEditModeTests(
    options: TestRunStartOptions,
    timeoutMs = 5_000,
  ): Promise<TestRunPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateTestAssemblyName(options.assemblyName);
    const testNames = normalizeTestNames(options.testNames);
    const mutationId = options.mutationId ?? randomUUID();
    validateMutationId(mutationId);

    const result = await this.requestOperation(
      "test.run.editMode.start",
      {
        assemblyName: options.assemblyName,
        testNames,
        mutationId,
      },
      {
        editorId: editor.editorId,
        connectionGeneration: editor.connectionGeneration,
      },
      timeoutMs,
      "write",
    );

    if (!isTestRunPayload(result)) {
      throw new Error("Unity returned an invalid test.run.editMode.start payload.");
    }
    return result;
  }

  public async requestTestRun(
    mutationId: string,
    timeoutMs = 5_000,
  ): Promise<TestRunPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }
    validateMutationId(mutationId);

    const result = await this.requestOperation(
      "test.run.get",
      { mutationId },
      {
        editorId: editor.editorId,
        connectionGeneration: editor.connectionGeneration,
      },
      timeoutMs,
      "read",
    );

    if (!isTestRunPayload(result)) {
      throw new Error("Unity returned an invalid test.run.get payload.");
    }
    return result;
  }

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

  private async deliverPlayModeTransition(
    args: {
      targetMode: StablePlayMode;
      expectedCurrentMode: StablePlayMode;
      mutationId: string;
    },
    timeoutMs: number,
  ): Promise<PlayModeTransitionPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    const result = await this.requestOperation(
      "editor.playMode.set",
      args,
      {
        editorId: editor.editorId,
        connectionGeneration: editor.connectionGeneration,
      },
      timeoutMs,
      "write",
    );
    if (!isPlayModeTransitionPayload(result)) {
      throw new Error("Unity returned an invalid editor.playMode.set payload.");
    }
    return result;
  }

  private async waitForStablePlayMode(
    editorId: string,
    targetMode: StablePlayMode,
    deadlineUnixMs: number,
  ): Promise<PlayModeAwareStatus> {
    let lastObservation = "No editor.status observation received.";

    while (remainingMs(deadlineUnixMs) > 0) {
      await this.waitForSameEditorForPlayMode(editorId, deadlineUnixMs);
      try {
        const status = asPlayModeAwareStatus(
          await this.requestEditorStatus(
            Math.min(2_000, Math.max(1, remainingMs(deadlineUnixMs))),
          ),
        );
        lastObservation = `${status.playModeState}, compiling=${status.isCompiling}`;
        if (status.playModeState === targetMode && !status.isCompiling) {
          return status;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isAmbiguousPlayModeDeliveryError(message)) {
          throw error;
        }
        lastObservation = message;
      }

      await delay(Math.min(
        PLAY_MODE_POLL_INTERVAL_MS,
        Math.max(1, remainingMs(deadlineUnixMs)),
      ));
    }

    throw new Error(
      `Timed out waiting for Unity to reach stable Play Mode state '${targetMode}'. Last observation: ${lastObservation}`,
    );
  }

  private async waitForSameEditorForPlayMode(
    editorId: string,
    deadlineUnixMs: number,
  ): Promise<void> {
    while (remainingMs(deadlineUnixMs) > 0) {
      const current = this.connectedEditor;
      if (current !== undefined) {
        if (current.editorId !== editorId) {
          throw new Error(
            `A different Unity Editor connected during Play Mode reconciliation. expectedEditorId=${editorId} observedEditorId=${current.editorId}`,
          );
        }
        return;
      }

      try {
        const hello = await this.waitForEditor(
          Math.min(2_000, Math.max(1, remainingMs(deadlineUnixMs))),
        );
        if (hello.editorId !== editorId) {
          throw new Error(
            `A different Unity Editor connected during Play Mode reconciliation. expectedEditorId=${editorId} observedEditorId=${hello.editorId}`,
          );
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("different Unity Editor")) throw error;
      }
    }
  }
}

interface PlayModeAwareStatus {
  isPlaying: boolean;
  isPaused: boolean;
  isPlayingOrWillChangePlaymode: boolean;
  playModeState: PlayModeState;
  enterPlayModeOptionsEnabled: boolean;
  disableDomainReload: boolean;
  disableSceneReload: boolean;
  isCompiling: boolean;
}

function asPlayModeAwareStatus(value: unknown): PlayModeAwareStatus {
  if (typeof value !== "object" || value === null) {
    throw new Error("Unity editor.status did not return an object while observing Play Mode.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.isPlaying !== "boolean" ||
    typeof candidate.isPaused !== "boolean" ||
    typeof candidate.isPlayingOrWillChangePlaymode !== "boolean" ||
    !isPlayModeState(candidate.playModeState) ||
    typeof candidate.enterPlayModeOptionsEnabled !== "boolean" ||
    typeof candidate.disableDomainReload !== "boolean" ||
    typeof candidate.disableSceneReload !== "boolean" ||
    typeof candidate.isCompiling !== "boolean"
  ) {
    throw new Error(
      "Unity editor.status does not expose the required Play Mode lifecycle fields. Recompile/reload the current Unity AI Bridge package before using editor.playMode.set.",
    );
  }
  return candidate as unknown as PlayModeAwareStatus;
}

function validateStablePlayMode(value: string, name: string): asserts value is StablePlayMode {
  if (value !== "edit" && value !== "play") {
    throw new Error(`${name} must be exactly 'edit' or 'play'.`);
  }
}

function isPlayModeState(value: unknown): value is PlayModeState {
  return value === "edit" ||
    value === "entering_play" ||
    value === "play" ||
    value === "exiting_play";
}

function isPlayModeSnapshotPayload(value: unknown): value is PlayModeSnapshotPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isPlayModeState(candidate.mode) &&
    typeof candidate.isPlaying === "boolean" &&
    typeof candidate.isPaused === "boolean" &&
    typeof candidate.isPlayingOrWillChangePlaymode === "boolean" &&
    typeof candidate.enterPlayModeOptionsEnabled === "boolean" &&
    typeof candidate.disableDomainReload === "boolean" &&
    typeof candidate.disableSceneReload === "boolean"
  );
}

function isPlayModeTransitionPayload(value: unknown): value is PlayModeTransitionPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.reconciled === "boolean" &&
    typeof candidate.changed === "boolean" &&
    typeof candidate.transitionRequested === "boolean" &&
    (candidate.targetMode === "edit" || candidate.targetMode === "play") &&
    (candidate.expectedCurrentMode === "edit" || candidate.expectedCurrentMode === "play") &&
    isNonNegativeInteger(candidate.requestedUnixMs) &&
    isPlayModeSnapshotPayload(candidate.before) &&
    isPlayModeSnapshotPayload(candidate.afterRequest)
  );
}

function isTestRunPayload(value: unknown): value is TestRunPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mutationId !== "string" || candidate.mutationId.length === 0 ||
    typeof candidate.replayed !== "boolean" ||
    typeof candidate.runGuid !== "string" || candidate.runGuid.length === 0 ||
    !isTestRunStatus(candidate.status) ||
    candidate.testMode !== "edit" ||
    typeof candidate.assemblyName !== "string" || candidate.assemblyName.length === 0 ||
    !Array.isArray(candidate.testNames) ||
    !candidate.testNames.every((name) => typeof name === "string" && name.length > 0) ||
    !isNonNegativeInteger(candidate.requestedUnixMs) ||
    !isNonNegativeInteger(candidate.startedUnixMs) ||
    !isNonNegativeInteger(candidate.finishedUnixMs) ||
    !isNonNegativeInteger(candidate.selectedTestCaseCount) ||
    typeof candidate.resultState !== "string" ||
    typeof candidate.durationSeconds !== "number" || !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds < 0 ||
    !isNonNegativeInteger(candidate.passCount) ||
    !isNonNegativeInteger(candidate.failCount) ||
    !isNonNegativeInteger(candidate.skipCount) ||
    !isNonNegativeInteger(candidate.inconclusiveCount) ||
    !isNonNegativeInteger(candidate.assertCount) ||
    !Array.isArray(candidate.issues) || candidate.issues.length > MAX_TEST_ISSUES ||
    !candidate.issues.every(isTestRunIssuePayload) ||
    typeof candidate.issuesTruncated !== "boolean" ||
    typeof candidate.errorMessage !== "string"
  ) {
    return false;
  }
  return true;
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

function isAmbiguousPlayModeDeliveryError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("timed out") ||
    normalized.includes("disconnected before the request completed") ||
    normalized.includes("no unity editor is connected") ||
    normalized.includes("no unity editor connected within");
}

function remainingMs(deadlineUnixMs: number): number {
  return Math.max(0, deadlineUnixMs - Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
