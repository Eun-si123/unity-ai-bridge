import assert from "node:assert/strict";
import test from "node:test";

import { WebSocket } from "ws";

import { PrefabPropertyBridgeServer } from "../src/bridge/prefab-property-bridge-server.js";
import { BRIDGE_PROTOCOL_VERSION } from "../src/protocol/bridge.js";

const editorId = "play-mode-test-editor";

function hello(connectionGeneration: number) {
  return {
    type: "hello" as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    editorId,
    connectionGeneration,
    unityVersion: "6000.3.21f1",
    projectName: "PlayModeBridgeTest",
  };
}

function snapshot(mode: "edit" | "entering_play" | "play" | "exiting_play") {
  const isPlaying = mode === "play" || mode === "exiting_play";
  const isPlayingOrWillChangePlaymode = mode === "play" || mode === "entering_play";
  return {
    mode,
    isPlaying,
    isPaused: false,
    isPlayingOrWillChangePlaymode,
    enterPlayModeOptionsEnabled: true,
    disableDomainReload: false,
    disableSceneReload: false,
  };
}

function status(mode: "edit" | "entering_play" | "play" | "exiting_play") {
  const state = snapshot(mode);
  return {
    unityVersion: "6000.3.21f1",
    projectName: "PlayModeBridgeTest",
    activeScene: "Assets/Scenes/SampleScene.unity",
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    isPlayingOrWillChangePlaymode: state.isPlayingOrWillChangePlaymode,
    playModeState: mode,
    enterPlayModeOptionsEnabled: state.enterPlayModeOptionsEnabled,
    disableDomainReload: state.disableDomainReload,
    disableSceneReload: state.disableSceneReload,
    isCompiling: false,
    capabilities: ["editor.status", "editor.playMode.set"],
  };
}

function transitionResult(requestId: string, connectionGeneration: number) {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result: {
      mutationId: "play-mode-test-mutation",
      replayed: false,
      reconciled: false,
      changed: true,
      transitionRequested: true,
      targetMode: "play",
      expectedCurrentMode: "edit",
      requestedUnixMs: 1000,
      before: snapshot("edit"),
      afterRequest: snapshot("entering_play"),
    },
    warnings: [],
    changedTargets: [],
    dirtyState: "unchanged",
    undo: { available: false, groupName: "" },
    compileState: "idle",
    route: { editorId, connectionGeneration },
  };
}

test("play mode set sends write command and waits for a stable target without requiring reload", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(301)));
    await bridge.waitForEditor();

    client.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
        risk: string;
        arguments: Record<string, unknown>;
      };

      if (command.operation === "editor.playMode.set") {
        assert.equal(command.risk, "write");
        assert.equal(command.arguments.targetMode, "play");
        assert.equal(command.arguments.expectedCurrentMode, "edit");
        assert.equal(command.arguments.mutationId, "play-mode-test-mutation");
        client.send(JSON.stringify(transitionResult(command.requestId, 301)));
        return;
      }

      if (command.operation === "editor.status") {
        client.send(JSON.stringify({
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          requestId: command.requestId,
          ok: true,
          result: status("play"),
          warnings: [],
          dirtyState: "unchanged",
          compileState: "idle",
        }));
      }
    });

    const result = await bridge.requestSetPlayMode({
      targetMode: "play",
      expectedCurrentMode: "edit",
      mutationId: "play-mode-test-mutation",
    }, 3000);

    assert.equal(result.finalMode, "play");
    assert.equal(result.reloadObserved, false);
    assert.equal(result.initialConnectionGeneration, 301);
    assert.equal(result.finalConnectionGeneration, 301);
    assert.equal(result.changed, true);
  } finally {
    await bridge.stop();
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
});

test("play mode set survives same-editor reconnect with a new connection generation", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  let first = new WebSocket(`ws://127.0.0.1:${port}`);
  let second: WebSocket | undefined;

  try {
    await waitForOpen(first);
    first.send(JSON.stringify(hello(401)));
    await bridge.waitForEditor();

    first.on("message", (data) => {
      const command = JSON.parse(data.toString()) as {
        requestId: string;
        operation: string;
      };
      if (command.operation !== "editor.playMode.set") return;

      first.send(JSON.stringify(transitionResult(command.requestId, 401)));
      setTimeout(() => first.close(), 5);
      setTimeout(() => {
        second = new WebSocket(`ws://127.0.0.1:${port}`);
        second.on("open", () => second?.send(JSON.stringify(hello(402))));
        second.on("message", (raw) => {
          const next = JSON.parse(raw.toString()) as { requestId: string; operation: string };
          if (next.operation !== "editor.status") return;
          second?.send(JSON.stringify({
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            requestId: next.requestId,
            ok: true,
            result: status("play"),
            warnings: [],
            dirtyState: "unchanged",
            compileState: "idle",
          }));
        });
      }, 20);
    });

    const result = await bridge.requestSetPlayMode({
      targetMode: "play",
      expectedCurrentMode: "edit",
      mutationId: "play-mode-test-mutation",
    }, 4000);

    assert.equal(result.finalMode, "play");
    assert.equal(result.reloadObserved, true);
    assert.equal(result.initialConnectionGeneration, 401);
    assert.equal(result.finalConnectionGeneration, 402);
  } finally {
    await bridge.stop();
    if (first.readyState !== WebSocket.CLOSED) first.terminate();
    if (second !== undefined && second.readyState !== WebSocket.CLOSED) second.terminate();
  }
});

test("play mode bridge rejects transition states and bad mutation ids before delivery", async () => {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  const port = await bridge.start();
  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify(hello(501)));
    await bridge.waitForEditor();
    let observed = false;
    client.on("message", () => { observed = true; });

    await assert.rejects(
      bridge.requestSetPlayMode({
        targetMode: "entering_play" as never,
        expectedCurrentMode: "edit",
      }),
      /targetMode/,
    );
    await assert.rejects(
      bridge.requestSetPlayMode({
        targetMode: "play",
        expectedCurrentMode: "exiting_play" as never,
      }),
      /expectedCurrentMode/,
    );
    await assert.rejects(
      bridge.requestSetPlayMode({
        targetMode: "play",
        expectedCurrentMode: "edit",
        mutationId: "bad mutation id",
      }),
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
