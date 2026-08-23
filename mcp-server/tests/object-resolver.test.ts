import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  LocalBridgeServer,
  type BridgeHello,
  type ObjectResolvePayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "test-editor-resolver",
  connectionGeneration: 9876,
  unityVersion: "6000.3.21f1",
  projectName: "BridgeResolverTest",
};

const globalObjectId = "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-42-0";

const foundPayload: ObjectResolvePayload = {
  requestedGlobalObjectId: globalObjectId,
  found: true,
  canonicalGlobalObjectId: globalObjectId,
  instanceId: -1234,
  name: "ResolvedObject",
  objectType: "UnityEngine.GameObject",
  isGameObject: true,
  isComponent: false,
  owningGameObjectGlobalObjectId: globalObjectId,
  owningGameObjectInstanceId: -1234,
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  hierarchyPath: "Parent/ResolvedObject",
  siblingIndex: 2,
  activeSelf: true,
  activeInHierarchy: true,
};

test("local bridge sends object.resolve as a read and validates native identity payload", async () => {
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
        route: { editorId: string; connectionGeneration: number };
      };

      assert.equal(command.operation, "object.resolve");
      assert.equal(command.risk, "read");
      assert.deepEqual(command.arguments, { globalObjectId });
      assert.equal(command.route.editorId, hello.editorId);
      assert.equal(command.route.connectionGeneration, hello.connectionGeneration);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: foundPayload,
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    assert.deepEqual(await bridge.requestResolveObject(globalObjectId), foundPayload);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("object.resolve accepts a syntactically valid identity that is currently missing", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as { requestId: string };
      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: {
            requestedGlobalObjectId: globalObjectId,
            found: false,
            canonicalGlobalObjectId: "",
            instanceId: 0,
            name: "",
            objectType: "",
            isGameObject: false,
            isComponent: false,
            owningGameObjectGlobalObjectId: "",
            owningGameObjectInstanceId: 0,
            sceneName: "",
            scenePath: "",
            hierarchyPath: "",
            siblingIndex: 0,
            activeSelf: false,
            activeInHierarchy: false,
          },
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    const result = await bridge.requestResolveObject(globalObjectId);
    assert.equal(result.found, false);
    assert.equal(result.requestedGlobalObjectId, globalObjectId);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects empty object resolver input before Unity delivery", async () => {
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

    await assert.rejects(bridge.requestResolveObject("   "), /globalObjectId is required/);
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
