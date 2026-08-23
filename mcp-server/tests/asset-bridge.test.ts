import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { AssetBridgeServer } from "../src/bridge/asset-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "asset-test-editor",
  connectionGeneration: 91,
  unityVersion: "6000.3.21f1",
  projectName: "AssetBridgeTest",
};

const sceneGuid = "0123456789abcdef0123456789abcdef";
const scenePath = "Assets/Scenes/SampleScene.unity";

test("asset search sends bounded read command and validates result", async () => {
  const bridge = new AssetBridgeServer("127.0.0.1", 0);
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
      assert.equal(command.operation, "asset.search");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.filter, "t:Scene");
      assert.deepEqual(command.arguments.searchInFolders, ["Assets"]);
      assert.equal(command.arguments.maxResults, 20);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          filter: "t:Scene",
          searchInFolders: ["Assets"],
          maxResults: 20,
          totalMatches: 1,
          returnedCount: 1,
          truncated: false,
          assets: [{
            guid: sceneGuid,
            path: scenePath,
            name: "SampleScene",
            extension: ".unity",
            mainTypeName: "UnityEditor.SceneAsset",
            isFolder: false,
          }],
        },
        warnings: [],
        dirtyState: "unchanged",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestSearchAssets({
      filter: "t:Scene",
      searchInFolders: ["Assets"],
      maxResults: 20,
    });
    assert.equal(result.returnedCount, 1);
    assert.equal(result.assets[0]?.guid, sceneGuid);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("asset inspect sends exact path as read and validates metadata", async () => {
  const bridge = new AssetBridgeServer("127.0.0.1", 0);
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
      assert.equal(command.operation, "asset.inspect");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.path, scenePath);
      assert.equal(command.arguments.maxDependencies, 32);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          guid: sceneGuid,
          path: scenePath,
          name: "SampleScene",
          extension: ".unity",
          mainTypeName: "UnityEditor.SceneAsset",
          mainAssetInstanceId: 123,
          mainAssetName: "SampleScene",
          importerTypeName: "",
          dependencyHash: "0123456789abcdef0123456789abcdef",
          labels: [],
          directDependencyCount: 1,
          returnedDependencyCount: 1,
          dependenciesTruncated: false,
          directDependencies: [{
            guid: "abcdefabcdefabcdefabcdefabcdefab",
            path: "Assets/Materials/Test.mat",
            mainTypeName: "UnityEngine.Material",
          }],
        },
        warnings: [],
        dirtyState: "unchanged",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestInspectAsset({ path: scenePath, maxDependencies: 32 });
    assert.equal(result.guid, sceneGuid);
    assert.equal(result.path, scenePath);
    assert.equal(result.directDependencies.length, 1);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("asset bridge rejects traversal before delivery", async () => {
  const bridge = new AssetBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestInspectAsset({ path: "Assets/../ProjectSettings/ProjectSettings.asset" }),
      /may not contain parent traversal/,
    );
    await delay(20);
    assert.equal(observed, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("asset bridge rejects oversized result limits before delivery", async () => {
  const bridge = new AssetBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestSearchAssets({ maxResults: 201 }),
      /maxResults must be an integer between 1 and 200/,
    );
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
    client.once("open", onOpen);
    client.once("error", onError);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
