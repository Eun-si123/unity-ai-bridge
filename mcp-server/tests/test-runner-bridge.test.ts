import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "test-runner-bridge-editor";
const assemblyName = "EunSung.UnityAiBridge.Editor.Tests";

function hello(connectionGeneration: number) {
  return {
    type: "hello" as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId,
    connectionGeneration,
    unityVersion: "6000.3.21f1",
    projectName: "TestRunnerBridgeTest",
  };
}

function runPayload(status: "scheduled" | "running" | "completed" | "error", replayed = false) {
  return {
    mutationId: "test-runner-mutation",
    replayed,
    runGuid: "unity-test-run-guid-1",
    status,
    testMode: "edit" as const,
    assemblyName,
    testNames: ["Example.Tests.A", "Example.Tests.B"],
    requestedUnixMs: 1000,
    startedUnixMs: status === "scheduled" ? 0 : 1100,
    finishedUnixMs: status === "completed" || status === "error" ? 1300 : 0,
    selectedTestCaseCount: status === "scheduled" ? 0 : 2,
    resultState: status === "completed" ? "Passed" : "",
    durationSeconds: status === "completed" ? 0.2 : 0,
    passCount: status === "completed" ? 2 : 0,
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

test("Test Runner bridge schedules an explicit EditMode selection and normalizes exact test names", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(701)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "test.run.editMode.start");
      assert.equal(command.risk, "write");
      assert.equal(command.arguments.assemblyName, assemblyName);
      assert.deepEqual(command.arguments.testNames, ["Example.Tests.A", "Example.Tests.B"]);
      assert.equal(command.arguments.mutationId, "test-runner-mutation");
      client.send(JSON.stringify(envelope(command.requestId, runPayload("scheduled"))));
    });

    const result = await bridge.requestStartEditModeTests({
      assemblyName,
      testNames: ["Example.Tests.B", "Example.Tests.A", "Example.Tests.A"],
      mutationId: "test-runner-mutation",
    });

    assert.equal(result.status, "scheduled");
    assert.equal(result.runGuid, "unity-test-run-guid-1");
    assert.deepEqual(result.testNames, ["Example.Tests.A", "Example.Tests.B"]);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Test Runner bridge reads terminal structured results without scheduling another run", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(702)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };
      assert.equal(command.operation, "test.run.get");
      assert.equal(command.risk, "read");
      assert.deepEqual(command.arguments, { mutationId: "test-runner-mutation" });
      client.send(JSON.stringify(envelope(command.requestId, runPayload("completed"))));
    });

    const result = await bridge.requestTestRun("test-runner-mutation");
    assert.equal(result.status, "completed");
    assert.equal(result.resultState, "Passed");
    assert.equal(result.passCount, 2);
    assert.equal(result.failCount, 0);
    assert.deepEqual(result.issues, []);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("Test Runner bridge rejects unbounded or malformed selections before delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(703)));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestStartEditModeTests({ assemblyName: `${assemblyName}.dll` }),
      /\.dll/,
    );
    await assert.rejects(
      bridge.requestStartEditModeTests({
        assemblyName,
        testNames: Array.from({ length: 65 }, (_, index) => `Example.Tests.Case${index}`),
      }),
      /64/,
    );
    await assert.rejects(
      bridge.requestStartEditModeTests({
        assemblyName,
        mutationId: "bad mutation id",
      }),
      /mutationId/,
    );
    await assert.rejects(
      bridge.requestTestRun("bad mutation id"),
      /mutationId/,
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
