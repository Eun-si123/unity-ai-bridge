import { LocalBridgeServer } from "../bridge/local-bridge-server.js";

const timeoutMs = 30_000;
const bridge = new LocalBridgeServer();

try {
  const port = await bridge.start();
  console.log(`[Unity AI Bridge] Verification bridge listening on ws://127.0.0.1:${port}`);
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for a real Unity Editor hello...`);

  const hello = await bridge.waitForEditor(timeoutMs);
  console.log("[Unity AI Bridge] Real Unity hello received:");
  console.log(JSON.stringify(hello, null, 2));

  console.log("[Unity AI Bridge] Requesting editor.status...");
  const status = await bridge.requestEditorStatus(5_000);
  console.log("[Unity AI Bridge] editor.status PASS:");
  console.log(JSON.stringify(status, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await bridge.stop();
}
