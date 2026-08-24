import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { requestListTests } from "../src/bridge/test-discovery-bridge.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "test-discovery-editor";

function hello(connectionGeneration: number) {
  return {
    type: "hello" as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId,
    connectionGeneration,
    unityVersion: "6000.3.21f1",
    projectName: "TestDiscoveryBridgeTest",
  };
}

function envelope(requestId: string, result: Record<string, unknown>) {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
    warnings: [],
    dirtyState: "unchanged",
    compileState: "idle",
  };
}

test("Test discovery lists bounded assemblies from Unity native test tree", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(901)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "test.list");
      assert.equal(command.risk, "read");
      assert.deepEqual(command.arguments, {
        testMode: "edit",
        assemblyName: "",
        nameContains: "UnityAiBridge",
        offset: 0,
        maxResults: 20,
      });
      client.send(JSON.stringify(envelope(command.requestId, {
        testMode: "edit",
        scope: "assemblies",
        assemblyName: "",
        nameContains: "UnityAiBridge",
        totalMatches: 1,
        offset: 0,
        maxResults: 20,
        returnedCount: 1,
        nextOffset: 1,
        truncated: false,
        assemblies: [
          { name: "EunSung.UnityAiBridge.Editor.Tests", testCaseCount: 100 },
        ],
        tests: [],
      })));
    });

    const result = await requestListTests(bridge, {
      testMode: "edit",
      nameContains: "UnityAiBridge",
      maxResults: 20,
    });
    assert.equal(result.scope, "assemblies");
    assert.equal(result.returnedCount, 1);
    assert.equal(result.assemblies[0]?.name, "EunSung.UnityAiBridge.Editor.Tests");
    assert.equal(result.assemblies[0]?.testCaseCount, 100);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Test discovery lists exact leaf full names with deterministic paging metadata", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(902)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "test.list");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.testMode, "play");
      assert.equal(command.arguments.assemblyName, "EunSung.UnityAiBridge.PlayMode.Tests");
      assert.equal(command.arguments.nameContains, "RunsOneFrame");
      assert.equal(command.arguments.offset, 0);
      assert.equal(command.arguments.maxResults, 1);

      client.send(JSON.stringify(envelope(command.requestId, {
        testMode: "play",
        scope: "tests",
        assemblyName: "EunSung.UnityAiBridge.PlayMode.Tests",
        nameContains: "RunsOneFrame",
        totalMatches: 1,
        offset: 0,
        maxResults: 1,
        returnedCount: 1,
        nextOffset: 1,
        truncated: false,
        assemblies: [],
        tests: [
          {
            name: "RunsOneFrameInsidePlayMode",
            fullName: "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode",
            uniqueName: "PlayMode.Tests/UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests/RunsOneFrameInsidePlayMode",
            parentFullName: "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests",
            runState: "Runnable",
            categories: [],
            selectableByBridge: true,
          },
        ],
      })));
    });

    const result = await requestListTests(bridge, {
      testMode: "play",
      assemblyName: "EunSung.UnityAiBridge.PlayMode.Tests",
      nameContains: "RunsOneFrame",
      offset: 0,
      maxResults: 1,
    });
    assert.equal(result.scope, "tests");
    assert.equal(result.tests.length, 1);
    assert.equal(
      result.tests[0]?.fullName,
      "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode",
    );
    assert.equal(result.tests[0]?.selectableByBridge, true);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Test discovery rejects malformed bounds before Unity delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(903)));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      requestListTests(bridge, { testMode: "edit", assemblyName: "Example.Tests.dll" }),
      /\.dll/,
    );
    await assert.rejects(
      requestListTests(bridge, { testMode: "edit", assemblyName: "   " }),
      /whitespace/,
    );
    await assert.rejects(
      requestListTests(bridge, { testMode: "edit", offset: -1 }),
      /offset/,
    );
    await assert.rejects(
      requestListTests(bridge, { testMode: "edit", maxResults: 201 }),
      /200/,
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
