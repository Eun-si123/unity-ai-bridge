import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  isMutationStatusPayload,
  type MutationStatusPayload,
} from "../bridge/mutation-status-bridge.js";

const timeoutMs = 90_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-mutation-status-verifier",
  version: "0.0.1",
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

let cleanupGlobalObjectId: string | undefined;

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of [
    "unity_get_status",
    "unity_get_hierarchy",
    "unity_create_game_object",
    "unity_delete_game_object",
    "unity_get_mutation_status",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Unity mutation-status capability...");
  await waitForCapabilities();

  const initialHierarchy = await readHierarchy();
  assertPersistentActiveScene(initialHierarchy);

  const unknownMutationId = `verify-mutation-status-unknown-${randomUUID()}`;
  const unknown = await readMutationStatus(unknownMutationId);
  if (
    unknown.found ||
    unknown.status !== "not_found" ||
    unknown.safeToBlindRetry ||
    unknown.recommendedAction !== "reobserve_native_state"
  ) {
    throw new Error(`Unexpected unknown-mutation status: ${JSON.stringify(unknown)}`);
  }
  console.log("[Unity AI Bridge] Unknown mutation fail-closed status PASS.");

  const objectName = `MCP_Mutation_Status_${Date.now()}`;
  const createMutationId = `verify-mutation-status-create-${randomUUID()}`;
  const create = await createAgainstFreshSnapshot(objectName, createMutationId);
  cleanupGlobalObjectId = create.globalObjectId;

  const createStatus = await readMutationStatus(createMutationId);
  assertCompletedLifecycle(createStatus, createMutationId, "gameObject.create");

  const stateBeforeSecondRead = await readStatusRevision();
  const createStatusAgain = await readMutationStatus(createMutationId);
  const stateAfterSecondRead = await readStatusRevision();
  assertCompletedLifecycle(createStatusAgain, createMutationId, "gameObject.create");
  if (
    stateBeforeSecondRead.stateEpoch !== stateAfterSecondRead.stateEpoch ||
    stateBeforeSecondRead.stateRevision !== stateAfterSecondRead.stateRevision
  ) {
    throw new Error(
      `mutation status read changed Unity state: before=${JSON.stringify(stateBeforeSecondRead)} after=${JSON.stringify(stateAfterSecondRead)}`,
    );
  }
  console.log("[Unity AI Bridge] Completed create lifecycle + read-only state token PASS.");

  const deleteMutationId = `verify-mutation-status-delete-${randomUUID()}`;
  const deleteResult = await deleteAgainstFreshSnapshot(create.globalObjectId, deleteMutationId);
  cleanupGlobalObjectId = undefined;
  const deleteStatus = await readMutationStatus(deleteMutationId);
  assertCompletedLifecycle(deleteStatus, deleteMutationId, "gameObject.delete");

  const finalHierarchy = await readHierarchy();
  const remainingMatches = finalHierarchy.nodes.filter(
    (node) => node.globalObjectId === create.globalObjectId || node.name === objectName,
  );
  if (remainingMatches.length !== 0) {
    throw new Error(
      `Temporary verifier object still exists after delete: ${JSON.stringify(remainingMatches)}`,
    );
  }

  console.log("[Unity AI Bridge] Mutation status verification PASS:");
  console.log(JSON.stringify({
    activeScenePath: initialHierarchy.scenePath,
    unknownMutationId,
    createMutationId,
    createStatus,
    deleteMutationId,
    deleteStatus,
    deleteResult,
    readOnlyStateTokenUnchanged: true,
    temporaryObjectRemaining: false,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Mutation status verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  if (cleanupGlobalObjectId !== undefined) {
    await bestEffortDelete(cleanupGlobalObjectId);
  }
  await client.close();
}

async function waitForCapabilities(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No Unity status received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError && typeof result.structuredContent === "object" && result.structuredContent !== null) {
      const status = result.structuredContent as Record<string, unknown>;
      const capabilities = status.capabilities;
      if (
        Array.isArray(capabilities) &&
        capabilities.includes("mutation.status") &&
        capabilities.includes("state.revision.v1") &&
        isStateRevision(status.stateEpoch, status.stateRevision)
      ) {
        return;
      }
      last = JSON.stringify(status);
    } else {
      last = readToolText(result);
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for mutation.status capability. Last observation: ${last}. Reimport/restart Unity if it is still running an older Agent assembly.`,
  );
}

async function createAgainstFreshSnapshot(
  name: string,
  mutationId: string,
): Promise<CreatePayload> {
  let lastError = "No attempt made.";

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await readHierarchy();
    assertPersistentActiveScene(snapshot);
    const result = await client.callTool({
      name: "unity_create_game_object",
      arguments: {
        name,
        mutationId,
        expectedStateEpoch: snapshot.stateEpoch,
        expectedStateRevision: snapshot.stateRevision,
      },
    });

    if (!result.isError) {
      if (!isCreatePayload(result.structuredContent)) {
        throw new Error(
          `Create returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`,
        );
      }
      return result.structuredContent;
    }

    lastError = readToolText(result);
    if (lastError.includes("stale_state/state_revision_mismatch")) {
      console.log(
        `[Unity AI Bridge] State changed between snapshot and preflight on attempt ${attempt}; refreshing and retrying with the SAME mutationId...`,
      );
      continue;
    }
    if (lastError.includes("stale_target/active_scene_unsaved")) {
      throw new Error(
        "The active Unity scene is unsaved/temporary. Open or save a persistent scene asset (for example Assets/Scenes/SampleScene.unity) and rerun verify:mutation-status. " +
        `Unity reported: ${lastError}`,
      );
    }
    throw new Error(`Fresh-state create failed unexpectedly: ${lastError}`);
  }

  throw new Error(`Could not obtain a stable fresh-state window. Last error: ${lastError}`);
}

async function deleteAgainstFreshSnapshot(
  globalObjectId: string,
  mutationId: string,
): Promise<DeletePayload> {
  let lastError = "No attempt made.";

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await readHierarchy();
    const result = await client.callTool({
      name: "unity_delete_game_object",
      arguments: {
        globalObjectId,
        mutationId,
        expectedStateEpoch: snapshot.stateEpoch,
        expectedStateRevision: snapshot.stateRevision,
      },
    });

    if (!result.isError) {
      if (!isDeletePayload(result.structuredContent)) {
        throw new Error(
          `Delete returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`,
        );
      }
      return result.structuredContent;
    }

    lastError = readToolText(result);
    if (lastError.includes("stale_state/state_revision_mismatch")) {
      console.log(
        `[Unity AI Bridge] State changed before delete on attempt ${attempt}; refreshing and retrying with the SAME mutationId...`,
      );
      continue;
    }
    throw new Error(`Fresh-state delete failed unexpectedly: ${lastError}`);
  }

  throw new Error(`Could not obtain a stable fresh-state window for delete. Last error: ${lastError}`);
}

async function bestEffortDelete(globalObjectId: string): Promise<void> {
  try {
    const snapshot = await readHierarchy();
    const result = await client.callTool({
      name: "unity_delete_game_object",
      arguments: {
        globalObjectId,
        mutationId: `verify-mutation-status-cleanup-${randomUUID()}`,
        expectedStateEpoch: snapshot.stateEpoch,
        expectedStateRevision: snapshot.stateRevision,
      },
    });
    if (result.isError) {
      console.error(`[Unity AI Bridge] Cleanup warning: ${readToolText(result)}`);
    }
  } catch (error) {
    console.error(
      `[Unity AI Bridge] Cleanup warning: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readMutationStatus(mutationId: string): Promise<MutationStatusPayload> {
  const result = await client.callTool({
    name: "unity_get_mutation_status",
    arguments: { mutationId },
  });
  if (result.isError) {
    throw new Error(`unity_get_mutation_status failed: ${readToolText(result)}`);
  }
  if (!isMutationStatusPayload(result.structuredContent)) {
    throw new Error(
      `Mutation status returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`,
    );
  }
  return result.structuredContent;
}

async function readHierarchy(): Promise<HierarchyPayload> {
  const result = await client.callTool({
    name: "unity_get_hierarchy",
    arguments: { maxDepth: 32, maxNodes: 500 },
  });
  if (result.isError) {
    throw new Error(`unity_get_hierarchy failed: ${readToolText(result)}`);
  }
  if (!isHierarchyPayload(result.structuredContent)) {
    throw new Error(
      `Hierarchy returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`,
    );
  }
  return result.structuredContent;
}

async function readStatusRevision(): Promise<StateRevision> {
  const result = await client.callTool({ name: "unity_get_status", arguments: {} });
  if (result.isError) {
    throw new Error(`unity_get_status failed: ${readToolText(result)}`);
  }
  if (typeof result.structuredContent !== "object" || result.structuredContent === null) {
    throw new Error("unity_get_status returned non-object structuredContent.");
  }
  const candidate = result.structuredContent as Record<string, unknown>;
  if (!isStateRevision(candidate.stateEpoch, candidate.stateRevision)) {
    throw new Error(`unity_get_status returned invalid state revision: ${JSON.stringify(candidate)}`);
  }
  return {
    stateEpoch: candidate.stateEpoch as string,
    stateRevision: candidate.stateRevision as number,
  };
}

function assertPersistentActiveScene(hierarchy: HierarchyPayload): void {
  if (hierarchy.scenePath.length === 0) {
    throw new Error(
      "The active Unity scene is unsaved/temporary. Open or save a persistent scene asset before running verify:mutation-status. " +
      "This verifier depends on GlobalObjectId-backed scene-object identity and intentionally refuses to create test objects in an unsaved scene.",
    );
  }
}

function assertCompletedLifecycle(
  payload: MutationStatusPayload,
  mutationId: string,
  operation: string,
): void {
  if (
    !payload.found ||
    payload.mutationId !== mutationId ||
    payload.operation !== operation ||
    payload.status !== "completed" ||
    payload.terminal !== true ||
    payload.safeToBlindRetry !== false ||
    payload.recommendedAction !== "operation_specific_same_id_replay_or_reobserve" ||
    payload.finishedUnixMs <= 0 ||
    payload.finishedStateEpoch.length === 0 ||
    payload.finishedStateRevision <= 0
  ) {
    throw new Error(
      `Unexpected completed lifecycle for ${operation}/${mutationId}: ${JSON.stringify(payload)}`,
    );
  }
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StateRevision = {
  stateEpoch: string;
  stateRevision: number;
};

type HierarchyPayload = StateRevision & {
  sceneName: string;
  scenePath: string;
  nodes: Array<{ globalObjectId: string; name: string }>;
};

type CreatePayload = StateRevision & {
  mutationId: string;
  replayed: boolean;
  globalObjectId: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
};

type DeletePayload = StateRevision & {
  mutationId: string;
  replayed: boolean;
  deleted: boolean;
  requestedGlobalObjectId: string;
};

function isHierarchyPayload(value: unknown): value is HierarchyPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isStateRevision(candidate.stateEpoch, candidate.stateRevision) &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(
      (node) =>
        typeof node === "object" &&
        node !== null &&
        typeof (node as Record<string, unknown>).globalObjectId === "string" &&
        typeof (node as Record<string, unknown>).name === "string",
    )
  );
}

function isCreatePayload(value: unknown): value is CreatePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    candidate.replayed === false &&
    typeof candidate.globalObjectId === "string" && candidate.globalObjectId.length > 0 &&
    typeof candidate.expectedStateEpoch === "string" &&
    typeof candidate.expectedStateRevision === "number" &&
    isStateRevision(candidate.stateEpoch, candidate.stateRevision)
  );
}

function isDeletePayload(value: unknown): value is DeletePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    candidate.replayed === false &&
    candidate.deleted === true &&
    typeof candidate.requestedGlobalObjectId === "string" &&
    isStateRevision(candidate.stateEpoch, candidate.stateRevision)
  );
}

function isStateRevision(epoch: unknown, revision: unknown): boolean {
  return (
    typeof epoch === "string" &&
    epoch.length > 0 &&
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision > 0
  );
}
