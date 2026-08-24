import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { ScriptBridgeServer } from "../src/bridge/script-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "script-replace-test-editor";
const scriptPath = "Assets/UnityAiBridge_ScriptReplaceVerify.cs";
const guid = "0123456789abcdef0123456789abcdef";
const beforeSha = "a".repeat(64);
const afterSha = "b".repeat(64);
const mutationId = "script-replace-test-1";
const replacement = "public class UnityAiBridge_ScriptReplaceVerify {}\n";

function hello(generation: number) {
  return {
    type: "hello" as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId,
    connectionGeneration: generation,
    unityVersion: "6000.3.21f1",
    projectName: "ScriptReplaceBridgeTest",
  };
}

test("script replace sends destructive CAS command and reports successful compilation", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(500)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = parseCommand(data);
      if (command.operation === "script.replace") {
        assert.equal(command.risk, "destructive");
        assert.equal(command.arguments.path, scriptPath);
        assert.equal(command.arguments.expectedGuid, guid);
        assert.equal(command.arguments.expectedContentSha256, beforeSha);
        assert.equal(command.arguments.content, replacement);
        assert.equal(command.arguments.mutationId, mutationId);
        sendSuccess(client, command.requestId, persistencePayload({ baselineCompilationSequence: 10 }));
        return;
      }

      if (command.operation === "editor.diagnostics") {
        sendSuccess(client, command.requestId, diagnosticsPayload(11, []));
        return;
      }

      if (command.operation === "script.read") {
        sendSuccess(client, command.requestId, readPayload(afterSha));
        return;
      }

      assert.fail(`Unexpected operation ${command.operation}`);
    });

    const result = await bridge.requestReplaceScript({
      path: scriptPath,
      expectedGuid: guid,
      expectedContentSha256: beforeSha,
      content: replacement,
      mutationId,
    }, 5_000);

    assert.equal(result.changed, true);
    assert.equal(result.compileStatus, "succeeded");
    assert.equal(result.compilerErrorCount, 0);
    assert.equal(result.contentSha256After, afterSha);
    assert.equal(result.postReloadReadbackVerified, true);
    assert.equal(result.reloadObserved, false);
    assert.equal(result.initialConnectionGeneration, 500);
    assert.equal(result.finalConnectionGeneration, 500);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("script replace keeps persistence success distinct from compiler failure", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(510)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = parseCommand(data);
      if (command.operation === "script.replace") {
        sendSuccess(client, command.requestId, persistencePayload({ baselineCompilationSequence: 20 }));
        return;
      }
      if (command.operation === "editor.diagnostics") {
        sendSuccess(client, command.requestId, diagnosticsPayload(21, [{
          severity: "error",
          message: "; expected",
          file: scriptPath,
          line: 1,
          column: 8,
          assemblyPath: "Library/ScriptAssemblies/Assembly-CSharp.dll",
        }]));
        return;
      }
      if (command.operation === "script.read") {
        sendSuccess(client, command.requestId, readPayload(afterSha));
        return;
      }
      assert.fail(`Unexpected operation ${command.operation}`);
    });

    const result = await bridge.requestReplaceScript({
      path: scriptPath,
      expectedGuid: guid,
      expectedContentSha256: beforeSha,
      content: replacement,
      mutationId: "script-replace-compile-fail",
    }, 5_000);

    assert.equal(result.contentSha256After, afterSha);
    assert.equal(result.postReloadReadbackVerified, true);
    assert.equal(result.compileStatus, "failed");
    assert.equal(result.compilerErrorCount, 1);
    assert.match(result.compilerMessages[0]?.message ?? "", /expected/);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("script replace reconciles the same mutation after a reload disconnect without another intent", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  let firstClient: WebSocket | undefined;
  let secondClient: WebSocket | undefined;
  let replaceDeliveries = 0;

  try {
    firstClient = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(firstClient);
    firstClient.send(JSON.stringify(hello(520)));
    await bridge.waitForEditor();

    firstClient.on("message", (data) => {
      const command = parseCommand(data);
      assert.equal(command.operation, "script.replace");
      replaceDeliveries++;
      assert.equal(command.arguments.mutationId, "script-replace-reload");

      firstClient?.terminate();
      void reconnectAfterReload();
    });

    const reconnectAfterReload = async (): Promise<void> => {
      await delay(25);
      secondClient = new WebSocket(`ws://127.0.0.1:${port}`);
      await waitForOpen(secondClient);
      secondClient.send(JSON.stringify(hello(521)));
      secondClient.on("message", (data) => {
        const command = parseCommand(data);
        if (command.operation === "script.replace") {
          replaceDeliveries++;
          assert.equal(command.arguments.mutationId, "script-replace-reload");
          sendSuccess(secondClient!, command.requestId, persistencePayload({
            mutationId: "script-replace-reload",
            replayed: true,
            reconciled: true,
            baselineCompilationSequence: 30,
          }));
          return;
        }
        if (command.operation === "editor.diagnostics") {
          sendSuccess(secondClient!, command.requestId, diagnosticsPayload(31, []));
          return;
        }
        if (command.operation === "script.read") {
          sendSuccess(secondClient!, command.requestId, readPayload(afterSha));
          return;
        }
        assert.fail(`Unexpected operation ${command.operation}`);
      });
    };

    const result = await bridge.requestReplaceScript({
      path: scriptPath,
      expectedGuid: guid,
      expectedContentSha256: beforeSha,
      content: replacement,
      mutationId: "script-replace-reload",
    }, 5_000);

    assert.equal(replaceDeliveries, 2);
    assert.equal(result.replayed, true);
    assert.equal(result.reconciled, true);
    assert.equal(result.compileStatus, "succeeded");
    assert.equal(result.reloadObserved, true);
    assert.equal(result.initialConnectionGeneration, 520);
    assert.equal(result.finalConnectionGeneration, 521);
  } finally {
    await bridge.stop();
    if (firstClient !== undefined && firstClient.readyState !== WebSocket.CLOSED) firstClient.terminate();
    if (secondClient !== undefined && secondClient.readyState !== WebSocket.CLOSED) secondClient.terminate();
  }
});

test("script replace rejects package paths and malformed CAS tokens before delivery", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(530)));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestReplaceScript({
        path: "Packages/com.example/Test.cs",
        expectedGuid: guid,
        expectedContentSha256: beforeSha,
        content: replacement,
      }),
      /script\.replace paths must be under Assets/,
    );
    await assert.rejects(
      bridge.requestReplaceScript({
        path: scriptPath,
        expectedGuid: "not-a-guid",
        expectedContentSha256: beforeSha,
        content: replacement,
      }),
      /expectedGuid must be exactly 32 hexadecimal characters/,
    );
    await assert.rejects(
      bridge.requestReplaceScript({
        path: scriptPath,
        expectedGuid: guid,
        expectedContentSha256: "bad",
        content: replacement,
      }),
      /expectedContentSha256 must be exactly 64 hexadecimal characters/,
    );

    await delay(20);
    assert.equal(observed, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

function persistencePayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    mutationId,
    replayed: false,
    reconciled: false,
    changed: true,
    path: scriptPath,
    guid,
    expectedGuid: guid,
    expectedContentSha256: beforeSha,
    contentSha256Before: beforeSha,
    contentSha256After: afterSha,
    hasUtf8Bom: false,
    byteLengthBefore: 40,
    byteLengthAfter: 50,
    utf16CharCountAfter: replacement.length,
    lineCountAfter: 2,
    baselineCompilationSequence: 10,
    writeCompletedUnixMs: 1_787_550_000_000,
    importRequested: true,
    importRequestedUnixMs: 1_787_550_000_001,
    importCallReturned: true,
    importError: "",
    ...overrides,
  };
}

function diagnosticsPayload(
  sequence: number,
  messages: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    consoleCounts: { errors: 0, warnings: 0, logs: 0 },
    isCompiling: false,
    captureStartedUnixMs: 1_787_550_000_000,
    minimumSeverity: "warning",
    maxEntries: 200,
    consoleEntryCoverage: "captured_since_current_domain_load",
    compilerCoverage: "latest_compilation_observed_by_compilation_pipeline",
    consoleEntriesTruncated: false,
    compilerMessagesTruncated: false,
    recentConsoleEntries: [],
    latestCompilation: {
      sequence,
      completedUnixMs: 1_787_550_000_100,
      truncated: false,
      messages,
    },
  };
}

function readPayload(sha: string): Record<string, unknown> {
  return {
    guid,
    path: scriptPath,
    sourceKind: "Assets",
    packageName: "",
    dependencyHash: "abcdefabcdefabcdefabcdefabcdefab",
    contentSha256: sha,
    encoding: "utf-8",
    hasUtf8Bom: false,
    byteLength: 50,
    utf16CharCount: replacement.length,
    lineCount: 2,
    offset: 0,
    maxChars: 1,
    returnedCharCount: 1,
    nextOffset: 1,
    truncated: true,
    content: "p",
  };
}

function parseCommand(data: WebSocket.RawData): {
  requestId: string;
  operation: string;
  risk: string;
  arguments: Record<string, unknown>;
} {
  return JSON.parse(data.toString()) as {
    requestId: string;
    operation: string;
    risk: string;
    arguments: Record<string, unknown>;
  };
}

function sendSuccess(client: WebSocket, requestId: string, result: Record<string, unknown>): void {
  client.send(JSON.stringify({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
    warnings: [],
    dirtyState: "unchanged",
    compileState: "idle",
  }));
}

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
