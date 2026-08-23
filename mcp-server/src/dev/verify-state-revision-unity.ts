import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 90_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-state-revision-verifier",
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
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Unity state-revision capability...");
  await waitForStateRevisionCapability();

  const suffix = Date.now();
  const acceptedName = `MCP_State_Revision_A_${suffix}`;
  const rejectedName = `MCP_State_Revision_B_${suffix}`;

  const { snapshot, create } = await createAgainstFreshSnapshot(acceptedName);
  if (
    create.stateEpoch !== snapshot.stateEpoch ||
    create.stateRevision <= snapshot.stateRevision
  ) {
    throw new Error(
      `Successful write did not advance the state revision as expected: snapshot=${JSON.stringify(snapshot)}, create=${JSON.stringify(create)}`,
    );
  }

  console.log("[Unity AI Bridge] Fresh state precondition PASS; retrying a DIFFERENT write with the now-stale snapshot...");
  const rejectedMutationId = `verify-state-stale-${randomUUID()}`;
  const stale = await client.callTool({
    name: "unity_create_game_object",
    arguments: {
      name: rejectedName,
      mutationId: rejectedMutationId,
      expectedStateEpoch: snapshot.stateEpoch,
      expectedStateRevision: snapshot.stateRevision,
    },
  });
  if (!stale.isError) {
    throw new Error(
      `Stale-state write unexpectedly succeeded: ${JSON.stringify(stale.structuredContent)}`,
    );
  }

  const staleError = readToolText(stale);
  if (!staleError.includes("stale_state/state_revision_mismatch")) {
    throw new Error(`Stale-state write returned the wrong error: ${staleError}`);
  }

  const afterRejection = await readHierarchy();
  const acceptedMatches = countHierarchyName(afterRejection, acceptedName);
  const rejectedMatches = countHierarchyName(afterRejection, rejectedName);
  if (acceptedMatches !== 1 || rejectedMatches !== 0) {
    throw new Error(
      `Unexpected hierarchy after stale rejection: acceptedMatches=${acceptedMatches}, rejectedMatches=${rejectedMatches}`,
    );
  }

  console.log("[Unity AI Bridge] Stale-state rejection PASS; no second object was created.");
  console.log(
    "[Unity AI Bridge] NOW press Ctrl+Z once in Unity to undo the generated MCP_State_Revision_A object.",
  );

  const afterUndo = await waitUntilNameMissing(acceptedName, create.stateRevision);
  console.log("[Unity AI Bridge] State revision + stale-state protection PASS:");
  console.log(
    JSON.stringify(
      {
        initialState: snapshot,
        acceptedMutationId: create.mutationId,
        acceptedPostWriteState: {
          stateEpoch: create.stateEpoch,
          stateRevision: create.stateRevision,
        },
        staleWriteError: staleError,
        rejectedHierarchyMatches: rejectedMatches,
        afterUndoState: {
          stateEpoch: afterUndo.stateEpoch,
          stateRevision: afterUndo.stateRevision,
        },
        acceptedHierarchyMatchesAfterUndo: countHierarchyName(afterUndo, acceptedName),
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] State revision verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForStateRevisionCapability(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No Unity status received.";

  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError && typeof result.structuredContent === "object" && result.structuredContent !== null) {
      const status = result.structuredContent as Record<string, unknown>;
      const capabilities = status.capabilities;
      if (
        Array.isArray(capabilities) &&
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
    `Timed out waiting for state.revision.v1. Last observation: ${last}. Reimport/restart Unity if it is still running an older Agent assembly.`,
  );
}

async function createAgainstFreshSnapshot(
  name: string,
): Promise<{ snapshot: HierarchyPayload; create: CreatePayload }> {
  let lastError = "No attempt made.";

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const snapshot = await readHierarchy();
    const mutationId = `verify-state-accepted-${randomUUID()}`;
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

    console.log(
      `[Unity AI Bridge] State changed between snapshot and preflight on attempt ${attempt}; refreshing and retrying with a new mutationId...`,
    );
  }

  throw new Error(`Could not obtain a stable fresh-state window. Last error: ${lastError}`);
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

async function waitUntilNameMissing(
  name: string,
  minimumPreviousRevision: number,
): Promise<HierarchyPayload> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hierarchy = await readHierarchy();
    if (
      countHierarchyName(hierarchy, name) === 0 &&
      hierarchy.stateRevision > minimumPreviousRevision
    ) {
      return hierarchy;
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    "Timed out waiting for the accepted object to disappear and the state revision to advance. Press Ctrl+Z once in Unity while the verifier is waiting.",
  );
}

function countHierarchyName(value: HierarchyPayload, name: string): number {
  return value.nodes.filter(
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type HierarchyPayload = {
  stateEpoch: string;
  stateRevision: number;
  nodes: Array<Record<string, unknown>>;
};

type CreatePayload = {
  mutationId: string;
  replayed: boolean;
  globalObjectId: string;
  stateEpoch: string;
  stateRevision: number;
  expectedStateEpoch: string;
  expectedStateRevision: number;
};

function isHierarchyPayload(value: unknown): value is HierarchyPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isStateRevision(candidate.stateEpoch, candidate.stateRevision) &&
    Array.isArray(candidate.nodes)
  );
}

function isCreatePayload(value: unknown): value is CreatePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    candidate.mutationId.length > 0 &&
    candidate.replayed === false &&
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    isStateRevision(candidate.stateEpoch, candidate.stateRevision) &&
    typeof candidate.expectedStateEpoch === "string" &&
    typeof candidate.expectedStateRevision === "number" &&
    Number.isSafeInteger(candidate.expectedStateRevision) &&
    candidate.expectedStateRevision > 0
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
