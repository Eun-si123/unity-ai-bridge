import { LocalBridgeServer, type BridgeHello } from "../bridge/local-bridge-server.js";

const initialTimeoutMs = 30_000;
const reconnectTimeoutMs = 90_000;
const pollIntervalMs = 200;
const bridge = new LocalBridgeServer();

try {
  const port = await bridge.start();
  console.log(`[Unity AI Bridge] Reconnect verifier listening on ws://127.0.0.1:${port}`);
  console.log(`[Unity AI Bridge] Waiting up to ${initialTimeoutMs / 1000}s for the initial Unity hello...`);

  const initialHello = await bridge.waitForEditor(initialTimeoutMs);
  console.log("[Unity AI Bridge] Initial Unity connection:");
  console.log(JSON.stringify(initialHello, null, 2));

  const initialStatus = await bridge.requestEditorStatus(5_000);
  console.log("[Unity AI Bridge] Initial editor.status PASS:");
  console.log(JSON.stringify(initialStatus, null, 2));

  console.log("");
  console.log("[Unity AI Bridge] Trigger a Unity script/domain reload now.");
  console.log("[Unity AI Bridge] Example: in Unity, select a Unity AI Bridge .cs file and Reimport it.");
  console.log(`[Unity AI Bridge] Waiting up to ${reconnectTimeoutMs / 1000}s for a new connectionGeneration...`);

  const reconnectedHello = await waitForNewGeneration(initialHello, reconnectTimeoutMs);
  console.log("[Unity AI Bridge] Reconnect detected:");
  console.log(JSON.stringify(reconnectedHello, null, 2));

  if (reconnectedHello.editorId !== initialHello.editorId) {
    throw new Error(
      `Editor identity changed across domain reload: ${initialHello.editorId} -> ${reconnectedHello.editorId}`,
    );
  }

  console.log("[Unity AI Bridge] Sending editor.status with the stale connection generation...");
  let staleRejected = false;
  try {
    await bridge.requestEditorStatusForRoute(
      {
        editorId: initialHello.editorId,
        connectionGeneration: initialHello.connectionGeneration,
      },
      5_000,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("routing/stale_connection")) {
      staleRejected = true;
      console.log(`[Unity AI Bridge] Stale generation rejection PASS: ${message}`);
    } else {
      throw error;
    }
  }

  if (!staleRejected) {
    throw new Error("Unity accepted an editor.status command targeted at the stale connection generation.");
  }

  const reconnectedStatus = await bridge.requestEditorStatus(5_000);
  console.log("[Unity AI Bridge] Post-reconnect editor.status PASS:");
  console.log(JSON.stringify(reconnectedStatus, null, 2));
  console.log("[Unity AI Bridge] Reconnect + stale-generation verification PASS.");
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Reconnect verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await bridge.stop();
}

async function waitForNewGeneration(
  initialHello: BridgeHello,
  timeoutMs: number,
): Promise<BridgeHello> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const current = bridge.connectedEditor;
    if (
      current !== undefined &&
      current.editorId === initialHello.editorId &&
      current.connectionGeneration !== initialHello.connectionGeneration
    ) {
      return current;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`No new Unity connection generation observed within ${timeoutMs} ms.`);
}