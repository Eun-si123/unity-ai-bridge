import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { EditingBridgeServer } from "../src/bridge/editing-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "component-mutation-test-editor",
  connectionGeneration: 88,
  unityVersion: "6000.3.21f1",
  projectName: "ComponentMutationBridgeTest",
};

const ownerId = "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-1-0";
const componentId = "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-2-0";

const componentSnapshot = {
  globalObjectId: componentId,
  instanceId: 202,
  typeName: "UnityEngine.BoxCollider",
  assemblyQualifiedName: "UnityEngine.BoxCollider, UnityEngine.PhysicsModule",
  gameObjectGlobalObjectId: ownerId,
  gameObjectInstanceId: 101,
  gameObjectName: "Target",
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  componentIndex: 1,
  stateEpoch: "component-mutation-epoch",
  stateRevision: 31,
};

test("editing bridge sends component.add as write with type, state and mutation identity", async () => {
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
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "component.add");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.gameObjectGlobalObjectId, ownerId);
      assert.equal(command.arguments.typeName, "UnityEngine.BoxCollider");
      assert.equal(command.arguments.mutationId, "component-add-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "component-mutation-epoch");
      assert.equal(command.arguments.expectedStateRevision, 30);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "component-add-mutation",
          replayed: false,
          added: true,
          requestedGameObjectGlobalObjectId: ownerId,
          requestedTypeName: "UnityEngine.BoxCollider",
          expectedStateEpoch: "component-mutation-epoch",
          expectedStateRevision: 30,
          component: componentSnapshot,
        },
        warnings: [],
        changedTargets: [],
        dirtyState: "dirty",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestAddComponent({
      gameObjectGlobalObjectId: ownerId,
      typeName: "UnityEngine.BoxCollider",
      mutationId: "component-add-mutation",
      expectedStateEpoch: "component-mutation-epoch",
      expectedStateRevision: 30,
    });
    assert.equal(result.added, true);
    assert.equal(result.component.globalObjectId, componentId);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("editing bridge sends component.remove as destructive with exact Component identity", async () => {
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
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "component.remove");
      assert.equal(command.risk, "destructive");
      assert.equal(command.arguments.componentGlobalObjectId, componentId);
      assert.equal(command.arguments.mutationId, "component-remove-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "component-mutation-epoch");
      assert.equal(command.arguments.expectedStateRevision, 31);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "component-remove-mutation",
          replayed: false,
          removed: true,
          requestedComponentGlobalObjectId: componentId,
          deletedTypeName: "UnityEngine.BoxCollider",
          deletedAssemblyQualifiedName: "UnityEngine.BoxCollider, UnityEngine.PhysicsModule",
          deletedGameObjectGlobalObjectId: ownerId,
          deletedGameObjectName: "Target",
          deletedSceneName: "SampleScene",
          deletedScenePath: "Assets/Scenes/SampleScene.unity",
          deletedComponentIndex: 1,
          expectedStateEpoch: "component-mutation-epoch",
          expectedStateRevision: 31,
          stateEpoch: "component-mutation-epoch",
          stateRevision: 32,
        },
        warnings: [],
        changedTargets: [],
        dirtyState: "dirty",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestRemoveComponent({
      componentGlobalObjectId: componentId,
      mutationId: "component-remove-mutation",
      expectedStateEpoch: "component-mutation-epoch",
      expectedStateRevision: 31,
    });
    assert.equal(result.removed, true);
    assert.equal(result.deletedGameObjectGlobalObjectId, ownerId);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("editing bridge rejects empty Component type before sending add", async () => {
  const bridge = new EditingBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let commandObserved = false;
    client.on("message", () => { commandObserved = true; });

    await assert.rejects(
      bridge.requestAddComponent({
        gameObjectGlobalObjectId: ownerId,
        typeName: " ",
        expectedStateEpoch: "component-mutation-epoch",
        expectedStateRevision: 30,
      }),
      /typeName is required/,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commandObserved, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("editing bridge rejects invalid remove state before sending", async () => {
  const bridge = new EditingBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let commandObserved = false;
    client.on("message", () => { commandObserved = true; });

    await assert.rejects(
      bridge.requestRemoveComponent({
        componentGlobalObjectId: componentId,
        expectedStateEpoch: "component-mutation-epoch",
        expectedStateRevision: 0,
      }),
      /expectedStateRevision must be a positive safe integer/,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commandObserved, false);
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
    client.once("open", onOpen);
    client.once("error", onError);
  });
}
