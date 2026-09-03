import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { requestMutationStatus } from "../src/bridge/mutation-status-bridge.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "mutation-status-editor";

function hello(connectionGeneration: number) {
  return {
    type: "hello" as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId,
    connectionGeneration,
    unityVersion: "6000.3.21f1",
    projectName: "MutationStatusBridgeTest",
  };
}

function envelope(requestId: string, result: Record<string, unknown>) {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
    warnings: [],
    dirtyState: "unchanged",
    compileState: "idle",
  };
}

test("Mutation status requests the common lifecycle journal as a read", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(1001)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "mutation.status");
      assert.equal(command.risk, "read");
      assert.deepEqual(command.arguments, { mutationId: "mutation-abc-123" });
      client.send(JSON.stringify(envelope(command.requestId, {
        mutationId: "mutation-abc-123",
        found: true,
        journalKind: "editor_mutation_lifecycle_v1",
        sessionScope: "current_editor_session",
        coverage: "editor_mutation_transaction_v1",
        operation: "transform.set",
        status: "completed",
        terminal: true,
        startedUnixMs: 1788420000000,
        startedStateEpoch: "epoch-a",
        startedStateRevision: 10,
        finishedUnixMs: 1788420000100,
        finishedStateEpoch: "epoch-a",
        finishedStateRevision: 11,
        failureKind: "",
        intentIdentityRecorded: true,
        safeToBlindRetry: false,
        recommendedAction: "operation_specific_same_id_replay_or_reobserve",
      })));
    });

    const result = await requestMutationStatus(bridge, "mutation-abc-123");
    assert.equal(result.found, true);
    assert.equal(result.operation, "transform.set");
    assert.equal(result.status, "completed");
    assert.equal(result.safeToBlindRetry, false);
    assert.equal(result.intentIdentityRecorded, true);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Mutation status preserves not_found as unknown rather than safe-to-retry", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(1002)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as { requestId: string };
      client.send(JSON.stringify(envelope(command.requestId, {
        mutationId: "unknown-123",
        found: false,
        journalKind: "editor_mutation_lifecycle_v1",
        sessionScope: "current_editor_session",
        coverage: "editor_mutation_transaction_v1",
        operation: "",
        status: "not_found",
        terminal: false,
        startedUnixMs: 0,
        startedStateEpoch: "",
        startedStateRevision: 0,
        finishedUnixMs: 0,
        finishedStateEpoch: "",
        finishedStateRevision: 0,
        failureKind: "",
        intentIdentityRecorded: false,
        safeToBlindRetry: false,
        recommendedAction: "reobserve_native_state",
      })));
    });

    const result = await requestMutationStatus(bridge, "unknown-123");
    assert.equal(result.found, false);
    assert.equal(result.status, "not_found");
    assert.equal(result.safeToBlindRetry, false);
    assert.equal(result.recommendedAction, "reobserve_native_state");
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Mutation status rejects malformed ids before Unity delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(1003)));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(requestMutationStatus(bridge, "bad mutation/id"), /mutationId/);
    await delay(20);
    assert.equal(observed, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

async function waitForOpen(client: WebSocket): Promise<void> {
  if (client.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => { cleanup(); resolve(); };
    const onError = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = (): void => {
      client.off("open", onOpen);
      client.off("error", onError);
    };
    client.on("open", onOpen);
    client.on("error", onError);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
