import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import {
  LocalBridgeServer,
  type BridgeHello,
  type DiagnosticsPayload,
} from "../src/bridge/local-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello: BridgeHello = {
  type: "hello",
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "test-editor-diagnostics",
  connectionGeneration: 5678,
  unityVersion: "6000.3.21f1",
  projectName: "BridgeDiagnosticsTest",
};

const diagnostics: DiagnosticsPayload = {
  consoleCounts: {
    errors: 2,
    warnings: 3,
    logs: 4,
  },
  isCompiling: false,
  captureStartedUnixMs: 1000,
  minimumSeverity: "warning",
  maxEntries: 25,
  consoleEntryCoverage: "captured_since_current_domain_load",
  compilerCoverage: "latest_compilation_observed_by_compilation_pipeline",
  consoleEntriesTruncated: false,
  compilerMessagesTruncated: false,
  recentConsoleEntries: [
    {
      timestampUnixMs: 2000,
      severity: "warning",
      message: "Example warning",
      stackTrace: "",
    },
    {
      timestampUnixMs: 3000,
      severity: "error",
      message: "Example error",
      stackTrace: "Example stack",
    },
  ],
  latestCompilation: {
    sequence: 3,
    completedUnixMs: 4000,
    truncated: false,
    messages: [
      {
        severity: "error",
        message: "; expected",
        file: "Assets/Broken.cs",
        line: 10,
        column: 20,
        assemblyPath: "Library/ScriptAssemblies/Assembly-CSharp.dll",
      },
    ],
  },
};

test("local bridge requests bounded editor diagnostics as a read", async () => {
  const bridge = new LocalBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        protocolVersion: string;
        requestId: string;
        operation: string;
        arguments: { maxEntries: number; minimumSeverity: string };
        risk: string;
        route: { editorId: string; connectionGeneration: number };
      };

      assert.equal(command.protocolVersion, BRIDGE_PROTOCOL_VERSION);
      assert.equal(command.operation, "editor.diagnostics");
      assert.equal(command.risk, "read");
      assert.deepEqual(command.arguments, {
        maxEntries: 25,
        minimumSeverity: "warning",
      });
      assert.equal(command.route.editorId, hello.editorId);
      assert.equal(command.route.connectionGeneration, hello.connectionGeneration);

      client.send(
        JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: diagnostics,
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }),
      );
    });

    assert.deepEqual(
      await bridge.requestDiagnostics({
        maxEntries: 25,
        minimumSeverity: "warning",
      }),
      diagnostics,
    );
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) {
      client.terminate();
    }
  }
});

test("local bridge rejects invalid diagnostics options before delivery", async () => {
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
      bridge.requestDiagnostics({ maxEntries: 0 }),
      /maxEntries must be an integer between 1 and 200/,
    );
    await assert.rejects(
      bridge.requestDiagnostics({ minimumSeverity: "trace" as never }),
      /minimumSeverity must be one of/,
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
