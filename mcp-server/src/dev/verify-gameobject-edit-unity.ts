import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-gameobject-edit-verifier",
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
    "unity_update_game_object",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; waiting for Unity...");
  await waitForUnityReady();

  const suffix = Date.now();
  const originalName = `MCP_GameObject_Edit_Verify_${suffix}`;
  const updatedName = `${originalName}_Renamed`;
  const createMutationId = `verify-gameobject-create-${randomUUID()}`;
  const updateMutationId = `verify-gameobject-update-${randomUUID()}`;
  const deleteMutationId = `verify-gameobject-delete-${randomUUID()}`;

  const create = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name: originalName, mutationId: createMutationId },
  });
  if (create.isError) {
    throw new Error(`Temporary GameObject create failed: ${readToolText(create)}`);
  }

  const created = parseCreate(create.structuredContent);
  if (created === null || created.replayed) {
    throw new Error(`Create returned invalid structuredContent: ${JSON.stringify(create.structuredContent)}`);
  }

  const initial = await resolve(created.globalObjectId);
  requireResolvedState(initial, originalName, true, "initial");

  const update = await client.callTool({
    name: "unity_update_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      name: updatedName,
      activeSelf: false,
      mutationId: updateMutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (update.isError) {
    throw new Error(`gameObject.update failed: ${readToolText(update)}`);
  }

  const updated = parseUpdate(update.structuredContent);
  if (
    updated === null ||
    updated.replayed ||
    !updated.changed ||
    updated.gameObject.globalObjectId !== created.globalObjectId ||
    updated.gameObject.name !== updatedName ||
    updated.gameObject.activeSelf !== false
  ) {
    throw new Error(`Update returned invalid native result: ${JSON.stringify(update.structuredContent)}`);
  }

  const updateReadback = await resolve(created.globalObjectId);
  requireResolvedState(updateReadback, updatedName, false, "update readback");

  const updateReplay = await client.callTool({
    name: "unity_update_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      name: updatedName,
      activeSelf: false,
      mutationId: updateMutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (updateReplay.isError) {
    throw new Error(`Immediate update replay failed: ${readToolText(updateReplay)}`);
  }
  const replayedUpdate = parseUpdate(updateReplay.structuredContent);
  if (replayedUpdate === null || !replayedUpdate.replayed) {
    throw new Error(`Immediate update replay did not return replayed=true: ${JSON.stringify(updateReplay.structuredContent)}`);
  }

  console.log("[Unity AI Bridge] GameObject update + native readback + immediate replay PASS.");
  console.log(
    "[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo only the GameObject name/activeSelf update.",
  );

  await waitForResolvedState(created.globalObjectId, originalName, true);

  const staleUpdateReplay = await client.callTool({
    name: "unity_update_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      name: updatedName,
      activeSelf: false,
      mutationId: updateMutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (!staleUpdateReplay.isError) {
    throw new Error(
      `Update replay unexpectedly reapplied an Undone mutation: ${JSON.stringify(staleUpdateReplay.structuredContent)}`,
    );
  }
  const updateStaleError = readToolText(staleUpdateReplay);
  if (!updateStaleError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Update stale replay returned the wrong error: ${updateStaleError}`);
  }

  const beforeDelete = await resolve(created.globalObjectId);
  requireResolvedState(beforeDelete, originalName, true, "pre-delete");

  const deleteResult = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      mutationId: deleteMutationId,
      expectedStateEpoch: beforeDelete.stateEpoch,
      expectedStateRevision: beforeDelete.stateRevision,
    },
  });
  if (deleteResult.isError) {
    throw new Error(`gameObject.delete failed: ${readToolText(deleteResult)}`);
  }

  const deleted = parseDelete(deleteResult.structuredContent);
  if (
    deleted === null ||
    deleted.replayed ||
    !deleted.deleted ||
    deleted.requestedGlobalObjectId !== created.globalObjectId ||
    deleted.deletedName !== originalName
  ) {
    throw new Error(`Delete returned invalid structuredContent: ${JSON.stringify(deleteResult.structuredContent)}`);
  }

  const afterDelete = await resolve(created.globalObjectId);
  if (afterDelete.found) {
    throw new Error(`Deleted GameObject still resolves: ${JSON.stringify(afterDelete)}`);
  }

  const deleteReplay = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      mutationId: deleteMutationId,
      expectedStateEpoch: beforeDelete.stateEpoch,
      expectedStateRevision: beforeDelete.stateRevision,
    },
  });
  if (deleteReplay.isError) {
    throw new Error(`Immediate delete replay failed: ${readToolText(deleteReplay)}`);
  }
  const replayedDelete = parseDelete(deleteReplay.structuredContent);
  if (replayedDelete === null || !replayedDelete.replayed) {
    throw new Error(`Immediate delete replay did not return replayed=true: ${JSON.stringify(deleteReplay.structuredContent)}`);
  }

  console.log("[Unity AI Bridge] GameObject delete + native absence readback + immediate replay PASS.");
  console.log(
    "[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo the GameObject deletion and restore the temporary object.",
  );

  await waitForResolvedState(created.globalObjectId, originalName, true);

  const staleDeleteReplay = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      mutationId: deleteMutationId,
      expectedStateEpoch: beforeDelete.stateEpoch,
      expectedStateRevision: beforeDelete.stateRevision,
    },
  });
  if (!staleDeleteReplay.isError) {
    throw new Error(
      `Delete replay unexpectedly deleted a target restored by Undo: ${JSON.stringify(staleDeleteReplay.structuredContent)}`,
    );
  }
  const deleteStaleError = readToolText(staleDeleteReplay);
  if (!deleteStaleError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Delete stale replay returned the wrong error: ${deleteStaleError}`);
  }

  const cleanupState = await resolve(created.globalObjectId);
  requireResolvedState(cleanupState, originalName, true, "cleanup precondition");
  const cleanupMutationId = `verify-gameobject-cleanup-${randomUUID()}`;
  const cleanup = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      mutationId: cleanupMutationId,
      expectedStateEpoch: cleanupState.stateEpoch,
      expectedStateRevision: cleanupState.stateRevision,
    },
  });
  if (cleanup.isError) {
    throw new Error(`Cleanup delete failed: ${readToolText(cleanup)}`);
  }

  const cleanupReadback = await resolve(created.globalObjectId);
  if (cleanupReadback.found) {
    throw new Error("Cleanup delete did not remove the temporary GameObject.");
  }

  console.log("[Unity AI Bridge] GameObject update/delete reliability PASS:");
  console.log(
    JSON.stringify(
      {
        globalObjectId: created.globalObjectId,
        updateMutationId,
        deleteMutationId,
        updateVerified: true,
        updateReplay: true,
        updateUndoRestored: true,
        updateStaleReplayError: updateStaleError,
        deleteVerified: true,
        deleteReplay: true,
        deleteUndoRestored: true,
        deleteStaleReplayError: deleteStaleError,
        cleanupDeleted: true,
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] GameObject edit verification FAILED:\n${message}`);
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
    throw new Error(`unity_resolve_object failed: ${readToolText(result)}`);
  }

  const parsed = parseResolve(result.structuredContent);
  if (parsed === null) {
    throw new Error(`unity_resolve_object returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return parsed;
}

async function waitForResolvedState(
  globalObjectId: string,
  expectedName: string,
  expectedActiveSelf: boolean,
): Promise<ResolvePayload> {
  const deadline = Date.now() + timeoutMs;
  let last: ResolvePayload | null = null;

  while (Date.now() < deadline) {
    const current = await resolve(globalObjectId);
    last = current;
    if (
      current.found &&
      current.name === expectedName &&
      current.activeSelf === expectedActiveSelf
    ) {
      return current;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for GameObject state name=${expectedName}, activeSelf=${expectedActiveSelf}. Last observation: ${JSON.stringify(last)}`,
  );
}

function requireResolvedState(
  value: ResolvePayload,
  expectedName: string,
  expectedActiveSelf: boolean,
  label: string,
): void {
  if (
    !value.found ||
    !value.isGameObject ||
    value.name !== expectedName ||
    value.activeSelf !== expectedActiveSelf ||
    value.stateEpoch.length === 0 ||
    value.stateRevision <= 0
  ) {
    throw new Error(`${label} resolver state did not match: ${JSON.stringify(value)}`);
  }
}

function parseCreate(value: unknown): CreatePayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mutationId !== "string" ||
    typeof candidate.replayed !== "boolean" ||
    typeof candidate.globalObjectId !== "string" ||
    candidate.globalObjectId.length === 0 ||
    typeof candidate.name !== "string"
  ) {
    return null;
  }
  return candidate as unknown as CreatePayload;
}

function parseResolve(value: unknown): ResolvePayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.found !== "boolean" ||
    typeof candidate.canonicalGlobalObjectId !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.isGameObject !== "boolean" ||
    typeof candidate.activeSelf !== "boolean" ||
    typeof candidate.stateEpoch !== "string" ||
    typeof candidate.stateRevision !== "number" ||
    !Number.isSafeInteger(candidate.stateRevision) ||
    candidate.stateRevision <= 0
  ) {
    return null;
  }
  return candidate as unknown as ResolvePayload;
}

function parseUpdate(value: unknown): UpdatePayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const gameObject = candidate.gameObject;
  if (
    typeof candidate.mutationId !== "string" ||
    typeof candidate.replayed !== "boolean" ||
    typeof candidate.changed !== "boolean" ||
    typeof gameObject !== "object" ||
    gameObject === null
  ) {
    return null;
  }
  const snapshot = gameObject as Record<string, unknown>;
  if (
    typeof snapshot.globalObjectId !== "string" ||
    typeof snapshot.name !== "string" ||
    typeof snapshot.activeSelf !== "boolean"
  ) {
    return null;
  }
  return candidate as unknown as UpdatePayload;
}

function parseDelete(value: unknown): DeletePayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mutationId !== "string" ||
    typeof candidate.replayed !== "boolean" ||
    candidate.deleted !== true ||
    typeof candidate.requestedGlobalObjectId !== "string" ||
    typeof candidate.deletedName !== "string"
  ) {
    return null;
  }
  return candidate as unknown as DeletePayload;
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
  name: string;
};

type ResolvePayload = {
  found: boolean;
  canonicalGlobalObjectId: string;
  name: string;
  isGameObject: boolean;
  activeSelf: boolean;
  stateEpoch: string;
  stateRevision: number;
};

type UpdatePayload = {
  mutationId: string;
  replayed: boolean;
  changed: boolean;
  gameObject: {
    globalObjectId: string;
    name: string;
    activeSelf: boolean;
  };
};

type DeletePayload = {
  mutationId: string;
  replayed: boolean;
  deleted: true;
  requestedGlobalObjectId: string;
  deletedName: string;
};
