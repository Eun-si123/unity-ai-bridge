import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  LocalBridgeServer,
  type BridgeHello,
  type SceneSavePayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "test-editor-save",
  connectionGeneration: 9876,
  unityVersion: "6000.3.21f1",
  projectName: "BridgeSaveTest",
};

function resultPayload(mutationId: string): SceneSavePayload {
  return {
    mutationId,
    replayed: false,
    saved: true,
    alreadyClean: false,
    sceneName: "SampleScene",
    scenePath: "Assets/Scenes/SampleScene.unity",
    wasDirty: true,
    isDirty: false,
    expectedScenePath: "Assets/Scenes/SampleScene.unity",
    expectedStateEpoch: "save-epoch",
    expectedStateRevision: 12,
    stateEpoch: "save-epoch",
    stateRevision: 13,
  };
}

test("local bridge sends scene.save as destructive and validates the result", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const mutationId = "save-test-1";

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        protocolVersion: string;
        requestId: string;
        operation: string;
        arguments: Record<string, unknown>;
        risk: string;
        route: { editorId: string; connectionGeneration: number };
      };

      assert.equal(command.protocolVersion, BRIDGE_PROTOCOL_VERSION);
      assert.equal(command.operation, "scene.save");
      assert.equal(command.risk, "destructive");
      assert.deepEqual(command.arguments, {
        expectedScenePath: "Assets/Scenes/SampleScene.unity",
        mutationId,
        expectedStateEpoch: "save-epoch",
        expectedStateRevision: 12,
      });
      assert.equal(command.route.editorId, hello.editorId);
      assert.equal(command.route.connectionGeneration, hello.connectionGeneration);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: resultPayload(mutationId),
          warnings: [],
          dirtyState: "clean",
          undo: { available: false, groupName: "" },
          compileState: "idle",
        }),
      );
    });

    assert.deepEqual(
      await bridge.requestSaveScene({
        expectedScenePath: "Assets/Scenes/SampleScene.unity",
        mutationId,
        expectedStateEpoch: "save-epoch",
        expectedStateRevision: 12,
      }),
      resultPayload(mutationId),
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects unsafe scene.save input before delivery", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  let delivered = false;

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    client.on("message", () => {
      delivered = true;
    });

    await assert.rejects(
      bridge.requestSaveScene({
        expectedScenePath: "",
        mutationId: "valid-save-id",
        expectedStateEpoch: "epoch",
        expectedStateRevision: 1,
      }),
      /expectedScenePath must be a non-empty string/,
    );

    await assert.rejects(
      bridge.requestSaveScene({
        expectedScenePath: "Assets/Scenes/SampleScene.unity",
        mutationId: "bad save id",
        expectedStateEpoch: "epoch",
        expectedStateRevision: 1,
      }),
      /mutationId must be 1\.\.128 characters/,
    );

    await assert.rejects(
      bridge.requestSaveScene({
        expectedScenePath: "Assets/Scenes/SampleScene.unity",
        mutationId: "valid-save-id",
        expectedStateEpoch: "",
        expectedStateRevision: 1,
      }),
      /expectedStateEpoch must be a non-empty string/,
    );

    await assert.rejects(
      bridge.requestSaveScene({
        expectedScenePath: "Assets/Scenes/SampleScene.unity",
        mutationId: "valid-save-id",
        expectedStateEpoch: "epoch",
        expectedStateRevision: 0,
      }),
      /expectedStateRevision must be a positive safe integer/,
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(delivered, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

async function waitForOpen(client: WebSocket): Promise<void> {
  if (client.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      cleanup();
      reject(error instanceof Error ? error : new Error(`WebSocket open error: ${String(error)}`));
    };
    const cleanup = (): void => {
      client.off("open", onOpen);
      client.off("error", onError);
    };

    client.once("open", onOpen);
    client.once("error", onError);
  });
}
