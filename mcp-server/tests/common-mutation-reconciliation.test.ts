import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  RECONCILED_COMMON_MUTATION_OPERATIONS,
  ReconciledEditingBridgeServer,
} from "../src/bridge/reconciled-editing-bridge-server.js";
import type { GameObjectUpdatePayload } from "../src/bridge/editing-bridge-server.js";
import type {
  BridgeHello,
  GameObjectCreatePayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "test-editor-common-reconciliation";

function hello(connectionGeneration: number, id = editorId): BridgeHello {
  return {
    type: "hello",
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId: id,
    connectionGeneration,
    unityVersion: "6000.3.21f1",
    projectName: "CommonReconciliationTest",
  };
}

function completedStatus(mutationId: string, operation: string): Record<string, unknown> {
  return {
    mutationId,
    found: true,
    journalKind: "editor_mutation_lifecycle_v1",
    sessionScope: "current_editor_session",
    coverage: "editor_mutation_transaction_v1",
    operation,
    status: "completed",
    terminal: true,
    startedUnixMs: 100,
    startedStateEpoch: "test-state-epoch",
    startedStateRevision: 10,
    finishedUnixMs: 200,
    finishedStateEpoch: "test-state-epoch",
    finishedStateRevision: 11,
    failureKind: "",
    intentIdentityRecorded: true,
    safeToBlindRetry: false,
    recommendedAction: "operation_specific_same_id_replay_or_reobserve",
  };
}

function notFoundStatus(mutationId: string): Record<string, unknown> {
  return {
    mutationId,
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
  };
}

function createPayload(mutationId: string): GameObjectCreatePayload {
  return {
    mutationId,
    replayed: true,
    globalObjectId: "GlobalObjectId_V1-2-reconciled-create-0-0",
    instanceId: 901,
    name: "ReconciledCreate",
    hierarchyPath: "ReconciledCreate",
    sceneName: "SampleScene",
    scenePath: "Assets/SampleScene.unity",
    siblingIndex: 4,
    expectedStateEpoch: "snapshot-epoch",
    expectedStateRevision: 7,
    stateEpoch: "test-state-epoch",
    stateRevision: 11,
  };
}

function updatePayload(mutationId: string): GameObjectUpdatePayload {
  return {
    mutationId,
    replayed: true,
    changed: true,
    requestedGlobalObjectId: "GlobalObjectId_V1-2-update-target-0-0",
    requestedName: "Updated",
    requestedActiveSelf: true,
    expectedStateEpoch: "snapshot-epoch",
    expectedStateRevision: 8,
    gameObject: {
      globalObjectId: "GlobalObjectId_V1-2-update-target-0-0",
      instanceId: 902,
      name: "Updated",
      activeSelf: true,
      activeInHierarchy: true,
      childCount: 0,
      sceneName: "SampleScene",
      scenePath: "Assets/SampleScene.unity",
      hierarchyPath: "Updated",
      siblingIndex: 4,
      sceneIsDirty: true,
      stateEpoch: "test-state-epoch",
      stateRevision: 12,
    },
  };
}

test("common mutation reconciliation allowlist is explicit and bounded", () => {
  assert.deepEqual(
    [...RECONCILED_COMMON_MUTATION_OPERATIONS].sort(),
    [
      "component.add",
      "component.property.set",
      "component.remove",
      "gameObject.create",
      "gameObject.delete",
      "gameObject.update",
      "transform.set",
    ],
  );
  assert.equal(RECONCILED_COMMON_MUTATION_OPERATIONS.has("scene.save"), false);
  assert.equal(RECONCILED_COMMON_MUTATION_OPERATIONS.has("script.replace"), false);
});

test("timeout ambiguity uses mutation.status and same-id replay to recover gameObject.create result", async () => {
  const bridge = new ReconciledEditingBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = await connectEditor(bridge, port, hello(100));
  const mutationId = "reconcile-create-timeout-1";
  let createDeliveries = 0;
  let statusReads = 0;

  try {
    client.on("message", (data) => {
      const command = parseCommand(data);
      if (command.operation === "gameObject.create") {
        createDeliveries += 1;
        assert.equal(command.arguments.mutationId, mutationId);
        if (createDeliveries === 1) {
          return;
        }
        sendSuccess(client, command.requestId, createPayload(mutationId));
        return;
      }

      if (command.operation === "mutation.status") {
        statusReads += 1;
        assert.deepEqual(command.arguments, { mutationId });
        sendSuccess(client, command.requestId, completedStatus(mutationId, "gameObject.create"));
        return;
      }

      assert.fail(`Unexpected operation ${command.operation}`);
    });

    const result = await bridge.requestCreateGameObject(
      {
        name: "ReconciledCreate",
        mutationId,
        expectedStateEpoch: "snapshot-epoch",
        expectedStateRevision: 7,
      },
      75,
    );

    assert.equal(result.replayed, true);
    assert.equal(result.mutationId, mutationId);
    assert.equal(createDeliveries, 2);
    assert.equal(statusReads, 1);
  } finally {
    await bridge.stop();
    closeSocket(client);
  }
});

test("disconnect ambiguity waits for the same Editor then recovers through completed same-id replay", async () => {
  const bridge = new ReconciledEditingBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const first = await connectEditor(bridge, port, hello(200));
  const mutationId = "reconcile-create-disconnect-1";
  const firstCommandPromise = nextCommand(first);
  const resultPromise = bridge.requestCreateGameObject(
    {
      name: "ReconciledCreate",
      mutationId,
      expectedStateEpoch: "snapshot-epoch",
      expectedStateRevision: 7,
    },
    500,
  );

  let second: WebSocket | undefined;
  try {
    const firstCommand = await firstCommandPromise;
    assert.equal(firstCommand.operation, "gameObject.create");
    assert.equal(firstCommand.arguments.mutationId, mutationId);

    const closed = waitForClose(first);
    first.terminate();
    await closed;

    second = await connectEditor(bridge, port, hello(201));
    let statusReads = 0;
    let replayDeliveries = 0;
    second.on("message", (data) => {
      const command = parseCommand(data);
      if (command.operation === "mutation.status") {
        statusReads += 1;
        sendSuccess(second!, command.requestId, completedStatus(mutationId, "gameObject.create"));
        return;
      }
      if (command.operation === "gameObject.create") {
        replayDeliveries += 1;
        assert.equal(command.arguments.mutationId, mutationId);
        assert.equal(command.route.editorId, editorId);
        assert.equal(command.route.connectionGeneration, 201);
        sendSuccess(second!, command.requestId, createPayload(mutationId));
        return;
      }
      assert.fail(`Unexpected operation ${command.operation}`);
    });

    const result = await resultPromise;
    assert.equal(result.replayed, true);
    assert.equal(statusReads, 1);
    assert.equal(replayDeliveries, 1);
  } finally {
    await bridge.stop();
    closeSocket(first);
    if (second !== undefined) closeSocket(second);
  }
});

test("not_found after ambiguous delivery fails closed and never replays the mutation", async () => {
  const bridge = new ReconciledEditingBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = await connectEditor(bridge, port, hello(300));
  const mutationId = "reconcile-create-not-found-1";
  let createDeliveries = 0;
  let statusReads = 0;

  try {
    client.on("message", (data) => {
      const command = parseCommand(data);
      if (command.operation === "gameObject.create") {
        createDeliveries += 1;
        return;
      }
      if (command.operation === "mutation.status") {
        statusReads += 1;
        sendSuccess(client, command.requestId, notFoundStatus(mutationId));
        return;
      }
      assert.fail(`Unexpected operation ${command.operation}`);
    });

    await assert.rejects(
      bridge.requestCreateGameObject(
        {
          name: "ReconciledCreate",
          mutationId,
          expectedStateEpoch: "snapshot-epoch",
          expectedStateRevision: 7,
        },
        75,
      ),
      /mutation\.status returned not_found[\s\S]*will not blindly retry[\s\S]*mutationId=reconcile-create-not-found-1/,
    );
    assert.equal(createDeliveries, 1);
    assert.equal(statusReads, 1);
  } finally {
    await bridge.stop();
    closeSocket(client);
  }
});

test("newly admitted gameObject.update recovers an ambiguous timeout through same-id replay", async () => {
  const bridge = new ReconciledEditingBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = await connectEditor(bridge, port, hello(400));
  const mutationId = "reconcile-update-enabled-1";
  let updateDeliveries = 0;
  let statusReads = 0;

  try {
    client.on("message", (data) => {
      const command = parseCommand(data);
      if (command.operation === "gameObject.update") {
        updateDeliveries += 1;
        assert.equal(command.arguments.mutationId, mutationId);
        if (updateDeliveries === 1) return;
        sendSuccess(client, command.requestId, updatePayload(mutationId));
        return;
      }
      if (command.operation === "mutation.status") {
        statusReads += 1;
        sendSuccess(client, command.requestId, completedStatus(mutationId, "gameObject.update"));
        return;
      }
      assert.fail(`Unexpected operation ${command.operation}`);
    });

    const result = await bridge.requestUpdateGameObject(
      {
        globalObjectId: "GlobalObjectId_V1-2-update-target-0-0",
        name: "Updated",
        activeSelf: true,
        mutationId,
        expectedStateEpoch: "snapshot-epoch",
        expectedStateRevision: 8,
      },
      75,
    );

    assert.equal(result.replayed, true);
    assert.equal(result.mutationId, mutationId);
    assert.equal(updateDeliveries, 2);
    assert.equal(statusReads, 1);
  } finally {
    await bridge.stop();
    closeSocket(client);
  }
});

type TestCommand = {
  requestId: string;
  operation: string;
  arguments: Record<string, unknown>;
  route: { editorId: string; connectionGeneration: number };
  risk: string;
};

function parseCommand(data: unknown): TestCommand {
  return JSON.parse(String(data)) as TestCommand;
}

function sendSuccess(client: WebSocket, requestId: string, result: unknown): void {
  client.send(
    JSON.stringify({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId,
      ok: true,
      result,
      warnings: [],
      dirtyState: "unchanged",
      compileState: "idle",
    }),
  );
}

async function connectEditor(
  bridge: ReconciledEditingBridgeServer,
  port: number,
  metadata: BridgeHello,
): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await waitForOpen(client);
  const connectedPromise = bridge.waitForEditor(1_000);
  client.send(JSON.stringify(metadata));
  const connected = await connectedPromise;
  assert.equal(connected.editorId, metadata.editorId);
  assert.equal(connected.connectionGeneration, metadata.connectionGeneration);
  return client;
}

async function nextCommand(client: WebSocket): Promise<TestCommand> {
  return await new Promise<TestCommand>((resolve) => {
    client.once("message", (data) => resolve(parseCommand(data)));
  });
}

async function waitForOpen(client: WebSocket): Promise<void> {
  if (client.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = (): void => {
      client.off("open", onOpen);
      client.off("error", onError);
    };
    client.once("open", onOpen);
    client.once("error", onError);
  });
}

async function waitForClose(client: WebSocket): Promise<void> {
  if (client.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => client.once("close", () => resolve()));
}

function closeSocket(client: WebSocket): void {
  if (client.readyState !== WebSocket.CLOSED) client.terminate();
}
