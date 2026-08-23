import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { AssetBridgeServer } from "../src/bridge/asset-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "prefab-test-editor",
  connectionGeneration: 121,
  unityVersion: "6000.3.21f1",
  projectName: "PrefabBridgeTest",
};

const prefabPath = "Assets/Prefabs/Test.prefab";
const prefabGuid = "1234567890abcdef1234567890abcdef";
const prefabHash = "abcdef0123456789abcdef0123456789";

test("prefab inspect sends bounded read command and validates result", async () => {
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
      assert.equal(command.operation, "prefab.inspect");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.path, prefabPath);
      assert.equal(command.arguments.maxDepth, 4);
      assert.equal(command.arguments.maxNodes, 25);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          guid: prefabGuid,
          path: prefabPath,
          dependencyHash: prefabHash,
          prefabAssetType: "Regular",
          rootName: "Test",
          totalNodeCount: 1,
          returnedNodeCount: 1,
          maxDepth: 4,
          maxNodes: 25,
          truncatedByDepth: false,
          truncatedByNodes: false,
          nodes: [{
            relativePath: "Test",
            name: "Test",
            depth: 0,
            siblingIndex: 0,
            childCount: 0,
            activeSelf: true,
            componentTypeNames: ["UnityEngine.Transform"],
          }],
        },
        warnings: [],
        dirtyState: "unchanged",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestInspectPrefab({ path: prefabPath, maxDepth: 4, maxNodes: 25 });
    assert.equal(result.guid, prefabGuid);
    assert.equal(result.dependencyHash, prefabHash);
    assert.equal(result.nodes[0]?.componentTypeNames[0], "UnityEngine.Transform");
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("prefab instantiate sends write with asset and scene preconditions", async () => {
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
      assert.equal(command.operation, "prefab.instantiate");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.prefabPath, prefabPath);
      assert.equal(command.arguments.expectedPrefabDependencyHash, prefabHash);
      assert.equal(command.arguments.mutationId, "prefab-test-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "epoch-121");
      assert.equal(command.arguments.expectedStateRevision, 42);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "prefab-test-mutation",
          replayed: false,
          prefabGuid,
          prefabPath,
          expectedPrefabDependencyHash: prefabHash,
          globalObjectId: "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-100-0",
          instanceId: 123,
          name: "Test",
          hierarchyPath: "Test",
          sceneName: "SampleScene",
          scenePath: "Assets/Scenes/SampleScene.unity",
          siblingIndex: 2,
          expectedStateEpoch: "epoch-121",
          expectedStateRevision: 42,
          stateEpoch: "epoch-121",
          stateRevision: 43,
        },
        warnings: [],
        changedTargets: [],
        dirtyState: "dirty",
        undo: { available: true, groupName: "Unity AI Bridge: Instantiate Prefab" },
        compileState: "idle",
      }));
    });

    const result = await bridge.requestInstantiatePrefab({
      prefabPath,
      expectedPrefabDependencyHash: prefabHash,
      mutationId: "prefab-test-mutation",
      expectedStateEpoch: "epoch-121",
      expectedStateRevision: 42,
    });
    assert.equal(result.replayed, false);
    assert.equal(result.prefabGuid, prefabGuid);
    assert.equal(result.stateRevision, 43);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("prefab bridge rejects invalid path and empty hash before delivery", async () => {
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
      bridge.requestInspectPrefab({ path: "Assets/../Outside.prefab" }),
      /parent traversal/,
    );
    await assert.rejects(
      bridge.requestInstantiatePrefab({
        prefabPath,
        expectedPrefabDependencyHash: "",
        expectedStateEpoch: "epoch-121",
        expectedStateRevision: 42,
      }),
      /expectedPrefabDependencyHash/,
    );
    await delay(20);
    assert.equal(observed, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("prefab instantiate rejects invalid scene state before delivery", async () => {
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
      bridge.requestInstantiatePrefab({
        prefabPath,
        expectedPrefabDependencyHash: prefabHash,
        expectedStateEpoch: "",
        expectedStateRevision: 0,
      }),
      /expectedStateEpoch/,
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
