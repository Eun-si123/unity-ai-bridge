import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  LocalBridgeServer,
  type BridgeHello,
  type EditorStatusPayload,
  type HierarchyPayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "test-editor",
  connectionGeneration: 1234,
  unityVersion: "6000.3.21f1",
  projectName: "BridgeTest",
};

const status: EditorStatusPayload = {
  unityVersion: "6000.3.21f1",
  projectName: "BridgeTest",
  activeScene: "Assets/Scenes/SampleScene.unity",
  isPlaying: false,
  isCompiling: false,
};

const hierarchy: HierarchyPayload = {
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  stateEpoch: "test-state-epoch",
  stateRevision: 12,
  rootCount: 1,
  returnedNodeCount: 2,
  maxDepth: 3,
  maxNodes: 25,
  truncatedByDepth: false,
  truncatedByNodes: false,
  nodes: [
    {
      globalObjectId: "GlobalObjectId_V1-2-root-0-0",
      instanceId: 100,
      name: "Root",
      hierarchyPath: "Root",
      parentGlobalObjectId: "",
      depth: 0,
      siblingIndex: 0,
      childCount: 1,
      activeSelf: true,
      activeInHierarchy: true,
    },
    {
      globalObjectId: "GlobalObjectId_V1-2-child-0-0",
      instanceId: 101,
      name: "Child",
      hierarchyPath: "Root/Child",
      parentGlobalObjectId: "GlobalObjectId_V1-2-root-0-0",
      depth: 1,
      siblingIndex: 0,
      childCount: 0,
      activeSelf: true,
      activeInHierarchy: true,
    },
  ],
};

test("local bridge registers a Unity hello and completes editor.status", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  let phase = "start server";
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    phase = "open client";
    await waitForOpen(client);

    phase = "send hello";
    client.send(JSON.stringify(hello));

    phase = "wait for hello registration";
    const connected = await bridge.waitForEditor();
    assert.deepEqual(connected, hello);

    phase = "install command responder";
    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        protocolVersion: string;
        requestId: string;
        operation: string;
        risk: string;
        route: { editorId: string; connectionGeneration: number };
      };

      assert.equal(command.protocolVersion, BRIDGE_PROTOCOL_VERSION);
      assert.equal(command.operation, "editor.status");
      assert.equal(command.risk, "read");
      assert.equal(command.route.editorId, hello.editorId);
      assert.equal(command.route.connectionGeneration, hello.connectionGeneration);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: status,
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    phase = "request editor status";
    assert.deepEqual(await bridge.requestEditorStatus(), status);
    phase = "completed";
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    throw new Error(`Local bridge test failed during '${phase}': ${detail}`);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge requests a bounded scene hierarchy and validates the result", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        protocolVersion: string;
        requestId: string;
        operation: string;
        arguments: { maxDepth: number; maxNodes: number };
        risk: string;
        route: { editorId: string; connectionGeneration: number };
      };

      assert.equal(command.protocolVersion, BRIDGE_PROTOCOL_VERSION);
      assert.equal(command.operation, "scene.hierarchy");
      assert.deepEqual(command.arguments, { maxDepth: 3, maxNodes: 25 });
      assert.equal(command.risk, "read");
      assert.equal(command.route.editorId, hello.editorId);
      assert.equal(command.route.connectionGeneration, hello.connectionGeneration);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: hierarchy,
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    assert.deepEqual(
      await bridge.requestHierarchy({ maxDepth: 3, maxNodes: 25 }),
      hierarchy,
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects invalid hierarchy limits before sending a command", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    await assert.rejects(
      bridge.requestHierarchy({ maxDepth: 0, maxNodes: 25 }),
      /maxDepth must be an integer between 1 and 32/,
    );
    await assert.rejects(
      bridge.requestHierarchy({ maxDepth: 3, maxNodes: 501 }),
      /maxNodes must be an integer between 1 and 500/,
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge preserves an explicit route and surfaces stale-generation rejection", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    const staleRoute = {
      editorId: hello.editorId,
      connectionGeneration: hello.connectionGeneration - 1,
    };

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        route: { editorId: string; connectionGeneration: number };
      };

      assert.deepEqual(command.route, staleRoute);
      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: false,
          error: {
            category: "routing",
            code: "stale_connection",
            message: "Command targets a different editor connection generation.",
          },
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    await assert.rejects(
      bridge.requestEditorStatusForRoute(staleRoute),
      /routing\/stale_connection/,
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects status requests when no editor is connected", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  await bridge.start();

  try {
    await assert.rejects(
      bridge.requestEditorStatus(),
      /No Unity Editor is connected to the local bridge/,
    );
  } finally {
    await bridge.stop();
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
