import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import {
  requestStartPlayModeTests,
  requestTestRunAnyMode,
} from "../src/bridge/playmode-test-runner-bridge.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "playmode-test-runner-bridge-editor";
const assemblyName = "EunSung.UnityAiBridge.PlayMode.Tests";
const exactTestName = "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode";

function hello(connectionGeneration: number) {
  return {
    type: "hello" as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId,
    connectionGeneration,
    unityVersion: "6000.3.21f1",
    projectName: "PlayModeTestRunnerBridgeTest",
  };
}

function runPayload(
  status: "scheduled" | "running" | "completed" | "error",
  replayed = false,
) {
  return {
    mutationId: "playmode-test-runner-mutation",
    replayed,
    runGuid: "unity-playmode-test-run-guid-1",
    status,
    testMode: "play" as const,
    assemblyName,
    testNames: [exactTestName],
    requestedUnixMs: 1000,
    startedUnixMs: status === "scheduled" ? 0 : 1100,
    finishedUnixMs: status === "completed" || status === "error" ? 1300 : 0,
    selectedTestCaseCount: status === "completed" ? 1 : 0,
    resultState: status === "completed" ? "Passed" : "",
    durationSeconds: status === "completed" ? 0.2 : 0,
    passCount: status === "completed" ? 1 : 0,
    failCount: 0,
    skipCount: 0,
    inconclusiveCount: 0,
    assertCount: status === "completed" ? 2 : 0,
    issues: [],
    issuesTruncated: false,
    errorMessage: status === "error" ? "runner failed" : "",
  };
}

function envelope(requestId: string, payload: ReturnType<typeof runPayload>) {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result: payload,
    warnings: [],
    dirtyState: "unknown",
    compileState: "idle",
  };
}

test("PlayMode Test Runner bridge schedules an exact PlayMode selection", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(801)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "test.run.playMode.start");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.assemblyName, assemblyName);
      assert.deepEqual(command.arguments.testNames, [exactTestName]);
      assert.equal(command.arguments.mutationId, "playmode-test-runner-mutation");
      client.send(JSON.stringify(envelope(command.requestId, runPayload("scheduled"))));
    });

    const result = await requestStartPlayModeTests(bridge, {
      assemblyName,
      testNames: [exactTestName],
      mutationId: "playmode-test-runner-mutation",
    }, 3000);

    assert.equal(result.testMode, "play");
    assert.equal(result.status, "scheduled");
    assert.equal(result.runGuid, "unity-playmode-test-run-guid-1");
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("generic Test Runner read accepts terminal PlayMode results", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(802)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
      };
      assert.equal(command.operation, "test.run.get");
      assert.equal(command.risk, "read");
      client.send(JSON.stringify(envelope(command.requestId, runPayload("completed"))));
    });

    const result = await requestTestRunAnyMode(bridge, "playmode-test-runner-mutation");
    assert.equal(result.testMode, "play");
    assert.equal(result.status, "completed");
    assert.equal(result.selectedTestCaseCount, 1);
    assert.equal(result.passCount, 1);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("PlayMode Test Runner start reconciles an ambiguous disconnect with the same mutationId", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const first = new WebSocket(`ws://127.0.0.1:${port}`);
  let second: WebSocket | undefined;
  let deliveries = 0;

  try {
    await waitForOpen(first);
    first.send(JSON.stringify(hello(803)));
    await bridge.waitForEditor();

    first.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        operation: string;
        arguments: Record<string, unknown>;
      };
      if (command.operation !== "test.run.playMode.start") return;
      deliveries++;
      assert.equal(command.arguments.mutationId, "playmode-test-runner-mutation");
      first.close();

      setTimeout(() => {
        second = new WebSocket(`ws://127.0.0.1:${port}`);
        second.on("open", () => second?.send(JSON.stringify(hello(804))));
        second.on("message", (raw) => {
          const retry = JSON.parse(raw.toString()) as {
            requestId: string;
            operation: string;
            arguments: Record<string, unknown>;
          };
          if (retry.operation !== "test.run.playMode.start") return;
          deliveries++;
          assert.equal(retry.arguments.mutationId, "playmode-test-runner-mutation");
          second?.send(JSON.stringify(envelope(
            retry.requestId,
            runPayload("running", true),
          )));
        });
      }, 20);
    });

    const result = await requestStartPlayModeTests(bridge, {
      assemblyName,
      testNames: [exactTestName],
      mutationId: "playmode-test-runner-mutation",
    }, 4000);

    assert.equal(result.replayed, true);
    assert.equal(result.status, "running");
    assert.equal(result.runGuid, "unity-playmode-test-run-guid-1");
    assert.equal(deliveries, 2);
  } finally {
    await bridge.stop();
    if (first.readyState !== WebSocket.CLOSED) first.terminate();
    if (second !== undefined && second.readyState !== WebSocket.CLOSED) second.terminate();
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
