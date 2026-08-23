import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 30_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-scene-save-verifier",
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
  for (const required of ["unity_get_hierarchy", "unity_save_active_scene"]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for Unity scene-save capability...");
  const initial = await waitForHierarchy();
  if (initial.scenePath.length === 0) {
    throw new Error(
      "The active scene has no asset path. Save it once in Unity before verifying explicit scene.save.",
    );
  }

  const mutationId = `verify-save-${randomUUID()}`;
  const first = await callSave({
    expectedScenePath: initial.scenePath,
    mutationId,
    expectedStateEpoch: initial.stateEpoch,
    expectedStateRevision: initial.stateRevision,
  });

  if (first.alreadyClean || !first.saved || !first.wasDirty) {
    throw new Error(
      "scene.save reached a clean-scene no-op instead of a real disk write. For the merge gate, first run Tools -> Unity AI Bridge -> Verify Transaction Rollback once on a clean saved scene; its verified rollback leaves only dirty metadata residue. Then rerun verify:save without pressing Ctrl+S.",
    );
  }
  assertSaveIdentity(first, initial, mutationId);
  if (first.isDirty) {
    throw new Error("scene.save returned success but the scene is still dirty.");
  }
  if (
    first.stateEpoch !== initial.stateEpoch ||
    first.stateRevision <= initial.stateRevision
  ) {
    throw new Error(
      `scene.save did not advance the state token as expected. before=${initial.stateEpoch}/${initial.stateRevision}, after=${first.stateEpoch}/${first.stateRevision}`,
    );
  }

  console.log("[Unity AI Bridge] Explicit dirty scene save PASS; verifying same-id replay...");
  const replay = await callSave({
    expectedScenePath: initial.scenePath,
    mutationId,
    expectedStateEpoch: initial.stateEpoch,
    expectedStateRevision: initial.stateRevision,
  });
  if (!replay.replayed) {
    throw new Error("Same scene.save mutationId did not replay the completed result.");
  }
  if (replay.isDirty || replay.scenePath !== first.scenePath) {
    throw new Error("scene.save replay no longer matches the clean saved scene.");
  }

  console.log("[Unity AI Bridge] Completed save replay PASS; verifying stale new save rejection...");
  const staleMutationId = `verify-save-stale-${randomUUID()}`;
  const stale = await client.callTool({
    name: "unity_save_active_scene",
    arguments: {
      expectedScenePath: initial.scenePath,
      mutationId: staleMutationId,
      expectedStateEpoch: initial.stateEpoch,
      expectedStateRevision: initial.stateRevision,
    },
  });
  if (!stale.isError) {
    throw new Error(
      "A new scene.save intent using the pre-save stale state token unexpectedly succeeded.",
    );
  }
  const staleText = readToolText(stale);
  if (!staleText.includes("stale_state/state_revision_mismatch")) {
    throw new Error(`Expected stale-state rejection, got: ${staleText}`);
  }

  const after = await waitForHierarchy();
  if (after.scenePath !== initial.scenePath) {
    throw new Error(
      `Active scene changed during verification. before=${initial.scenePath}, after=${after.scenePath}`,
    );
  }

  console.log("[Unity AI Bridge] Explicit scene save + replay + stale-state protection PASS:");
  console.log(
    JSON.stringify(
      {
        initialState: {
          scenePath: initial.scenePath,
          stateEpoch: initial.stateEpoch,
          stateRevision: initial.stateRevision,
        },
        save: first,
        replay: {
          replayed: replay.replayed,
          stateEpoch: replay.stateEpoch,
          stateRevision: replay.stateRevision,
          isDirty: replay.isDirty,
        },
        staleSaveError: staleText,
        afterState: {
          scenePath: after.scenePath,
          stateEpoch: after.stateEpoch,
          stateRevision: after.stateRevision,
        },
      },
      null,
      2,
    ),
  );
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Explicit scene save verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

type HierarchySnapshot = {
  sceneName: string;
  scenePath: string;
  stateEpoch: string;
  stateRevision: number;
};

type SceneSaveResult = {
  mutationId: string;
  replayed: boolean;
  saved: boolean;
  alreadyClean: boolean;
  sceneName: string;
  scenePath: string;
  wasDirty: boolean;
  isDirty: boolean;
  expectedScenePath: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
  stateEpoch: string;
  stateRevision: number;
};

async function waitForHierarchy(): Promise<HierarchySnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastObservation = "No hierarchy returned.";

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_get_hierarchy",
      arguments: { maxDepth: 1, maxNodes: 20 },
    });
    if (!result.isError) {
      const parsed = parseHierarchy(result.structuredContent);
      if (parsed !== null) {
        return parsed;
      }
      lastObservation = JSON.stringify(result.structuredContent);
    } else {
      lastObservation = readToolText(result);
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for a live hierarchy/state token. Last observation: ${lastObservation}`,
  );
}

async function callSave(argumentsValue: {
  expectedScenePath: string;
  mutationId: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
}): Promise<SceneSaveResult> {
  const result = await client.callTool({
    name: "unity_save_active_scene",
    arguments: argumentsValue,
  });
  if (result.isError) {
    throw new Error(readToolText(result));
  }

  const parsed = parseSave(result.structuredContent);
  if (parsed === null) {
    throw new Error(
      `unity_save_active_scene returned an invalid payload: ${JSON.stringify(result.structuredContent)}`,
    );
  }
  return parsed;
}

function assertSaveIdentity(
  save: SceneSaveResult,
  initial: HierarchySnapshot,
  mutationId: string,
): void {
  if (
    save.mutationId !== mutationId ||
    save.replayed ||
    save.scenePath !== initial.scenePath ||
    save.expectedScenePath !== initial.scenePath ||
    save.expectedStateEpoch !== initial.stateEpoch ||
    save.expectedStateRevision !== initial.stateRevision
  ) {
    throw new Error(`scene.save identity/precondition mismatch: ${JSON.stringify(save)}`);
  }
}

function parseHierarchy(value: unknown): HierarchySnapshot | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sceneName !== "string" ||
    typeof candidate.scenePath !== "string" ||
    typeof candidate.stateEpoch !== "string" ||
    candidate.stateEpoch.length === 0 ||
    typeof candidate.stateRevision !== "number" ||
    !Number.isSafeInteger(candidate.stateRevision) ||
    candidate.stateRevision <= 0
  ) {
    return null;
  }
  return {
    sceneName: candidate.sceneName,
    scenePath: candidate.scenePath,
    stateEpoch: candidate.stateEpoch,
    stateRevision: candidate.stateRevision,
  };
}

function parseSave(value: unknown): SceneSaveResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mutationId !== "string" ||
    typeof candidate.replayed !== "boolean" ||
    typeof candidate.saved !== "boolean" ||
    typeof candidate.alreadyClean !== "boolean" ||
    typeof candidate.sceneName !== "string" ||
    typeof candidate.scenePath !== "string" ||
    typeof candidate.wasDirty !== "boolean" ||
    typeof candidate.isDirty !== "boolean" ||
    typeof candidate.expectedScenePath !== "string" ||
    typeof candidate.expectedStateEpoch !== "string" ||
    typeof candidate.expectedStateRevision !== "number" ||
    typeof candidate.stateEpoch !== "string" ||
    typeof candidate.stateRevision !== "number"
  ) {
    return null;
  }
  return candidate as unknown as SceneSaveResult;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
