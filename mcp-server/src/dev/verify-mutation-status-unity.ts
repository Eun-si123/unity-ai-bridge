import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 90_000;
const pollIntervalMs = 250;

const client = new Client({
  name: "unity-ai-bridge-mutation-status-verifier",
  version: "0.0.1",
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

let createdGlobalObjectId = "";
let createdName = "";

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

  await waitForCapabilities("mutation.status", "state.revision.v1", "gameObject.create", "gameObject.delete");

  const unknownMutationId = `verify-mutation-status-unknown-${randomUUID()}`;
  const unknown = await readMutationStatus(unknownMutationId);
  assertUnknownStatus(unknown, unknownMutationId);

  const suffix = Date.now();
  createdName = `MCP_Mutation_Status_${suffix}`;
  const createMutationId = `verify-mutation-status-create-${randomUUID()}`;
  const { create, snapshot } = await createAgainstFreshSnapshot(
    createdName,
    createMutationId,
  );
  createdGlobalObjectId = create.globalObjectId;

  const createStatus = await readMutationStatus(createMutationId);
  assertCompletedStatus(createStatus, createMutationId, "gameObject.create");
  if (
    createStatus.startedStateEpoch !== snapshot.stateEpoch ||
    createStatus.startedStateRevision !== snapshot.stateRevision
  ) {
    throw new Error(
      `Create lifecycle did not preserve the pre-mutation state token: ${JSON.stringify(createStatus)}`,
    );
  }

  const hierarchyBeforeStatusRepeat = await readHierarchy();
  const repeatedCreateStatus = await readMutationStatus(createMutationId);
  const hierarchyAfterStatusRepeat = await readHierarchy();
  assertCompletedStatus(repeatedCreateStatus, createMutationId, "gameObject.create");
  if (
    hierarchyAfterStatusRepeat.stateEpoch !== hierarchyBeforeStatusRepeat.stateEpoch ||
    hierarchyAfterStatusRepeat.stateRevision !== hierarchyBeforeStatusRepeat.stateRevision ||
    countHierarchyName(hierarchyAfterStatusRepeat, createdName) !== 1
  ) {
    throw new Error(
      "mutation status observation changed scene state or the created target while reading the same journal entry.",
    );
  }

  const deleteMutationId = `verify-mutation-status-delete-${randomUUID()}`;
  await deleteAgainstFreshSnapshot(createdGlobalObjectId, deleteMutationId);
  createdGlobalObjectId = "";

  const deleteStatus = await readMutationStatus(deleteMutationId);
  assertCompletedStatus(deleteStatus, deleteMutationId, "gameObject.delete");
  const finalHierarchy = await readHierarchy();
  if (countHierarchyName(finalHierarchy, createdName) !== 0) {
    throw new Error("Verifier cleanup did not remove the temporary GameObject.");
  }

  console.log("[Unity AI Bridge] Mutation status verification PASS:");
  console.log(JSON.stringify({
    unknownStatus: {
      mutationId: unknown.mutationId,
      found: unknown.found,
      status: unknown.status,
      safeToBlindRetry: unknown.safeToBlindRetry,
      recommendedAction: unknown.recommendedAction,
    },
    create: {
      mutationId: createMutationId,
      globalObjectId: create.globalObjectId,
      status: createStatus.status,
      operation: createStatus.operation,
      terminal: createStatus.terminal,
      intentIdentityRecorded: createStatus.intentIdentityRecorded,
      safeToBlindRetry: createStatus.safeToBlindRetry,
      recommendedAction: createStatus.recommendedAction,
    },
    repeatedStatusReadOnly: true,
    delete: {
      mutationId: deleteMutationId,
      status: deleteStatus.status,
      operation: deleteStatus.operation,
      terminal: deleteStatus.terminal,
    },
    temporaryObjectRemoved: true,
    finalState: {
      stateEpoch: finalHierarchy.stateEpoch,
      stateRevision: finalHierarchy.stateRevision,
    },
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Mutation status verification FAILED:\n${message}`);
  if (createdGlobalObjectId.length > 0) {
    console.error(
      `[Unity AI Bridge] Best-effort cleanup may be required for temporary GameObject '${createdName}' (${createdGlobalObjectId}).`,
    );
  }
  process.exitCode = 1;
} finally {
  if (createdGlobalObjectId.length > 0) {
    try {
      const cleanupMutationId = `verify-mutation-status-cleanup-${randomUUID()}`;
      await deleteAgainstFreshSnapshot(createdGlobalObjectId, cleanupMutationId);
      createdGlobalObjectId = "";
      console.error("[Unity AI Bridge] Best-effort cleanup removed the temporary GameObject.");
    } catch {
      // The failure message above already includes the exact cleanup target.
    }
  }
  await client.close();
}

async function waitForCapabilities(...required: string[]): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No Unity status received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError && typeof result.structuredContent === "object" && result.structuredContent !== null) {
      const status = result.structuredContent as Record<string, unknown>;
      const capabilities = status.capabilities;
      if (
        Array.isArray(capabilities) &&
        required.every((capability) => capabilities.includes(capability))
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
    `Timed out waiting for mutation-status capabilities. Last observation: ${last}. Reimport/restart Unity if it is still running an older Agent assembly.`,
  );
}

async function createAgainstFreshSnapshot(
  name: string,
  mutationId: string,
): Promise<{ snapshot: HierarchyPayload; create: CreatePayload }> {
  let lastError = "No create attempt made.";

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await readHierarchy();
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
      return { snapshot, create: result.structuredContent };
    }

    lastError = readToolText(result);
    if (!lastError.includes("stale_state/state_revision_mismatch")) {
      throw new Error(`Fresh-state create failed unexpectedly: ${lastError}`);
    }
  }

  throw new Error(`Could not obtain a stable create window. Last error: ${lastError}`);
}

async function deleteAgainstFreshSnapshot(
  globalObjectId: string,
  mutationId: string,
): Promise<void> {
  let lastError = "No delete attempt made.";

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
    if (!result.isError) return;

    lastError = readToolText(result);
    if (!lastError.includes("stale_state/state_revision_mismatch")) {
      throw new Error(`Fresh-state delete failed unexpectedly: ${lastError}`);
    }
  }

  throw new Error(`Could not obtain a stable delete window. Last error: ${lastError}`);
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

function assertUnknownStatus(value: MutationStatusPayload, mutationId: string): void {
  if (
    value.mutationId !== mutationId ||
    value.found ||
    value.status !== "not_found" ||
    value.terminal ||
    value.safeToBlindRetry ||
    value.recommendedAction !== "reobserve_native_state"
  ) {
    throw new Error(`Unexpected unknown mutation status: ${JSON.stringify(value)}`);
  }
}

function assertCompletedStatus(
  value: MutationStatusPayload,
  mutationId: string,
  operation: string,
): void {
  if (
    value.mutationId !== mutationId ||
    !value.found ||
    value.operation !== operation ||
    value.status !== "completed" ||
    !value.terminal ||
    !value.intentIdentityRecorded ||
    value.safeToBlindRetry ||
    value.recommendedAction !== "operation_specific_same_id_replay_or_reobserve" ||
    value.startedUnixMs <= 0 ||
    value.startedStateEpoch.length === 0 ||
    value.startedStateRevision <= 0 ||
    value.finishedUnixMs <= 0 ||
    value.finishedStateEpoch.length === 0 ||
    value.finishedStateRevision <= 0
  ) {
    throw new Error(`Unexpected completed mutation status: ${JSON.stringify(value)}`);
  }
}

function countHierarchyName(value: HierarchyPayload, name: string): number {
  return value.nodes.filter((node) => node.name === name).length;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type HierarchyPayload = {
  stateEpoch: string;
  stateRevision: number;
  nodes: Array<{ name?: unknown }>;
};

type CreatePayload = {
  mutationId: string;
  replayed: boolean;
  globalObjectId: string;
  stateEpoch: string;
  stateRevision: number;
};

type MutationStatusPayload = {
  mutationId: string;
  found: boolean;
  operation: string;
  status: string;
  terminal: boolean;
  startedUnixMs: number;
  startedStateEpoch: string;
  startedStateRevision: number;
  finishedUnixMs: number;
  finishedStateEpoch: string;
  finishedStateRevision: number;
  intentIdentityRecorded: boolean;
  safeToBlindRetry: boolean;
  recommendedAction: string;
};

function isHierarchyPayload(value: unknown): value is HierarchyPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.stateEpoch === "string" && candidate.stateEpoch.length > 0 &&
    typeof candidate.stateRevision === "number" && Number.isSafeInteger(candidate.stateRevision) && candidate.stateRevision > 0 &&
    Array.isArray(candidate.nodes)
  );
}

function isCreatePayload(value: unknown): value is CreatePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" && candidate.mutationId.length > 0 &&
    candidate.replayed === false &&
    typeof candidate.globalObjectId === "string" && candidate.globalObjectId.length > 0 &&
    typeof candidate.stateEpoch === "string" && candidate.stateEpoch.length > 0 &&
    typeof candidate.stateRevision === "number" && Number.isSafeInteger(candidate.stateRevision) && candidate.stateRevision > 0
  );
}

function isMutationStatusPayload(value: unknown): value is MutationStatusPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    typeof candidate.found === "boolean" &&
    typeof candidate.operation === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.terminal === "boolean" &&
    typeof candidate.startedUnixMs === "number" &&
    typeof candidate.startedStateEpoch === "string" &&
    typeof candidate.startedStateRevision === "number" &&
    typeof candidate.finishedUnixMs === "number" &&
    typeof candidate.finishedStateEpoch === "string" &&
    typeof candidate.finishedStateRevision === "number" &&
    typeof candidate.intentIdentityRecorded === "boolean" &&
    typeof candidate.safeToBlindRetry === "boolean" &&
    typeof candidate.recommendedAction === "string"
  );
}
