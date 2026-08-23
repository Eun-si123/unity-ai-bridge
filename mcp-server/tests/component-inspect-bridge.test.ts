import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { EditingBridgeServer } from "../src/bridge/editing-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "component-inspect-test-editor",
  connectionGeneration: 77,
  unityVersion: "6000.3.21f1",
  projectName: "ComponentInspectBridgeTest",
};

const gameObjectGlobalObjectId =
  "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";
const componentGlobalObjectId =
  "GlobalObjectId_V1-2-00000000000000000000000000000000-2-0";

const payload = {
  gameObject: {
    globalObjectId: gameObjectGlobalObjectId,
    instanceId: 101,
    name: "Target",
    activeSelf: true,
    activeInHierarchy: true,
    childCount: 0,
    sceneName: "SampleScene",
    scenePath: "Assets/Scenes/SampleScene.unity",
    hierarchyPath: "Target",
    siblingIndex: 0,
    sceneIsDirty: false,
    stateEpoch: "component-epoch",
    stateRevision: 20,
  },
  componentCount: 1,
  returnedComponentCount: 1,
  missingScriptCount: 0,
  truncatedByComponentLimit: false,
  maxComponents: 8,
  maxPropertiesPerComponent: 32,
  maxDepth: 3,
  components: [
    {
      index: 0,
      missingScript: false,
      globalObjectId: componentGlobalObjectId,
      instanceId: 202,
      typeName: "UnityEngine.Transform",
      assemblyQualifiedName: "UnityEngine.Transform, UnityEngine.CoreModule",
      scriptAssetPath: "",
      returnedPropertyCount: 1,
      truncatedByPropertyLimit: false,
      truncatedByDepth: false,
      properties: [
        {
          path: "m_LocalPosition",
          displayName: "Position",
          depth: 0,
          propertyType: "Vector3",
          isArray: false,
          arraySize: -1,
          hasVisibleChildren: true,
          valueKind: "vector3",
          stringValue: "(0,0,0)",
          longValue: 0,
          doubleValue: 0,
          boolValue: false,
          objectReferenceGlobalObjectId: "",
          objectReferenceInstanceId: 0,
          objectReferenceName: "",
          objectReferenceType: "",
        },
      ],
    },
  ],
  stateEpoch: "component-epoch",
  stateRevision: 20,
};

test("editing bridge sends component.inspect as bounded read request", async () => {
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

      assert.equal(command.operation, "component.inspect");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.gameObjectGlobalObjectId, gameObjectGlobalObjectId);
      assert.equal(command.arguments.maxComponents, 8);
      assert.equal(command.arguments.maxPropertiesPerComponent, 32);
      assert.equal(command.arguments.maxDepth, 3);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: payload,
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    const result = await bridge.requestInspectComponents({
      gameObjectGlobalObjectId,
      maxComponents: 8,
      maxPropertiesPerComponent: 32,
      maxDepth: 3,
    });

    assert.equal(result.components[0]?.typeName, "UnityEngine.Transform");
    assert.equal(result.components[0]?.properties[0]?.path, "m_LocalPosition");
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("editing bridge rejects invalid component limits before sending", async () => {
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
      bridge.requestInspectComponents({
        gameObjectGlobalObjectId,
        maxDepth: 9,
      }),
      /maxDepth must be an integer between 0 and 8/,
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
