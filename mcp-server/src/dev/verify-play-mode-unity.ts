import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const overallTimeoutMs = 180_000;
const longToolTimeoutMs = 180_000;
const shortToolTimeoutMs = 15_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-play-mode-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

let finalEditConfirmed = false;

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of ["unity_get_status", "unity_set_play_mode"]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Play Mode capability and a stable Editor state...");
  let initial = await waitForStableStatus(overallTimeoutMs);
  requirePlayModeCapability(initial);

  if (initial.isCompiling) {
    throw new Error("Unity is compiling before the Play Mode verifier begins.");
  }

  if (initial.playModeState === "play") {
    console.log("[Unity AI Bridge] Editor started in Play Mode; returning it to Edit Mode before the gate...");
    const normalize = await setPlayMode(
      "edit",
      "play",
      `verify-play-mode-normalize-${Date.now()}`,
    );
    requireFinalMode(normalize, "edit", "initial normalization");
    initial = await waitForExactStableStatus("edit", overallTimeoutMs);
  }

  if (initial.playModeState !== "edit") {
    throw new Error(`Verifier requires stable Edit Mode before the main gate; observed ${initial.playModeState}.`);
  }

  const optionsBefore = {
    enterPlayModeOptionsEnabled: initial.enterPlayModeOptionsEnabled,
    disableDomainReload: initial.disableDomainReload,
    disableSceneReload: initial.disableSceneReload,
  };

  const enterMutationId = `verify-play-mode-enter-${Date.now()}`;
  console.log("[Unity AI Bridge] Entering Play Mode through MCP...");
  const enter = await setPlayMode("play", "edit", enterMutationId);
  requireFinalMode(enter, "play", "enter");
  if (!enter.changed) {
    throw new Error("Enter Play Mode unexpectedly reported changed=false.");
  }
  const inPlay = await waitForExactStableStatus("play", overallTimeoutMs);
  if (!inPlay.isPlaying || !inPlay.isPlayingOrWillChangePlaymode) {
    throw new Error(`Native Play Mode booleans disagreed with stable play: ${JSON.stringify(inPlay)}`);
  }

  console.log("[Unity AI Bridge] Replaying the same enter mutationId; no second EnterPlaymode request is allowed...");
  const enterReplay = await setPlayMode("play", "edit", enterMutationId);
  requireFinalMode(enterReplay, "play", "enter replay");
  if (!enterReplay.replayed) {
    throw new Error(`Same-id enter did not report replayed=true: ${JSON.stringify(enterReplay)}`);
  }
  const afterEnterReplay = await waitForExactStableStatus("play", overallTimeoutMs);
  if (!afterEnterReplay.isPlaying) {
    throw new Error("Same-id enter replay unexpectedly left Play Mode.");
  }

  console.log("[Unity AI Bridge] Proving stale expectedCurrentMode is rejected without changing Play Mode...");
  const stale = await callToolWithTimeout(
    {
      name: "unity_set_play_mode",
      arguments: {
        targetMode: "edit",
        expectedCurrentMode: "edit",
        mutationId: `verify-play-mode-stale-${Date.now()}`,
      },
    },
    shortToolTimeoutMs,
  );
  if (!stale.isError) {
    throw new Error("Stale Play Mode precondition unexpectedly succeeded.");
  }
  const staleText = readToolText(stale);
  if (!staleText.includes("play_mode_state_mismatch")) {
    throw new Error(`Stale Play Mode rejection did not expose play_mode_state_mismatch: ${staleText}`);
  }
  const afterStale = await waitForExactStableStatus("play", overallTimeoutMs);
  if (!afterStale.isPlaying) {
    throw new Error("Stale Play Mode attempt changed native mode.");
  }

  const exitMutationId = `verify-play-mode-exit-${Date.now()}`;
  console.log("[Unity AI Bridge] Exiting Play Mode through MCP...");
  const exit = await setPlayMode("edit", "play", exitMutationId);
  requireFinalMode(exit, "edit", "exit");
  if (!exit.changed) {
    throw new Error("Exit Play Mode unexpectedly reported changed=false.");
  }
  const backInEdit = await waitForExactStableStatus("edit", overallTimeoutMs);
  if (backInEdit.isPlaying || backInEdit.isPlayingOrWillChangePlaymode) {
    throw new Error(`Native Play Mode booleans disagreed with stable edit: ${JSON.stringify(backInEdit)}`);
  }
  finalEditConfirmed = true;

  console.log("[Unity AI Bridge] Replaying the same exit mutationId; no second ExitPlaymode request is allowed...");
  const exitReplay = await setPlayMode("edit", "play", exitMutationId);
  requireFinalMode(exitReplay, "edit", "exit replay");
  if (!exitReplay.replayed) {
    throw new Error(`Same-id exit did not report replayed=true: ${JSON.stringify(exitReplay)}`);
  }
  const finalStatus = await waitForExactStableStatus("edit", overallTimeoutMs);
  finalEditConfirmed = true;

  if (
    finalStatus.enterPlayModeOptionsEnabled !== optionsBefore.enterPlayModeOptionsEnabled ||
    finalStatus.disableDomainReload !== optionsBefore.disableDomainReload ||
    finalStatus.disableSceneReload !== optionsBefore.disableSceneReload
  ) {
    throw new Error("Play Mode verifier changed the user's Enter Play Mode settings.");
  }

  console.log("[Unity AI Bridge] Play Mode MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: finalStatus.unityVersion,
    initialMode: initial.playModeState,
    finalMode: finalStatus.playModeState,
    enterMutationId,
    enterChanged: enter.changed,
    enterReplayReadOnly: enterReplay.replayed,
    enterReconciled: enterReplay.reconciled,
    enterReloadObserved: enter.reloadObserved,
    enterInitialConnectionGeneration: enter.initialConnectionGeneration,
    enterFinalConnectionGeneration: enter.finalConnectionGeneration,
    staleExpectedModeRejected: true,
    staleAttemptLeftPlayModeUnchanged: true,
    exitMutationId,
    exitChanged: exit.changed,
    exitReplayReadOnly: exitReplay.replayed,
    exitReconciled: exitReplay.reconciled,
    exitReloadObserved: exit.reloadObserved,
    exitInitialConnectionGeneration: exit.initialConnectionGeneration,
    exitFinalConnectionGeneration: exit.finalConnectionGeneration,
    enterPlayModeOptionsEnabled: finalStatus.enterPlayModeOptionsEnabled,
    disableDomainReload: finalStatus.disableDomainReload,
    disableSceneReload: finalStatus.disableSceneReload,
    userEnterPlayModeSettingsPreserved: true,
    exactFinalEditStateRestored: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Play Mode MCP verification FAILED:\n${message}`);
  process.exitCode = 1;

  if (!finalEditConfirmed) {
    console.error("[Unity AI Bridge] Attempting guarded return to stable Edit Mode...");
    try {
      await returnToEditMode();
      finalEditConfirmed = true;
      console.error("[Unity AI Bridge] Guarded cleanup returned the Editor to stable Edit Mode.");
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error
        ? cleanupError.stack ?? cleanupError.message
        : String(cleanupError);
      console.error(`[Unity AI Bridge] Guarded Play Mode cleanup FAILED:\n${cleanupMessage}`);
      console.error("[Unity AI Bridge] Inspect the Unity Editor's current Play Mode state before continuing work.");
    }
  }
} finally {
  await client.close();
}

async function setPlayMode(
  targetMode: "edit" | "play",
  expectedCurrentMode: "edit" | "play",
  mutationId: string,
): Promise<PlayModeResult> {
  const result = await callToolWithTimeout(
    {
      name: "unity_set_play_mode",
      arguments: { targetMode, expectedCurrentMode, mutationId },
    },
    longToolTimeoutMs,
  );
  if (result.isError) {
    throw new Error(`unity_set_play_mode failed: ${readToolText(result)}`);
  }
  return parsePlayModeResult(result.structuredContent);
}

async function waitForStableStatus(timeout: number): Promise<StatusPayload> {
  const deadline = Date.now() + timeout;
  let last = "No status observation received.";

  while (Date.now() < deadline) {
    try {
      const status = await getStatus();
      requirePlayModeCapability(status);
      last = `${status.playModeState}, compiling=${status.isCompiling}`;
      if (
        (status.playModeState === "edit" || status.playModeState === "play") &&
        !status.isCompiling
      ) {
        return status;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for a stable Play Mode status. Last observation: ${last}`);
}

async function waitForExactStableStatus(
  targetMode: "edit" | "play",
  timeout: number,
): Promise<StatusPayload> {
  const deadline = Date.now() + timeout;
  let last = "No status observation received.";

  while (Date.now() < deadline) {
    try {
      const status = await getStatus();
      requirePlayModeCapability(status);
      last = `${status.playModeState}, compiling=${status.isCompiling}`;
      if (status.playModeState === targetMode && !status.isCompiling) {
        return status;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for stable '${targetMode}'. Last observation: ${last}`);
}

async function returnToEditMode(): Promise<void> {
  const status = await waitForStableStatus(overallTimeoutMs);
  if (status.playModeState === "edit") return;

  const cleanup = await setPlayMode(
    "edit",
    "play",
    `verify-play-mode-cleanup-${Date.now()}`,
  );
  requireFinalMode(cleanup, "edit", "guarded cleanup");
  await waitForExactStableStatus("edit", overallTimeoutMs);
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

function requirePlayModeCapability(status: StatusPayload): void {
  if (!status.capabilities.includes("editor.playMode.set")) {
    throw new Error(
      `Unity Agent does not advertise editor.playMode.set. capabilities=${JSON.stringify(status.capabilities)}`,
    );
  }
}

function requireFinalMode(
  result: PlayModeResult,
  expected: "edit" | "play",
  stage: string,
): void {
  if (result.finalMode !== expected) {
    throw new Error(`${stage} expected finalMode=${expected}: ${JSON.stringify(result)}`);
  }
  if (expected === "play" && (!result.finalIsPlaying || !result.finalIsPlayingOrWillChangePlaymode)) {
    throw new Error(`${stage} returned inconsistent final Play Mode booleans: ${JSON.stringify(result)}`);
  }
  if (expected === "edit" && (result.finalIsPlaying || result.finalIsPlayingOrWillChangePlaymode)) {
    throw new Error(`${stage} returned inconsistent final Edit Mode booleans: ${JSON.stringify(result)}`);
  }
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
    isPlaying: readBoolean(record, "isPlaying"),
    isPaused: readBoolean(record, "isPaused"),
    isPlayingOrWillChangePlaymode: readBoolean(record, "isPlayingOrWillChangePlaymode"),
    playModeState,
    enterPlayModeOptionsEnabled: readBoolean(record, "enterPlayModeOptionsEnabled"),
    disableDomainReload: readBoolean(record, "disableDomainReload"),
    disableSceneReload: readBoolean(record, "disableSceneReload"),
    isCompiling: readBoolean(record, "isCompiling"),
    capabilities: capabilities as string[],
  };
}

function parsePlayModeResult(value: unknown): PlayModeResult {
  const record = requireRecord(value, "play mode structuredContent");
  const finalMode = readString(record, "finalMode");
  if (finalMode !== "edit" && finalMode !== "play") {
    throw new Error(`Unexpected finalMode '${finalMode}'.`);
  }
  return {
    mutationId: readString(record, "mutationId"),
    replayed: readBoolean(record, "replayed"),
    reconciled: readBoolean(record, "reconciled"),
    changed: readBoolean(record, "changed"),
    transitionRequested: readBoolean(record, "transitionRequested"),
    finalMode,
    finalIsPlaying: readBoolean(record, "finalIsPlaying"),
    finalIsPaused: readBoolean(record, "finalIsPaused"),
    finalIsPlayingOrWillChangePlaymode: readBoolean(record, "finalIsPlayingOrWillChangePlaymode"),
    enterPlayModeOptionsEnabled: readBoolean(record, "enterPlayModeOptionsEnabled"),
    disableDomainReload: readBoolean(record, "disableDomainReload"),
    disableSceneReload: readBoolean(record, "disableSceneReload"),
    reloadObserved: readBoolean(record, "reloadObserved"),
    initialConnectionGeneration: readPositiveInteger(record, "initialConnectionGeneration"),
    finalConnectionGeneration: readPositiveInteger(record, "finalConnectionGeneration"),
  };
}

function isPlayModeState(value: string): value is StatusPayload["playModeState"] {
  return value === "edit" ||
    value === "entering_play" ||
    value === "play" ||
    value === "exiting_play";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string: ${JSON.stringify(record)}`);
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
    throw new Error(`Expected ${key} to be a positive integer: ${JSON.stringify(record)}`);
  }
  return value as number;
}

function readToolText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "No text error returned.";
  return result.content
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return "";
      const record = entry as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StatusPayload {
  unityVersion: string;
  isPlaying: boolean;
  isPaused: boolean;
  isPlayingOrWillChangePlaymode: boolean;
  playModeState: "edit" | "entering_play" | "play" | "exiting_play";
  enterPlayModeOptionsEnabled: boolean;
  disableDomainReload: boolean;
  disableSceneReload: boolean;
  isCompiling: boolean;
  capabilities: string[];
}

interface PlayModeResult {
  mutationId: string;
  replayed: boolean;
  reconciled: boolean;
  changed: boolean;
  transitionRequested: boolean;
  finalMode: "edit" | "play";
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
