import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const epsilon = 0.01;

const client = new Client({
  name: "unity-ai-bridge-transform-verifier",
  version: "0.0.1",
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of [
    "unity_get_status",
    "unity_create_game_object",
    "unity_resolve_object",
    "unity_get_transform",
    "unity_set_transform",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity transform capabilities...`);
  await waitForUnityReady();

  const name = `MCP_Transform_Verify_${Date.now()}`;
  const createMutationId = `verify-transform-create-${randomUUID()}`;
  const createdResult = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name, mutationId: createMutationId },
  });
  if (createdResult.isError || !isCreatePayload(createdResult.structuredContent)) {
    throw new Error(`Temporary GameObject create failed: ${readToolText(createdResult)}`);
  }
  const created = createdResult.structuredContent;

  const initial = await getTransform(created.globalObjectId);
  const mutationId = `verify-transform-set-${randomUUID()}`;
  const requested = {
    localPosition: { x: 1.25, y: -2.5, z: 3.75 },
    localEulerAngles: { x: 15, y: 30, z: 45 },
    localScale: { x: 1.5, y: 0.75, z: 2 },
  };

  const setResult = await client.callTool({
    name: "unity_set_transform",
    arguments: {
      globalObjectId: created.globalObjectId,
      ...requested,
      mutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (setResult.isError || !isSetPayload(setResult.structuredContent)) {
    throw new Error(`transform.set failed: ${readToolText(setResult)}`);
  }
  const setPayload = setResult.structuredContent;
  if (setPayload.replayed) {
    throw new Error("First transform.set unexpectedly reported replayed=true.");
  }
  assertRequestedTransform(setPayload.transform, requested, "first transform.set readback");

  const readback = await getTransform(created.globalObjectId);
  assertRequestedTransform(readback, requested, "transform.get after write");
  assertQuaternionNear(
    readback.localRotation,
    setPayload.transform.localRotation,
    "transform.get quaternion differs from transaction native readback",
  );

  const replayResult = await client.callTool({
    name: "unity_set_transform",
    arguments: {
      globalObjectId: created.globalObjectId,
      ...requested,
      mutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (replayResult.isError || !isSetPayload(replayResult.structuredContent)) {
    throw new Error(`Immediate transform replay failed: ${readToolText(replayResult)}`);
  }
  if (!replayResult.structuredContent.replayed) {
    throw new Error("Immediate same-id transform retry did not report replayed=true.");
  }

  console.log("[Unity AI Bridge] Transform write + native readback + same-id replay PASS:");
  console.log(
    JSON.stringify(
      {
        target: created.globalObjectId,
        initial,
        set: setPayload,
        readback,
        replayed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo only the Transform change. Do not perform another Editor action first.",
  );

  await waitForTransform(created.globalObjectId, initial);

  const staleReplay = await client.callTool({
    name: "unity_set_transform",
    arguments: {
      globalObjectId: created.globalObjectId,
      ...requested,
      mutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (!staleReplay.isError) {
    throw new Error(
      `Transform replay unexpectedly reapplied state after Undo: ${JSON.stringify(staleReplay.structuredContent)}`,
    );
  }
  const staleReplayError = readToolText(staleReplay);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Transform stale replay returned the wrong error: ${staleReplayError}`);
  }

  console.log(
    "[Unity AI Bridge] Transform Undo + stale replay rejection PASS. NOW press Ctrl+Z ONCE more to remove the temporary MCP_Transform_Verify GameObject.",
  );
  await waitUntilMissing(created.globalObjectId);

  console.log("[Unity AI Bridge] Transform read/write reliability PASS:");
  console.log(
    JSON.stringify(
      {
        globalObjectId: created.globalObjectId,
        transformMutationId: mutationId,
        writeVerified: true,
        immediateReplay: true,
        undoRestoredInitialTransform: true,
        staleReplayError,
        temporaryObjectRemoved: true,
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Transform verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityReady(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No Unity status result received.";

  while (Date.now() < deadline) {
    const statusResult = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!statusResult.isError && isStatusPayload(statusResult.structuredContent)) {
      const capabilities = statusResult.structuredContent.capabilities;
      if (
        capabilities.includes("transform.get") &&
        capabilities.includes("transform.set") &&
        capabilities.includes("state.revision.v1")
      ) {
        return;
      }
      lastError = `Connected Agent capabilities are stale: ${capabilities.join(", ")}`;
    } else {
      lastError = readToolText(statusResult);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for transform-capable Unity Agent. Last observation: ${lastError}. Reimport/recompile the package or restart Unity if it is still running an older assembly.`,
  );
}

async function getTransform(globalObjectId: string): Promise<TransformPayload> {
  const result = await client.callTool({
    name: "unity_get_transform",
    arguments: { globalObjectId },
  });
  if (result.isError || !isTransformPayload(result.structuredContent)) {
    throw new Error(`unity_get_transform failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

async function waitForTransform(
  globalObjectId: string,
  expected: TransformPayload,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getTransform(globalObjectId);
    if (
      vectorNear(current.localPosition, expected.localPosition) &&
      vectorNear(current.localScale, expected.localScale) &&
      quaternionNear(current.localRotation, expected.localRotation)
    ) {
      return;
    }
    await delay(pollIntervalMs);
  }
  throw new Error("Timed out waiting for Ctrl+Z to restore the original Transform.");
}

async function waitUntilMissing(globalObjectId: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_resolve_object",
      arguments: { globalObjectId },
    });
    if (!result.isError && isResolvePayload(result.structuredContent) && !result.structuredContent.found) {
      return;
    }
    await delay(pollIntervalMs);
  }
  throw new Error("Timed out waiting for the temporary GameObject to disappear after the second Ctrl+Z.");
}

function assertRequestedTransform(
  actual: TransformPayload,
  expected: {
    localPosition: Vector3Payload;
    localEulerAngles: Vector3Payload;
    localScale: Vector3Payload;
  },
  context: string,
): void {
  if (!vectorNear(actual.localPosition, expected.localPosition)) {
    throw new Error(`${context}: localPosition mismatch: ${JSON.stringify(actual.localPosition)}`);
  }
  if (!vectorNear(actual.localEulerAngles, expected.localEulerAngles)) {
    throw new Error(`${context}: localEulerAngles mismatch: ${JSON.stringify(actual.localEulerAngles)}`);
  }
  if (!vectorNear(actual.localScale, expected.localScale)) {
    throw new Error(`${context}: localScale mismatch: ${JSON.stringify(actual.localScale)}`);
  }
}

function assertQuaternionNear(actual: QuaternionPayload, expected: QuaternionPayload, message: string): void {
  if (!quaternionNear(actual, expected)) {
    throw new Error(`${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function vectorNear(left: Vector3Payload, right: Vector3Payload): boolean {
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.z - right.z) <= epsilon
  );
}

function quaternionNear(left: QuaternionPayload, right: QuaternionPayload): boolean {
  const direct =
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.z - right.z) <= epsilon &&
    Math.abs(left.w - right.w) <= epsilon;
  const negated =
    Math.abs(left.x + right.x) <= epsilon &&
    Math.abs(left.y + right.y) <= epsilon &&
    Math.abs(left.z + right.z) <= epsilon &&
    Math.abs(left.w + right.w) <= epsilon;
  return direct || negated;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Vector3Payload = { x: number; y: number; z: number };
type QuaternionPayload = { x: number; y: number; z: number; w: number };
type CreatePayload = { globalObjectId: string; mutationId: string; replayed: boolean };
type ResolvePayload = { found: boolean };
type StatusPayload = { capabilities: string[] };
type TransformPayload = {
  globalObjectId: string;
  localPosition: Vector3Payload;
  localEulerAngles: Vector3Payload;
  localRotation: QuaternionPayload;
  localScale: Vector3Payload;
  stateEpoch: string;
  stateRevision: number;
};
type SetPayload = {
  mutationId: string;
  replayed: boolean;
  transform: TransformPayload;
};

function isCreatePayload(value: unknown): value is CreatePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.mutationId === "string" &&
    typeof candidate.replayed === "boolean"
  );
}

function isResolvePayload(value: unknown): value is ResolvePayload {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).found === "boolean";
}

function isStatusPayload(value: unknown): value is StatusPayload {
  if (typeof value !== "object" || value === null) return false;
  const capabilities = (value as Record<string, unknown>).capabilities;
  return Array.isArray(capabilities) && capabilities.every((entry) => typeof entry === "string");
}

function isSetPayload(value: unknown): value is SetPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    typeof candidate.replayed === "boolean" &&
    isTransformPayload(candidate.transform)
  );
}

function isTransformPayload(value: unknown): value is TransformPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    isVector(candidate.localPosition) &&
    isVector(candidate.localEulerAngles) &&
    isQuaternion(candidate.localRotation) &&
    isVector(candidate.localScale) &&
    typeof candidate.stateEpoch === "string" &&
    candidate.stateEpoch.length > 0 &&
    typeof candidate.stateRevision === "number" &&
    Number.isSafeInteger(candidate.stateRevision) &&
    candidate.stateRevision > 0
  );
}

function isVector(value: unknown): value is Vector3Payload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.x, candidate.y, candidate.z].every(
    (entry) => typeof entry === "number" && Number.isFinite(entry),
  );
}

function isQuaternion(value: unknown): value is QuaternionPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.x, candidate.y, candidate.z, candidate.w].every(
    (entry) => typeof entry === "number" && Number.isFinite(entry),
  );
}
