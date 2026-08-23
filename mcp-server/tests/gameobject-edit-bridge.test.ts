import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { EditingBridgeServer } from "../src/bridge/editing-bridge-server.js";
import type { BridgeHello } from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "gameobject-edit-test-editor",
  connectionGeneration: 7711,
  unityVersion: "6000.3.21f1",
  projectName: "GameObjectEditBridgeTest",
};

const globalObjectId = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";

const snapshot = {
  globalObjectId,
  instanceId: 101,
  name: "Renamed",
  activeSelf: false,
  activeInHierarchy: false,
  childCount: 2,
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  hierarchyPath: "Renamed",
  siblingIndex: 0,
  sceneIsDirty: true,
  stateEpoch: "edit-epoch",
  stateRevision: 13,
};

test("editing bridge sends gameObject.update as write with state and mutation identity", async () => {
  const bridge = new EditingBridgeServer("127.0.0.1", 0);
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
          name: string;
          activeSelf: boolean;
          mutationId: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
      };

      assert.equal(command.operation, "gameObject.update");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.globalObjectId, globalObjectId);
      assert.equal(command.arguments.name, "Renamed");
      assert.equal(command.arguments.activeSelf, false);
      assert.equal(command.arguments.mutationId, "update-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "edit-epoch");
      assert.equal(command.arguments.expectedStateRevision, 12);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: {
            mutationId: "update-mutation",
            replayed: false,
            changed: true,
            requestedGlobalObjectId: globalObjectId,
            requestedName: "Renamed",
            requestedActiveSelf: false,
            expectedStateEpoch: "edit-epoch",
            expectedStateRevision: 12,
            gameObject: snapshot,
          },
          warnings: [],
          dirtyState: "dirty",
          undo: { available: true, groupName: "Unity AI Bridge: Update GameObject" },
          compileState: "idle",
        }),
      );
    });

    const result = await bridge.requestUpdateGameObject({
      globalObjectId,
      name: "Renamed",
      activeSelf: false,
      mutationId: "update-mutation",
      expectedStateEpoch: "edit-epoch",
      expectedStateRevision: 12,
    });

    assert.equal(result.replayed, false);
    assert.equal(result.changed, true);
    assert.equal(result.gameObject.name, "Renamed");
    assert.equal(result.gameObject.activeSelf, false);
    assert.equal(result.gameObject.stateRevision, 13);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("editing bridge sends gameObject.delete as destructive with state and mutation identity", async () => {
  const bridge = new EditingBridgeServer("127.0.0.1", 0);
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
          mutationId: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
      };

      assert.equal(command.operation, "gameObject.delete");
      assert.equal(command.risk, "destructive");
      assert.equal(command.arguments.globalObjectId, globalObjectId);
      assert.equal(command.arguments.mutationId, "delete-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "edit-epoch");
      assert.equal(command.arguments.expectedStateRevision, 13);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: {
            mutationId: "delete-mutation",
            replayed: false,
            deleted: true,
            requestedGlobalObjectId: globalObjectId,
            deletedName: "Renamed",
            deletedSceneName: "SampleScene",
            deletedScenePath: "Assets/Scenes/SampleScene.unity",
            deletedHierarchyPath: "Renamed",
            deletedChildCount: 2,
            expectedStateEpoch: "edit-epoch",
            expectedStateRevision: 13,
            stateEpoch: "edit-epoch",
            stateRevision: 14,
          },
          warnings: [],
          dirtyState: "dirty",
          undo: { available: true, groupName: "Unity AI Bridge: Delete GameObject" },
          compileState: "idle",
        }),
      );
    });

    const result = await bridge.requestDeleteGameObject({
      globalObjectId,
      mutationId: "delete-mutation",
      expectedStateEpoch: "edit-epoch",
      expectedStateRevision: 13,
    });

    assert.equal(result.replayed, false);
    assert.equal(result.deleted, true);
    assert.equal(result.deletedName, "Renamed");
    assert.equal(result.deletedChildCount, 2);
    assert.equal(result.stateRevision, 14);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("editing bridge rejects invalid update input before sending a write", async () => {
  const bridge = new EditingBridgeServer("127.0.0.1", 0);
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
      bridge.requestUpdateGameObject({
        globalObjectId,
        name: "   ",
        activeSelf: true,
        expectedStateEpoch: "edit-epoch",
        expectedStateRevision: 12,
      }),
      /name must contain at least one non-whitespace character/,
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

test("editing bridge rejects invalid delete state before sending a destructive command", async () => {
  const bridge = new EditingBridgeServer("127.0.0.1", 0);
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
      bridge.requestDeleteGameObject({
        globalObjectId,
        expectedStateEpoch: "",
        expectedStateRevision: 0,
      }),
      /expectedStateEpoch must be a non-empty string/,
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
