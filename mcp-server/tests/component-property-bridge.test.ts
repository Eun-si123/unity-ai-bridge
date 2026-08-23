import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { ComponentPropertyBridgeServer } from "../src/bridge/component-property-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "component-property-test-editor",
  connectionGeneration: 91,
  unityVersion: "6000.3.21f1",
  projectName: "ComponentPropertyBridgeTest",
};

const ownerId = "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-1-0";
const componentId = "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-3-0";

const componentSnapshot = {
  globalObjectId: componentId,
  instanceId: 303,
  typeName: "UnityEngine.BoxCollider",
  assemblyQualifiedName: "UnityEngine.BoxCollider, UnityEngine.PhysicsModule",
  gameObjectGlobalObjectId: ownerId,
  gameObjectInstanceId: 101,
  gameObjectName: "Target",
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  componentIndex: 1,
  stateEpoch: "component-property-epoch",
  stateRevision: 42,
};

const propertyPayload = {
  path: "m_Center",
  displayName: "Center",
  depth: 0,
  propertyType: "Vector3",
  isArray: false,
  arraySize: -1,
  hasVisibleChildren: true,
  valueKind: "vector3",
  stringValue: "(1.25,-2.5,3.75)",
  longValue: 0,
  doubleValue: 0,
  boolValue: false,
  objectReferenceGlobalObjectId: "",
  objectReferenceInstanceId: 0,
  objectReferenceName: "",
  objectReferenceType: "",
};

test("Component property bridge sends exact visible property write intent", async () => {
  const bridge = new ComponentPropertyBridgeServer("127.0.0.1", 0);
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
      assert.equal(command.operation, "component.property.set");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.componentGlobalObjectId, componentId);
      assert.equal(command.arguments.propertyPath, "m_Center");
      assert.deepEqual(command.arguments.value, {
        kind: "vector3",
        vector3Value: { x: 1.25, y: -2.5, z: 3.75 },
      });
      assert.equal(command.arguments.mutationId, "component-property-mutation");
      assert.equal(command.arguments.expectedStateEpoch, "component-property-epoch");
      assert.equal(command.arguments.expectedStateRevision, 41);

      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "component-property-mutation",
          replayed: false,
          changed: true,
          requestedComponentGlobalObjectId: componentId,
          requestedPropertyPath: "m_Center",
          requestedValue: {
            kind: "vector3",
            vector3Value: { x: 1.25, y: -2.5, z: 3.75 },
          },
          expectedStateEpoch: "component-property-epoch",
          expectedStateRevision: 41,
          component: componentSnapshot,
          property: propertyPayload,
        },
        warnings: [],
        changedTargets: [],
        dirtyState: "dirty",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestSetComponentProperty({
      componentGlobalObjectId: componentId,
      propertyPath: "m_Center",
      value: {
        kind: "vector3",
        vector3Value: { x: 1.25, y: -2.5, z: 3.75 },
      },
      mutationId: "component-property-mutation",
      expectedStateEpoch: "component-property-epoch",
      expectedStateRevision: 41,
    });

    assert.equal(result.changed, true);
    assert.equal(result.property.path, "m_Center");
    assert.equal(result.component.globalObjectId, componentId);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Component property bridge accepts boolean value contract", async () => {
  const bridge = new ComponentPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        arguments: Record<string, unknown>;
      };
      assert.deepEqual(command.arguments.value, { kind: "boolean", boolValue: true });
      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          mutationId: "component-property-bool",
          replayed: false,
          changed: true,
          requestedComponentGlobalObjectId: componentId,
          requestedPropertyPath: "m_IsTrigger",
          requestedValue: { kind: "boolean", boolValue: true },
          expectedStateEpoch: "component-property-epoch",
          expectedStateRevision: 41,
          component: componentSnapshot,
          property: { ...propertyPayload, path: "m_IsTrigger", propertyType: "Boolean", valueKind: "boolean", stringValue: "", boolValue: true, hasVisibleChildren: false },
        },
        warnings: [],
        changedTargets: [],
        dirtyState: "dirty",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestSetComponentProperty({
      componentGlobalObjectId: componentId,
      propertyPath: "m_IsTrigger",
      value: { kind: "boolean", boolValue: true },
      mutationId: "component-property-bool",
      expectedStateEpoch: "component-property-epoch",
      expectedStateRevision: 41,
    });
    assert.equal(result.property.boolValue, true);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Component property bridge rejects empty property path before sending", async () => {
  const bridge = new ComponentPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let commandObserved = false;
    client.on("message", () => { commandObserved = true; });

    await assert.rejects(
      bridge.requestSetComponentProperty({
        componentGlobalObjectId: componentId,
        propertyPath: " ",
        value: { kind: "boolean", boolValue: true },
        expectedStateEpoch: "component-property-epoch",
        expectedStateRevision: 41,
      }),
      /propertyPath is required/,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(commandObserved, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Component property bridge rejects non-finite vector before sending", async () => {
  const bridge = new ComponentPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let commandObserved = false;
    client.on("message", () => { commandObserved = true; });

    await assert.rejects(
      bridge.requestSetComponentProperty({
        componentGlobalObjectId: componentId,
        propertyPath: "m_Center",
        value: { kind: "vector3", vector3Value: { x: 1, y: Number.NaN, z: 3 } },
        expectedStateEpoch: "component-property-epoch",
        expectedStateRevision: 41,
      }),
      /vector3 Component property values require/,
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
