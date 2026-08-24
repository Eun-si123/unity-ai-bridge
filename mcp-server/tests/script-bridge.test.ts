import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { ScriptBridgeServer } from "../src/bridge/script-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const hello = {
  type: "hello" as const,
  protocolVersion: BRIDGE_PROTOCOL_VERSION,
  editorId: "script-read-test-editor",
  connectionGeneration: 404,
  unityVersion: "6000.3.21f1",
  projectName: "ScriptReadBridgeTest",
};

const scriptPath = "Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs";

test("script read sends bounded read command and validates payload", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
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
      assert.equal(command.operation, "script.read");
      assert.equal(command.risk, "read");
      assert.equal(command.arguments.path, scriptPath);
      assert.equal(command.arguments.offset, 10);
      assert.equal(command.arguments.maxChars, 20);

      const content = "public class Bridge";
      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          guid: "0123456789abcdef0123456789abcdef",
          path: scriptPath,
          sourceKind: "Packages",
          packageName: "com.eunsung.unity-ai-bridge",
          dependencyHash: "abcdefabcdefabcdefabcdefabcdefab",
          contentSha256: "a".repeat(64),
          encoding: "utf-8",
          hasUtf8Bom: false,
          byteLength: 200,
          utf16CharCount: 100,
          lineCount: 6,
          offset: 10,
          maxChars: 20,
          returnedCharCount: content.length,
          nextOffset: 10 + content.length,
          truncated: true,
          content,
        },
        warnings: [],
        dirtyState: "unchanged",
        compileState: "idle",
      }));
    });

    const result = await bridge.requestReadScript({ path: scriptPath, offset: 10, maxChars: 20 });
    assert.equal(result.path, scriptPath);
    assert.equal(result.content, "public class Bridge");
    assert.equal(result.contentSha256, "a".repeat(64));
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("script read rejects unsafe paths and out-of-range offsets before delivery", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestReadScript({ path: "Assets/../ProjectSettings/Secrets.cs" }),
      /must not contain empty, '\.' or '\.\.' segments/,
    );
    await assert.rejects(
      bridge.requestReadScript({ path: "Assets/Safe.cs", offset: 2_147_483_648 }),
      /offset must be an integer in the range 0\.\.2147483647/,
    );
    await assert.rejects(
      bridge.requestReadScript({ path: "Assets/Safe.txt" }),
      /require an exact \.cs asset path/,
    );

    await delay(20);
    assert.equal(observed, false);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("script read rejects internally inconsistent Unity payloads", async () => {
  const bridge = new ScriptBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as { requestId: string };
      client.send(JSON.stringify({
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        requestId: command.requestId,
        ok: true,
        result: {
          guid: "0123456789abcdef0123456789abcdef",
          path: scriptPath,
          sourceKind: "Packages",
          packageName: "com.eunsung.unity-ai-bridge",
          dependencyHash: "abcdefabcdefabcdefabcdefabcdefab",
          contentSha256: "b".repeat(64),
          encoding: "utf-8",
          hasUtf8Bom: false,
          byteLength: 100,
          utf16CharCount: 20,
          lineCount: 2,
          offset: 0,
          maxChars: 10,
          returnedCharCount: 5,
          nextOffset: 4,
          truncated: true,
          content: "hello",
        },
        warnings: [],
        dirtyState: "unchanged",
        compileState: "idle",
      }));
    });

    await assert.rejects(
      bridge.requestReadScript({ path: scriptPath, maxChars: 10 }),
      /invalid script\.read payload/,
    );
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
