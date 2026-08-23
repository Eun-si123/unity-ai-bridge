import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "prefab-property-test-editor",
  connectionGeneration: 130,
  unityVersion: "6000.3.21f1",
  projectName: "PrefabPropertyBridgeTest",
};

const componentId = "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-102-0";
const gameObjectId = "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-101-0";
const prefabPath = "Assets/Prefabs/Test.prefab";
const hashBefore = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashAfter = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function propertyPayload() {
  return {
    path: "m_IsTrigger",
    displayName: "Is Trigger",
    depth: 0,
    propertyType: "Boolean",
    isArray: false,
    arraySize: -1,
    hasVisibleChildren: false,
    valueKind: "boolean",
    stringValue: "",
    longValue: 0,
    doubleValue: 0,
    boolValue: true,
    objectReferenceGlobalObjectId: "",
    objectReferenceInstanceId: 0,
    objectReferenceName: "",
    objectReferenceType: "",
  };
}

test("prefab property apply sends destructive single-property command", async () => {
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
      assert.equal(command.arguments.componentGlobalObjectId, componentId);
      assert.equal(command.arguments.propertyPath, "m_IsTrigger");
      assert.equal(command.arguments.prefabPath, prefabPath);
      assert.equal(command.arguments.expectedPrefabDependencyHash, hashBefore);
      assert.equal(command.arguments.mutationId, "prefab-property-test-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "epoch-130");
      assert.equal(command.arguments.expectedStateRevision, 62);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "prefab-property-test-mutation",
          replayed: false,
          applied: true,
          componentGlobalObjectId: componentId,
          gameObjectGlobalObjectId: gameObjectId,
          propertyPath: "m_IsTrigger",
          propertyType: "Boolean",
          prefabPath,
          prefabGuid: "1234567890abcdef1234567890abcdef",
          expectedPrefabDependencyHash: hashBefore,
          dependencyHashAfter: hashAfter,
          prefabOverrideBefore: true,
          prefabOverrideAfter: false,
          sourceMatchesInstanceAfter: true,
          sceneWasDirtyBefore: true,
          sceneIsDirtyAfter: true,
          expectedStateEpoch: "epoch-130",
          expectedStateRevision: 62,
          stateEpoch: "epoch-130",
          stateRevision: 63,
          property: propertyPayload(),
        },
        warnings: [],
        changedTargets: [],
        dirtyState: "dirty",
        undo: { available: false, groupName: "" },
        compileState: "idle",
      }));
    });

    const result = await bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: componentId,
      propertyPath: "m_IsTrigger",
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: "prefab-property-test-mutation",
      expectedStateEpoch: "epoch-130",
      expectedStateRevision: 62,
    });

    assert.equal(result.applied, true);
    assert.equal(result.replayed, false);
    assert.equal(result.dependencyHashAfter, hashAfter);
    assert.equal(result.prefabOverrideAfter, false);
    assert.equal(result.sourceMatchesInstanceAfter, true);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("prefab property apply rejects invalid asset/hash/state before delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: componentId,
      propertyPath: "m_IsTrigger",
      prefabPath: "Packages/com.example/Test.prefab",
      expectedPrefabDependencyHash: hashBefore,
      expectedStateEpoch: "epoch-130",
      expectedStateRevision: 62,
    }), /Assets/);

    await assert.rejects(bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: componentId,
      propertyPath: "m_IsTrigger",
      prefabPath,
      expectedPrefabDependencyHash: "",
      expectedStateEpoch: "epoch-130",
      expectedStateRevision: 62,
    }), /expectedPrefabDependencyHash/);

    await assert.rejects(bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: componentId,
      propertyPath: "m_IsTrigger",
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      expectedStateEpoch: "",
      expectedStateRevision: 0,
    }), /expectedStateEpoch/);

    await delay(20);
    assert.equal(observed, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("prefab property apply rejects invalid component/property/mutation id before delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: "not-a-global-id",
      propertyPath: "m_IsTrigger",
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      expectedStateEpoch: "epoch-130",
      expectedStateRevision: 62,
    }), /GlobalObjectId/);

    await assert.rejects(bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: componentId,
      propertyPath: "",
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      expectedStateEpoch: "epoch-130",
      expectedStateRevision: 62,
    }), /propertyPath/);

    await assert.rejects(bridge.requestApplyPrefabPropertyOverride({
      componentGlobalObjectId: componentId,
      propertyPath: "m_IsTrigger",
      prefabPath,
      expectedPrefabDependencyHash: hashBefore,
      mutationId: "bad mutation id",
      expectedStateEpoch: "epoch-130",
      expectedStateRevision: 62,
    }), /mutationId/);

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
