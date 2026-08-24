import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "prefab-property-test-editor",
  connectionGeneration: 141,
  unityVersion: "6000.3.21f1",
  projectName: "PrefabPropertyBridgeTest",
};

const componentGlobalObjectId =
  "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-101-0";
const prefabPath = "Assets/Prefabs/Test.prefab";
const hashBefore = "abcdef0123456789abcdef0123456789";
const hashAfter = "fedcba9876543210fedcba9876543210";

test("prefab property apply sends destructive command with explicit asset and concurrency preconditions", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
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
      assert.equal(command.operation, "prefab.property.apply");
      assert.equal(command.risk, "destructive");
      assert.equal(command.arguments.componentGlobalObjectId, componentGlobalObjectId);
      assert.equal(command.arguments.propertyPath, "m_LocalScale");
      assert.equal(command.arguments.prefabPath, prefabPath);
      assert.equal(command.arguments.expectedPrefabDependencyHash, hashBefore);
      assert.equal(command.arguments.mutationId, "prefab-property-bridge-test");
      assert.equal(command.arguments.expectedStateEpoch, "epoch-141");
      assert.equal(command.arguments.expectedStateRevision, 55);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "prefab-property-bridge-test",
          replayed: false,
          applied: true,
          componentGlobalObjectId,
          componentTypeName: "UnityEngine.Transform",
          propertyPath: "m_LocalScale",
          prefabPath,
          prefabGuid: "1234567890abcdef1234567890abcdef",
          expectedPrefabDependencyHash: hashBefore,
          dependencyHashBefore: hashBefore,
          dependencyHashAfter: hashAfter,
          expectedStateEpoch: "epoch-141",
          expectedStateRevision: 55,
          stateEpoch: "epoch-141",
          stateRevision: 56,
        },
        warnings: ["persistent disk write"],
        changedTargets: [],
        dirtyState: "unknown",
        undo: { available: false, groupName: "" },
        compileState: "idle",
      }));
    });

    const result = await bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId,
      propertyPath: "m_LocalScale",
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: "prefab-property-bridge-test",
      expectedStateEpoch: "epoch-141",
      expectedStateRevision: 55,
    });

    assert.equal(result.applied, true);
    assert.equal(result.replayed, false);
    assert.equal(result.dependencyHashAfter, hashAfter);
    assert.equal(result.stateRevision, 56);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("prefab property apply rejects broad or stale-looking inputs before delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestApplyPrefabPropertyOverride({
        componentGlobalObjectId,
        propertyPath: "items.Array.data[0]",
        prefabPath,
        expectedPrefabDependencyHash: hashBefore,
        expectedStateEpoch: "epoch-141",
        expectedStateRevision: 55,
      }),
      /Array/,
    );
    await assert.rejects(
      bridge.requestApplyPrefabPropertyOverride({
        componentGlobalObjectId,
        propertyPath: "m_LocalScale",
        prefabPath: "Packages/example/Test.prefab",
        expectedPrefabDependencyHash: hashBefore,
        expectedStateEpoch: "epoch-141",
        expectedStateRevision: 55,
      }),
      /under Assets/,
    );
    await assert.rejects(
      bridge.requestApplyPrefabPropertyOverride({
        componentGlobalObjectId,
        propertyPath: "m_LocalScale",
        prefabPath,
        expectedPrefabDependencyHash: "",
        expectedStateEpoch: "epoch-141",
        expectedStateRevision: 55,
      }),
      /expectedPrefabDependencyHash/,
    );
    await assert.rejects(
      bridge.requestApplyPrefabPropertyOverride({
        componentGlobalObjectId,
        propertyPath: "m_LocalScale",
        prefabPath,
        expectedPrefabDependencyHash: hashBefore,
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
