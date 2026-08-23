import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  LocalBridgeServer,
  type BridgeHello,
  type GameObjectCreatePayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "test-editor-create",
  connectionGeneration: 4321,
  unityVersion: "6000.3.21f1",
  projectName: "BridgeCreateTest",
};

const baseResult: Omit<
  GameObjectCreatePayload,
  | "mutationId"
  | "replayed"
  | "expectedStateEpoch"
  | "expectedStateRevision"
  | "stateEpoch"
  | "stateRevision"
> = {
  globalObjectId: "GlobalObjectId_V1-2-created-0-0",
  instanceId: 777,
  name: "BridgeCreated",
  hierarchyPath: "BridgeCreated",
  sceneName: "SampleScene",
  scenePath: "Assets/Scenes/SampleScene.unity",
  siblingIndex: 3,
};

function resultPayload(
  mutationId: string,
  replayed: boolean,
  expectedStateEpoch = "",
  expectedStateRevision = 0,
  stateRevision = 41,
): GameObjectCreatePayload {
  return {
    mutationId,
    replayed,
    ...baseResult,
    expectedStateEpoch,
    expectedStateRevision,
    stateEpoch: "test-state-epoch",
    stateRevision,
  };
}

test("local bridge sends gameObject.create as a write and validates the result", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const mutationId = "create-test-1";

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        protocolVersion: string;
        requestId: string;
        operation: string;
        arguments: { name: string; mutationId: string };
        risk: string;
        route: { editorId: string; connectionGeneration: number };
      };

      assert.equal(command.protocolVersion, BRIDGE_PROTOCOL_VERSION);
      assert.equal(command.operation, "gameObject.create");
      assert.equal(command.risk, "write");
      assert.deepEqual(command.arguments, { name: "BridgeCreated", mutationId });
      assert.equal(command.route.editorId, hello.editorId);
      assert.equal(command.route.connectionGeneration, hello.connectionGeneration);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: resultPayload(mutationId, false),
          warnings: [],
          changedTargets: [
            {
              globalObjectId: baseResult.globalObjectId,
              instanceId: baseResult.instanceId,
              name: baseResult.name,
            },
          ],
          dirtyState: "dirty",
          undo: {
            available: true,
            groupName: "Unity AI Bridge: Create GameObject",
          },
          compileState: "idle",
        }),
      );
    });

    assert.deepEqual(
      await bridge.requestCreateGameObject({ name: "BridgeCreated", mutationId }),
      resultPayload(mutationId, false),
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge preserves the same mutationId across an explicit retry", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const mutationId = "create-retry-1";
  const requestIds: string[] = [];
  let deliveries = 0;

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        arguments: { name: string; mutationId: string };
        risk: string;
      };

      deliveries += 1;
      requestIds.push(command.requestId);
      assert.equal(command.operation, "gameObject.create");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.name, "BridgeCreated");
      assert.equal(command.arguments.mutationId, mutationId);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: resultPayload(mutationId, deliveries > 1, "", 0, 41 + deliveries),
          warnings: [],
          dirtyState: deliveries > 1 ? "unchanged" : "dirty",
          compileState: "idle",
        }),
      );
    });

    const first = await bridge.requestCreateGameObject({ name: "BridgeCreated", mutationId });
    const second = await bridge.requestCreateGameObject({ name: "BridgeCreated", mutationId });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(first.globalObjectId, second.globalObjectId);
    assert.equal(deliveries, 2);
    assert.equal(requestIds.length, 2);
    assert.notEqual(requestIds[0], requestIds[1]);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge forwards an optimistic state precondition and surfaces stale-state rejection", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  const mutationId = "create-stale-state-1";

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "gameObject.create");
      assert.deepEqual(command.arguments, {
        name: "BridgeCreated",
        mutationId,
        expectedStateEpoch: "snapshot-epoch",
        expectedStateRevision: 7,
      });

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: false,
          error: {
            category: "stale_state",
            code: "state_revision_mismatch",
            message: "State revision mismatch. expected=7, current=8.",
          },
          warnings: [],
        }),
      );
    });

    await assert.rejects(
      bridge.requestCreateGameObject({
        name: "BridgeCreated",
        mutationId,
        expectedStateEpoch: "snapshot-epoch",
        expectedStateRevision: 7,
      }),
      /stale_state\/state_revision_mismatch/,
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects invalid GameObject create input before delivery", async () => {
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

    await assert.rejects(
      bridge.requestCreateGameObject({ name: "   ", mutationId: "valid-id" }),
      /name must contain at least one non-whitespace character/,
    );
    await assert.rejects(
      bridge.requestCreateGameObject({ name: "Valid", mutationId: "bad id with spaces" }),
      /mutationId must be 1\.\.128 characters/,
    );
    await assert.rejects(
      bridge.requestCreateGameObject({
        name: "Valid",
        mutationId: "valid-id",
        expectedStateEpoch: "epoch-only",
      }),
      /expectedStateEpoch and expectedStateRevision must be supplied together/,
    );

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
