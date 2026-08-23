import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  LocalBridgeServer,
  type BridgeHello,
  type TransformSnapshotPayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "transform-test-editor",
  connectionGeneration: 4321,
  unityVersion: "6000.3.21f1",
  projectName: "TransformBridgeTest",
};

const globalObjectId = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";

const snapshot: TransformSnapshotPayload = {
  globalObjectId,
  instanceId: 101,
  name: "Target",
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  hierarchyPath: "Target",
  sceneIsDirty: false,
  localPosition: { x: 1, y: 2, z: 3 },
  localEulerAngles: { x: 10, y: 20, z: 30 },
  localRotation: { x: 0.0381346, y: 0.1893079, z: 0.2392983, w: 0.9515485 },
  localScale: { x: 1, y: 1, z: 1 },
  worldPosition: { x: 1, y: 2, z: 3 },
  worldRotation: { x: 0.0381346, y: 0.1893079, z: 0.2392983, w: 0.9515485 },
  lossyScale: { x: 1, y: 1, z: 1 },
  stateEpoch: "transform-epoch",
  stateRevision: 12,
};

test("local bridge reads Transform state with read risk", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        arguments: { globalObjectId: string };
        risk: string;
      };

      assert.equal(command.operation, "transform.get");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.globalObjectId, globalObjectId);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: snapshot,
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    assert.deepEqual(await bridge.requestTransform(globalObjectId), snapshot);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge sends transform.set as write with state and mutation identity", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: {
          globalObjectId: string;
          localPosition: { x: number; y: number; z: number };
          localEulerAngles: { x: number; y: number; z: number };
          localScale: { x: number; y: number; z: number };
          mutationId: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
      };

      assert.equal(command.operation, "transform.set");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.globalObjectId, globalObjectId);
      assert.deepEqual(command.arguments.localPosition, { x: 1, y: 2, z: 3 });
      assert.deepEqual(command.arguments.localEulerAngles, { x: 10, y: 20, z: 30 });
      assert.deepEqual(command.arguments.localScale, { x: 2, y: 3, z: 4 });
      assert.equal(command.arguments.mutationId, "transform-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "transform-epoch");
      assert.equal(command.arguments.expectedStateRevision, 12);

      const writtenSnapshot = {
        ...snapshot,
        localScale: { x: 2, y: 3, z: 4 },
        lossyScale: { x: 2, y: 3, z: 4 },
        sceneIsDirty: true,
        stateRevision: 13,
      };
      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: {
            mutationId: "transform-mutation",
            replayed: false,
            requestedGlobalObjectId: globalObjectId,
            requestedLocalPosition: { x: 1, y: 2, z: 3 },
            requestedLocalEulerAngles: { x: 10, y: 20, z: 30 },
            requestedLocalScale: { x: 2, y: 3, z: 4 },
            expectedStateEpoch: "transform-epoch",
            expectedStateRevision: 12,
            transform: writtenSnapshot,
          },
          warnings: [],
          dirtyState: "dirty",
          undo: { available: true, groupName: "Unity AI Bridge: Set Transform" },
          compileState: "idle",
        }),
      );
    });

    const result = await bridge.requestSetTransform({
      globalObjectId,
      localPosition: { x: 1, y: 2, z: 3 },
      localEulerAngles: { x: 10, y: 20, z: 30 },
      localScale: { x: 2, y: 3, z: 4 },
      mutationId: "transform-mutation",
      expectedStateEpoch: "transform-epoch",
      expectedStateRevision: 12,
    });

    assert.equal(result.replayed, false);
    assert.equal(result.transform.stateRevision, 13);
    assert.deepEqual(result.transform.localScale, { x: 2, y: 3, z: 4 });
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects non-finite transform input before sending a write", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    let commandObserved = false;
    client.on("message", () => {
      commandObserved = true;
    });

    await assert.rejects(
      bridge.requestSetTransform({
        globalObjectId,
        localPosition: { x: Number.NaN, y: 0, z: 0 },
        localEulerAngles: { x: 0, y: 0, z: 0 },
        localScale: { x: 1, y: 1, z: 1 },
        expectedStateEpoch: "transform-epoch",
        expectedStateRevision: 12,
      }),
      /localPosition must be an object with finite numeric x, y, and z values/,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commandObserved, false);
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
