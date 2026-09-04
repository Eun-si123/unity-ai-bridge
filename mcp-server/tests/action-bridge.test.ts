import assert from "node:assert/strict";
import test from "node:test";

import {
  isBridgeActionHistoryPayload,
  isBridgeActionUndoPayload,
} from "../src/bridge/action-bridge.js";

function historyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: "transform.set",
    mutationId: "history-test-1",
    undoGroup: 41,
    undoGroupName: "Unity AI Bridge: Set Transform",
    scenePath: "Assets/SampleScene.unity",
    completedUnixMs: 1000,
    stateBeforeEpoch: "epoch-a",
    stateBeforeRevision: 11,
    stateAfterEpoch: "epoch-a",
    stateAfterRevision: 12,
    undone: false,
    undoPerformedUnixMs: 0,
    undoStateEpoch: "",
    undoStateRevision: 0,
    isLatest: true,
    safeToUndoNow: true,
    unsafeReason: "",
    ...overrides,
  };
}

function historyPayload(actions: Record<string, unknown>[]): Record<string, unknown> {
  return {
    journalKind: "bridge_action_history_v1",
    sessionScope: "current_editor_session",
    coverage: "editor_mutation_transaction_scene_edits_v1",
    returnedCount: actions.length,
    maximumResults: 32,
    stateEpoch: "epoch-a",
    stateRevision: 12,
    currentUndoGroup: 41,
    currentUndoGroupName: "Unity AI Bridge: Set Transform",
    actions,
  };
}

test("action history validator accepts one safe latest action", () => {
  assert.equal(isBridgeActionHistoryPayload(historyPayload([historyEntry()])), true);
});

test("action history validator rejects an older action advertised as safe", () => {
  const latest = historyEntry({ safeToUndoNow: false, unsafeReason: "state_advanced_since_action" });
  const older = historyEntry({
    mutationId: "history-test-older",
    isLatest: false,
    safeToUndoNow: true,
    unsafeReason: "",
  });

  assert.equal(isBridgeActionHistoryPayload(historyPayload([latest, older])), false);
});

test("action history validator requires an unsafe reason whenever safe undo is false", () => {
  assert.equal(
    isBridgeActionHistoryPayload(
      historyPayload([historyEntry({ safeToUndoNow: false, unsafeReason: "" })]),
    ),
    false,
  );
});

test("safe undo validator accepts exact observed Unity undo group and changed state token", () => {
  assert.equal(
    isBridgeActionUndoPayload({
      operation: "transform.set",
      mutationId: "history-test-1",
      undone: true,
      undoGroup: 41,
      undoGroupName: "Unity AI Bridge: Set Transform",
      observedUndoGroup: 41,
      observedUndoName: "Unity AI Bridge: Set Transform",
      priorStateEpoch: "epoch-a",
      priorStateRevision: 12,
      stateEpoch: "epoch-a",
      stateRevision: 13,
      sceneIsDirty: true,
    }),
    true,
  );
});

test("safe undo validator rejects a different observed undo group", () => {
  assert.equal(
    isBridgeActionUndoPayload({
      operation: "transform.set",
      mutationId: "history-test-1",
      undone: true,
      undoGroup: 41,
      undoGroupName: "Unity AI Bridge: Set Transform",
      observedUndoGroup: 42,
      observedUndoName: "Unity AI Bridge: Set Transform",
      priorStateEpoch: "epoch-a",
      priorStateRevision: 12,
      stateEpoch: "epoch-a",
      stateRevision: 13,
      sceneIsDirty: true,
    }),
    false,
  );
});

test("safe undo validator rejects an unchanged state token", () => {
  assert.equal(
    isBridgeActionUndoPayload({
      operation: "transform.set",
      mutationId: "history-test-1",
      undone: true,
      undoGroup: 41,
      undoGroupName: "Unity AI Bridge: Set Transform",
      observedUndoGroup: 41,
      observedUndoName: "Unity AI Bridge: Set Transform",
      priorStateEpoch: "epoch-a",
      priorStateRevision: 12,
      stateEpoch: "epoch-a",
      stateRevision: 12,
      sceneIsDirty: true,
    }),
    false,
  );
});
