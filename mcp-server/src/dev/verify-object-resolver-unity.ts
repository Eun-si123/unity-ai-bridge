import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 90_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-object-resolver-verifier",
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
    "unity_get_hierarchy",
    "unity_create_game_object",
    "unity_resolve_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; resolver/create/hierarchy tools are advertised.");
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity to connect...`);
  await waitForUnityReady();

  const suffix = Date.now();
  const name = `MCP_Resolver_Verify_${suffix}`;
  const mutationId = `verify-resolver-${randomUUID()}`;

  const created = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name, mutationId },
  });
  if (created.isError) {
    throw new Error(`Initial create failed: ${readToolText(created)}`);
  }

  const createPayload = created.structuredContent;
  if (!isCreatePayload(createPayload) || createPayload.replayed) {
    throw new Error(`Initial create returned invalid structuredContent: ${JSON.stringify(createPayload)}`);
  }

  const resolved = await resolve(createPayload.globalObjectId);
  if (
    !resolved.found ||
    resolved.canonicalGlobalObjectId !== createPayload.globalObjectId ||
    !resolved.isGameObject ||
    resolved.name !== name ||
    resolved.instanceId !== createPayload.instanceId
  ) {
    throw new Error(`Native resolver did not match the created GameObject: ${JSON.stringify(resolved)}`);
  }

  const immediateReplay = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name, mutationId },
  });
  if (immediateReplay.isError) {
    throw new Error(`Immediate same-mutation replay failed: ${readToolText(immediateReplay)}`);
  }

  const immediateReplayPayload = immediateReplay.structuredContent;
  if (
    !isCreatePayload(immediateReplayPayload) ||
    !immediateReplayPayload.replayed ||
    immediateReplayPayload.mutationId !== mutationId ||
    immediateReplayPayload.globalObjectId !== createPayload.globalObjectId ||
    immediateReplayPayload.name !== name
  ) {
    throw new Error(
      `Immediate same-mutation replay did not return the cached target: ${JSON.stringify(immediateReplayPayload)}`,
    );
  }

  console.log("[Unity AI Bridge] Create -> native readback -> immediate dedup replay PASS:");
  console.log(
    JSON.stringify(
      {
        create: createPayload,
        resolved,
        immediateReplay: immediateReplayPayload,
      },
      null,
      2,
    ),
  );
  console.log(
    "[Unity AI Bridge] NOW press Ctrl+Z once in Unity to undo the generated MCP_Resolver_Verify object. Do not perform another Editor action first.",
  );

  await waitUntilMissing(createPayload.globalObjectId);
  console.log("[Unity AI Bridge] Resolver observed found=false after Undo. Retrying the SAME mutationId...");

  const replay = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name, mutationId },
  });
  if (!replay.isError) {
    throw new Error(
      `Stale replay unexpectedly succeeded and may have recreated state: ${JSON.stringify(replay.structuredContent)}`,
    );
  }

  const replayError = readToolText(replay);
  if (!replayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Stale replay returned the wrong error: ${replayError}`);
  }

  const hierarchy = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: { maxDepth: 32, maxNodes: 500 },
  });
  if (hierarchy.isError) {
    throw new Error(`Hierarchy readback failed after stale replay: ${readToolText(hierarchy)}`);
  }

  const matches = countHierarchyName(hierarchy.structuredContent, name);
  if (matches !== 0) {
    throw new Error(`Expected no replacement object after stale replay, but hierarchyMatches=${matches}.`);
  }

  console.log("[Unity AI Bridge] Mutation transaction + stable resolver + stale replay protection PASS:");
  console.log(
    JSON.stringify(
      {
        globalObjectId: createPayload.globalObjectId,
        mutationId,
        immediateReplay: true,
        resolverAfterUndo: "found=false",
        staleReplayError: replayError,
        hierarchyMatches: matches,
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Stable resolver verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityReady(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No Unity status result received.";

  while (Date.now() < deadline) {
    const status = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!status.isError) {
      return;
    }
    lastError = readToolText(status);
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for Unity connection. Last tool error: ${lastError}`);
}

async function resolve(globalObjectId: string): Promise<ResolvePayload> {
  const result = await client.callTool({
    name: "unity_resolve_object",
    arguments: { globalObjectId },
  });
  if (result.isError) {
    const message = readToolText(result);
    if (message.includes("unsupported/operation_not_supported") && message.includes("object.resolve")) {
      throw new Error(
        "Connected Unity Editor is running an older Unity AI Bridge assembly that does not implement object.resolve. " +
          "Pull the latest branch, force Unity to reimport/recompile the Unity AI Bridge Editor scripts (or restart Unity), then rerun verify:resolver. " +
          `Raw tool error: ${message}`,
      );
    }
    throw new Error(`unity_resolve_object failed: ${message}`);
  }
  if (!isResolvePayload(result.structuredContent)) {
    throw new Error(`unity_resolve_object returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
}

async function waitUntilMissing(globalObjectId: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await resolve(globalObjectId);
    if (!result.found) {
      return;
    }
    await delay(pollIntervalMs);
  }
  throw new Error("Timed out waiting for the created object to disappear. Press Ctrl+Z in Unity while the verifier is waiting.");
}

function countHierarchyName(value: unknown, name: string): number {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Hierarchy structuredContent is invalid: ${JSON.stringify(value)}`);
  }
  const nodes = (value as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(`Hierarchy structuredContent has no nodes array: ${JSON.stringify(value)}`);
  }
  return nodes.filter(
    (node) =>
      typeof node === "object" &&
      node !== null &&
      (node as Record<string, unknown>).name === name,
  ).length;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

type CreatePayload = {
  mutationId: string;
  replayed: boolean;
  globalObjectId: string;
  instanceId: number;
  name: string;
};

type ResolvePayload = {
  requestedGlobalObjectId: string;
  found: boolean;
  canonicalGlobalObjectId: string;
  instanceId: number;
  name: string;
  objectType: string;
  isGameObject: boolean;
  isComponent: boolean;
};

function isCreatePayload(value: unknown): value is CreatePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string"
  );
}

function isResolvePayload(value: unknown): value is ResolvePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestedGlobalObjectId === "string" &&
    typeof candidate.found === "boolean" &&
    typeof candidate.canonicalGlobalObjectId === "string" &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.objectType === "string" &&
    typeof candidate.isGameObject === "boolean" &&
    typeof candidate.isComponent === "boolean"
  );
}
