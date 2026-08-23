import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const componentType = "UnityEngine.BoxCollider";

const client = new Client({
  name: "unity-ai-bridge-component-mutation-verifier",
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
    "unity_add_component",
    "unity_remove_component",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  await waitForUnityReady();
  const name = `MCP_Component_Mutation_Verify_${Date.now()}`;
  const createMutationId = `verify-component-owner-${randomUUID()}`;
  const addMutationId = `verify-component-add-${randomUUID()}`;
  const removeMutationId = `verify-component-remove-${randomUUID()}`;

  const create = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name, mutationId: createMutationId },
  });
  if (create.isError) throw new Error(`Temporary GameObject create failed: ${readToolText(create)}`);
  const created = parseCreate(create.structuredContent);
  if (created === null || created.replayed) {
    throw new Error(`Create returned invalid structuredContent: ${JSON.stringify(create.structuredContent)}`);
  }

  const ownerBeforeAdd = await resolve(created.globalObjectId);
  requireGameObject(ownerBeforeAdd, created.globalObjectId, name, "pre-add owner");

  const add = await client.callTool({
    name: "unity_add_component",
    arguments: {
      gameObjectGlobalObjectId: created.globalObjectId,
      typeName: componentType,
      mutationId: addMutationId,
      expectedStateEpoch: ownerBeforeAdd.stateEpoch,
      expectedStateRevision: ownerBeforeAdd.stateRevision,
    },
  });
  if (add.isError) throw new Error(`component.add failed: ${readToolText(add)}`);
  const added = parseAdd(add.structuredContent);
  if (
    added === null ||
    added.replayed ||
    !added.added ||
    added.component.typeName !== componentType ||
    added.component.gameObjectGlobalObjectId !== created.globalObjectId
  ) {
    throw new Error(`component.add returned invalid native result: ${JSON.stringify(add.structuredContent)}`);
  }

  const componentId = added.component.globalObjectId;
  const addReadback = await resolve(componentId);
  requireComponent(addReadback, componentId, created.globalObjectId, componentType, "add readback");

  const addReplay = await client.callTool({
    name: "unity_add_component",
    arguments: {
      gameObjectGlobalObjectId: created.globalObjectId,
      typeName: componentType,
      mutationId: addMutationId,
      expectedStateEpoch: ownerBeforeAdd.stateEpoch,
      expectedStateRevision: ownerBeforeAdd.stateRevision,
    },
  });
  if (addReplay.isError) throw new Error(`Immediate component.add replay failed: ${readToolText(addReplay)}`);
  const replayedAdd = parseAdd(addReplay.structuredContent);
  if (replayedAdd === null || !replayedAdd.replayed || replayedAdd.component.globalObjectId !== componentId) {
    throw new Error(`component.add replay was invalid: ${JSON.stringify(addReplay.structuredContent)}`);
  }

  const beforeRemove = await resolve(componentId);
  requireComponent(beforeRemove, componentId, created.globalObjectId, componentType, "pre-remove component");
  const remove = await client.callTool({
    name: "unity_remove_component",
    arguments: {
      componentGlobalObjectId: componentId,
      mutationId: removeMutationId,
      expectedStateEpoch: beforeRemove.stateEpoch,
      expectedStateRevision: beforeRemove.stateRevision,
    },
  });
  if (remove.isError) throw new Error(`component.remove failed: ${readToolText(remove)}`);
  const removed = parseRemove(remove.structuredContent);
  if (
    removed === null ||
    removed.replayed ||
    !removed.removed ||
    removed.requestedComponentGlobalObjectId !== componentId ||
    removed.deletedTypeName !== componentType ||
    removed.deletedGameObjectGlobalObjectId !== created.globalObjectId
  ) {
    throw new Error(`component.remove returned invalid result: ${JSON.stringify(remove.structuredContent)}`);
  }

  const afterRemove = await resolve(componentId);
  if (afterRemove.found) throw new Error(`Removed Component still resolves: ${JSON.stringify(afterRemove)}`);

  const removeReplay = await client.callTool({
    name: "unity_remove_component",
    arguments: {
      componentGlobalObjectId: componentId,
      mutationId: removeMutationId,
      expectedStateEpoch: beforeRemove.stateEpoch,
      expectedStateRevision: beforeRemove.stateRevision,
    },
  });
  if (removeReplay.isError) throw new Error(`Immediate component.remove replay failed: ${readToolText(removeReplay)}`);
  const replayedRemove = parseRemove(removeReplay.structuredContent);
  if (replayedRemove === null || !replayedRemove.replayed) {
    throw new Error(`component.remove replay did not return replayed=true: ${JSON.stringify(removeReplay.structuredContent)}`);
  }

  console.log("[Unity AI Bridge] Component add/remove native verification + immediate replay PASS.");
  console.log("[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo Component removal.");
  await waitForComponent(componentId, created.globalObjectId, componentType, true);

  const staleRemoveReplay = await client.callTool({
    name: "unity_remove_component",
    arguments: {
      componentGlobalObjectId: componentId,
      mutationId: removeMutationId,
      expectedStateEpoch: beforeRemove.stateEpoch,
      expectedStateRevision: beforeRemove.stateRevision,
    },
  });
  if (!staleRemoveReplay.isError) {
    throw new Error(`component.remove replay deleted a Component restored by Undo: ${JSON.stringify(staleRemoveReplay.structuredContent)}`);
  }
  const removeStaleError = readToolText(staleRemoveReplay);
  if (!removeStaleError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`component.remove stale replay returned wrong error: ${removeStaleError}`);
  }

  console.log("[Unity AI Bridge] Component removal Undo restoration PASS.");
  console.log("[Unity AI Bridge] NOW press Ctrl+Z ONCE more in Unity to undo Component addition.");
  await waitForComponent(componentId, created.globalObjectId, componentType, false);

  const staleAddReplay = await client.callTool({
    name: "unity_add_component",
    arguments: {
      gameObjectGlobalObjectId: created.globalObjectId,
      typeName: componentType,
      mutationId: addMutationId,
      expectedStateEpoch: ownerBeforeAdd.stateEpoch,
      expectedStateRevision: ownerBeforeAdd.stateRevision,
    },
  });
  if (!staleAddReplay.isError) {
    throw new Error(`component.add replay added a second Component after Undo: ${JSON.stringify(staleAddReplay.structuredContent)}`);
  }
  const addStaleError = readToolText(staleAddReplay);
  if (!addStaleError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`component.add stale replay returned wrong error: ${addStaleError}`);
  }

  const cleanupState = await resolve(created.globalObjectId);
  requireGameObject(cleanupState, created.globalObjectId, name, "cleanup owner");
  const cleanup = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: created.globalObjectId,
      mutationId: `verify-component-cleanup-${randomUUID()}`,
      expectedStateEpoch: cleanupState.stateEpoch,
      expectedStateRevision: cleanupState.stateRevision,
    },
  });
  if (cleanup.isError) throw new Error(`Temporary GameObject cleanup failed: ${readToolText(cleanup)}`);
  const cleanupReadback = await resolve(created.globalObjectId);
  if (cleanupReadback.found) throw new Error("Cleanup did not remove the temporary GameObject.");

  console.log("[Unity AI Bridge] Component add/remove reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: cleanupState.unityVersion ?? "6000.3.21f1",
    gameObjectGlobalObjectId: created.globalObjectId,
    componentGlobalObjectId: componentId,
    componentType,
    addMutationId,
    removeMutationId,
    addVerified: true,
    addReplay: true,
    removeVerified: true,
    removeReplay: true,
    removeUndoRestored: true,
    removeStaleReplayError: removeStaleError,
    addUndoRemoved: true,
    addStaleReplayError: addStaleError,
    cleanupDeleted: true,
    temporaryObjectRemoved: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Component mutation verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityReady(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No status returned.";
  while (Date.now() < deadline) {
    const status = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!status.isError) return;
    last = readToolText(status);
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Unity. Last error: ${last}`);
}

async function resolve(globalObjectId: string): Promise<ResolvePayload> {
  const result = await client.callTool({
    name: "unity_resolve_object",
    arguments: { globalObjectId },
  });
  if (result.isError) throw new Error(`unity_resolve_object failed: ${readToolText(result)}`);
  const parsed = parseResolve(result.structuredContent);
  if (parsed === null) throw new Error(`Invalid resolver result: ${JSON.stringify(result.structuredContent)}`);
  return parsed;
}

async function waitForComponent(
  componentGlobalObjectId: string,
  ownerGlobalObjectId: string,
  expectedType: string,
  shouldExist: boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: ResolvePayload | null = null;
  while (Date.now() < deadline) {
    const current = await resolve(componentGlobalObjectId);
    last = current;
    if (!shouldExist && !current.found) return;
    if (
      shouldExist &&
      current.found &&
      current.isComponent &&
      current.objectType === expectedType &&
      current.owningGameObjectGlobalObjectId === ownerGlobalObjectId
    ) return;
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Component shouldExist=${shouldExist}. Last=${JSON.stringify(last)}`);
}

function requireGameObject(value: ResolvePayload, id: string, name: string, label: string): void {
  if (!value.found || !value.isGameObject || value.canonicalGlobalObjectId !== id || value.name !== name) {
    throw new Error(`${label} did not match: ${JSON.stringify(value)}`);
  }
}

function requireComponent(
  value: ResolvePayload,
  id: string,
  ownerId: string,
  typeName: string,
  label: string,
): void {
  if (
    !value.found ||
    !value.isComponent ||
    value.canonicalGlobalObjectId !== id ||
    value.objectType !== typeName ||
    value.owningGameObjectGlobalObjectId !== ownerId
  ) {
    throw new Error(`${label} did not match: ${JSON.stringify(value)}`);
  }
}

function parseCreate(value: unknown): CreatePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.globalObjectId !== "string" || typeof c.replayed !== "boolean") return null;
  return c as unknown as CreatePayload;
}

function parseAdd(value: unknown): AddPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.replayed !== "boolean" || c.added !== true || typeof c.component !== "object" || c.component === null) return null;
  const component = c.component as Record<string, unknown>;
  if (typeof component.globalObjectId !== "string" || typeof component.typeName !== "string" || typeof component.gameObjectGlobalObjectId !== "string") return null;
  return c as unknown as AddPayload;
}

function parseRemove(value: unknown): RemovePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.replayed !== "boolean" ||
    c.removed !== true ||
    typeof c.requestedComponentGlobalObjectId !== "string" ||
    typeof c.deletedTypeName !== "string" ||
    typeof c.deletedGameObjectGlobalObjectId !== "string"
  ) return null;
  return c as unknown as RemovePayload;
}

function parseResolve(value: unknown): ResolvePayload | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.found !== "boolean" ||
    typeof c.canonicalGlobalObjectId !== "string" ||
    typeof c.name !== "string" ||
    typeof c.objectType !== "string" ||
    typeof c.isGameObject !== "boolean" ||
    typeof c.isComponent !== "boolean" ||
    typeof c.owningGameObjectGlobalObjectId !== "string" ||
    typeof c.stateEpoch !== "string" ||
    typeof c.stateRevision !== "number" ||
    !Number.isSafeInteger(c.stateRevision) ||
    c.stateRevision <= 0
  ) return null;
  return c as unknown as ResolvePayload;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((block) => block.type === "text")?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

type CreatePayload = { globalObjectId: string; replayed: boolean };
type AddPayload = {
  replayed: boolean;
  added: true;
  component: { globalObjectId: string; typeName: string; gameObjectGlobalObjectId: string };
};
type RemovePayload = {
  replayed: boolean;
  removed: true;
  requestedComponentGlobalObjectId: string;
  deletedTypeName: string;
  deletedGameObjectGlobalObjectId: string;
};
type ResolvePayload = {
  found: boolean;
  canonicalGlobalObjectId: string;
  name: string;
  objectType: string;
  isGameObject: boolean;
  isComponent: boolean;
  owningGameObjectGlobalObjectId: string;
  stateEpoch: string;
  stateRevision: number;
  unityVersion?: string;
};
