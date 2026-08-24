import { writeFile } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const scriptPath = "Assets/UnityAiBridge_ScriptReplaceVerify.cs";
const sentinel = "UNITY_AI_BRIDGE_SCRIPT_REPLACE_VERIFIER";
const originalValueLine = "public const int UnityAiBridgeVerifierValue = 1;";
const modifiedValueLine = "public const int UnityAiBridgeVerifierValue = 2;";
const chunkSize = 20_000;

const client = new Client({
  name: "unity-ai-bridge-script-replace-verifier",
  version: "0.0.1",
});
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

let original: FullScript | undefined;
let modifiedSha: string | undefined;
let writeMutationId: string | undefined;
let restored = false;

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of ["unity_get_status", "unity_read_script", "unity_replace_script"]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] Waiting for script.replace Unity capability...");
  const statusBefore = await waitForScriptReplaceCapability();
  if (readBoolean(statusBefore, "isCompiling")) {
    throw new Error("Unity is compiling before the script.replace verifier begins.");
  }

  original = await readFullScript();
  validateVerifierSource(original);

  const modifiedContent = replaceExactlyOnce(
    original.content,
    originalValueLine,
    modifiedValueLine,
  );
  writeMutationId = `verify-script-replace-write-${Date.now()}`;

  console.log(`[Unity AI Bridge] Replacing verifier value 1 -> 2 in ${scriptPath}...`);
  const writeResult = await replaceScript(
    original,
    modifiedContent,
    writeMutationId,
  );
  requireSuccessfulCompile(writeResult, "initial write");
  if (!writeResult.changed) {
    throw new Error("Initial verifier write unexpectedly reported changed=false.");
  }
  if (!writeResult.postReloadReadbackVerified) {
    throw new Error("Initial verifier write did not verify post-reload Script readback.");
  }
  if (!writeResult.reloadObserved) {
    throw new Error(
      "Initial verifier write compiled successfully but no Unity connection-generation change was observed. " +
      "The script.replace live gate requires a real domain reload/reconnect.",
    );
  }
  modifiedSha = writeResult.contentSha256After;

  const modified = await readFullScript();
  if (modified.guid !== original.guid || modified.contentSha256 !== modifiedSha) {
    throw new Error("Fresh Script readback did not match the initial write result.");
  }
  if (!modified.content.includes(modifiedValueLine) || modified.content.includes(originalValueLine)) {
    throw new Error("Fresh Script readback did not contain the expected verifier value 2 state.");
  }

  console.log("[Unity AI Bridge] Replaying the exact same mutationId; no second source write is allowed...");
  const replay = await replaceScript(
    original,
    modifiedContent,
    writeMutationId,
  );
  if (!replay.replayed) {
    throw new Error(`Same-id script.replace did not report replayed=true: ${JSON.stringify(replay)}`);
  }
  if (replay.contentSha256After !== modifiedSha) {
    throw new Error("Same-id replay changed the recorded target SHA.");
  }

  const afterReplay = await readFullScript();
  if (afterReplay.contentSha256 !== modifiedSha || afterReplay.content !== modified.content) {
    throw new Error("Same-id replay changed source bytes instead of remaining readback-only.");
  }

  console.log("[Unity AI Bridge] Proving stale old-SHA CAS rejects without touching the modified file...");
  const staleResult = await client.callTool({
    name: "unity_replace_script",
    arguments: {
      path: scriptPath,
      expectedGuid: original.guid,
      expectedContentSha256: original.contentSha256,
      content: original.content,
      mutationId: `verify-script-replace-stale-${Date.now()}`,
    },
  });
  if (!staleResult.isError) {
    throw new Error("Stale old-SHA script.replace unexpectedly succeeded.");
  }
  const staleText = readToolText(staleResult);
  if (!staleText.includes("stale_content")) {
    throw new Error(`Stale CAS rejection did not expose stale_content: ${staleText}`);
  }
  const afterStale = await readFullScript();
  if (afterStale.contentSha256 !== modifiedSha || afterStale.content !== modified.content) {
    throw new Error("Stale CAS attempt changed the verifier source.");
  }

  console.log("[Unity AI Bridge] Restoring the verifier's exact original source through a fresh CAS write...");
  const restoreMutationId = `verify-script-replace-restore-${Date.now()}`;
  const restore = await replaceScript(
    afterStale,
    original.content,
    restoreMutationId,
  );
  requireSuccessfulCompile(restore, "restore");
  if (!restore.changed || !restore.postReloadReadbackVerified) {
    throw new Error(`Restore did not report a verified source change: ${JSON.stringify(restore)}`);
  }
  if (!restore.reloadObserved) {
    throw new Error("Restore compile succeeded but the live gate did not observe its domain reload/reconnect.");
  }

  const finalRead = await readFullScript();
  if (
    finalRead.guid !== original.guid ||
    finalRead.contentSha256 !== original.contentSha256 ||
    finalRead.content !== original.content
  ) {
    throw new Error("Verifier cleanup did not restore the exact original GUID/SHA/content.");
  }
  restored = true;

  const statusAfter = await waitForScriptReplaceCapability();
  console.log("[Unity AI Bridge] Script replace MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: readString(statusAfter, "unityVersion"),
    scriptPath,
    guid: original.guid,
    originalContentSha256: original.contentSha256,
    modifiedContentSha256: modifiedSha,
    writeMutationId,
    writeCompileStatus: writeResult.compileStatus,
    writeCompilationSequence: writeResult.compilationSequence,
    writeReloadObserved: writeResult.reloadObserved,
    writeInitialConnectionGeneration: writeResult.initialConnectionGeneration,
    writeFinalConnectionGeneration: writeResult.finalConnectionGeneration,
    sameIdReplayReadOnly: true,
    staleOldShaRejected: true,
    staleAttemptLeftModifiedBytesUnchanged: true,
    restoreCompileStatus: restore.compileStatus,
    restoreReloadObserved: restore.reloadObserved,
    exactOriginalRestored: true,
    finalContentSha256: finalRead.contentSha256,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Script replace MCP verification FAILED:\n${message}`);
  process.exitCode = 1;

  if (original !== undefined && !restored) {
    console.error("[Unity AI Bridge] Attempting guarded automatic verifier-source recovery...");
    try {
      const current = await readFullScript();
      if (current.guid !== original.guid) {
        throw new Error(
          `Verifier script GUID changed; refusing automatic recovery. expected=${original.guid} observed=${current.guid}`,
        );
      }
      if (current.contentSha256 === original.contentSha256 && current.content === original.content) {
        restored = true;
        console.error("[Unity AI Bridge] Verifier source was already at the exact original state.");
      } else if (modifiedSha !== undefined && current.contentSha256 === modifiedSha) {
        const recovery = await replaceScript(
          current,
          original.content,
          `verify-script-replace-recovery-${Date.now()}`,
        );
        if (recovery.contentSha256After !== original.contentSha256) {
          throw new Error("Guarded recovery returned an unexpected target SHA.");
        }
        const recovered = await readFullScript();
        if (recovered.contentSha256 !== original.contentSha256 || recovered.content !== original.content) {
          throw new Error("Guarded recovery did not restore exact original source.");
        }
        restored = true;
        console.error("[Unity AI Bridge] Guarded automatic recovery restored the exact original source.");
      } else {
        throw new Error(
          `Current SHA ${current.contentSha256} is neither the recorded original nor verifier-modified SHA; ` +
          "refusing to overwrite a possible concurrent human edit.",
        );
      }
    } catch (recoveryError) {
      const recoveryMessage = recoveryError instanceof Error
        ? recoveryError.stack ?? recoveryError.message
        : String(recoveryError);
      console.error(`[Unity AI Bridge] Automatic recovery FAILED:\n${recoveryMessage}`);
      try {
        const recoveryPath = `UnityAiBridge_ScriptReplaceVerify_RECOVERY_${Date.now()}.cs`;
        await writeFile(recoveryPath, original.content, { encoding: "utf8", flag: "wx" });
        console.error(
          `[Unity AI Bridge] Exact original verifier source was saved locally as ${recoveryPath}. ` +
          `Do not overwrite ${scriptPath} until you inspect its current SHA/state.`,
        );
      } catch (fileError) {
        console.error(
          `[Unity AI Bridge] Could not write a local recovery copy: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
        );
      }
    }
  }
} finally {
  await client.close();
}

async function waitForScriptReplaceCapability(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = "No status result received.";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError) {
      const record = asRecord(result.structuredContent);
      if (record !== null) {
        const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
        if (capabilities.includes("script.read") && capabilities.includes("script.replace")) {
          return record;
        }
        last = JSON.stringify(capabilities);
      }
    } else {
      last = readToolText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for Script capabilities. Last observation: ${last}`);
}

async function replaceScript(
  observation: FullScript,
  content: string,
  mutationId: string,
): Promise<ScriptReplacePayload> {
  const result = await client.callTool({
    name: "unity_replace_script",
    arguments: {
      path: scriptPath,
      expectedGuid: observation.guid,
      expectedContentSha256: observation.contentSha256,
      content,
      mutationId,
    },
  });
  if (result.isError) {
    throw new Error(`unity_replace_script failed: ${readToolText(result)}`);
  }
  return parseScriptReplace(result.structuredContent);
}

async function readFullScript(): Promise<FullScript> {
  let offset = 0;
  let first: ScriptReadPayload | undefined;
  let content = "";
  let chunks = 0;

  while (true) {
    const payload = await readScript(offset, chunkSize);
    if (first === undefined) first = payload;
    else requireSameReadIdentity(first, payload);

    content += payload.content;
    offset = payload.nextOffset;
    chunks++;
    if (!payload.truncated) break;
    if (payload.returnedCharCount <= 0 || chunks > 1_000) {
      throw new Error("Script read paging made no progress or exceeded its defensive limit.");
    }
  }

  if (first === undefined || content.length !== first.utf16CharCount) {
    throw new Error("Could not reconstruct the full verifier script from bounded reads.");
  }
  return { ...first, content };
}

async function readScript(offset: number, maxChars: number): Promise<ScriptReadPayload> {
  const result = await client.callTool({
    name: "unity_read_script",
    arguments: { path: scriptPath, offset, maxChars },
  });
  if (result.isError) {
    throw new Error(`unity_read_script failed: ${readToolText(result)}`);
  }
  return parseScriptRead(result.structuredContent);
}

function validateVerifierSource(source: FullScript): void {
  if (source.path !== scriptPath || source.sourceKind !== "Assets" || source.packageName !== "") {
    throw new Error(`Unexpected verifier script identity/scope: ${JSON.stringify(source)}`);
  }
  if (!source.content.includes(sentinel)) {
    throw new Error(
      `${scriptPath} does not contain the required '${sentinel}' sentinel; refusing to edit it.`,
    );
  }
  if (!source.content.includes("UnityAiBridgeScriptReplaceVerifier")) {
    throw new Error(`${scriptPath} does not contain the expected verifier type name; refusing to edit it.`);
  }
  if (countOccurrences(source.content, originalValueLine) !== 1) {
    throw new Error(
      `${scriptPath} must contain exactly one '${originalValueLine}' before verification.`,
    );
  }
  if (source.content.includes(modifiedValueLine)) {
    throw new Error(
      `${scriptPath} already contains the modified verifier value. Restore it to 1 before starting a new gate.`,
    );
  }
}

function requireSuccessfulCompile(result: ScriptReplacePayload, stage: string): void {
  if (result.compileStatus !== "succeeded") {
    throw new Error(
      `${stage} did not complete with compileStatus=succeeded: ${JSON.stringify(result, null, 2)}`,
    );
  }
  if (result.compilerErrorCount !== 0) {
    throw new Error(`${stage} reported compiler errors despite compileStatus=succeeded.`);
  }
  if (!result.importRequested) {
    throw new Error(`${stage} changed source bytes but did not report an import request.`);
  }
}

function replaceExactlyOnce(source: string, from: string, to: string): string {
  if (countOccurrences(source, from) !== 1) {
    throw new Error(`Expected exactly one verifier replacement token '${from}'.`);
  }
  return source.replace(from, to);
}

function countOccurrences(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let position = 0;
  while (true) {
    const index = source.indexOf(needle, position);
    if (index < 0) return count;
    count++;
    position = index + needle.length;
  }
}

function requireSameReadIdentity(first: ScriptReadPayload, next: ScriptReadPayload): void {
  for (const key of [
    "guid",
    "path",
    "sourceKind",
    "packageName",
    "dependencyHash",
    "contentSha256",
    "encoding",
    "hasUtf8Bom",
    "byteLength",
    "utf16CharCount",
    "lineCount",
  ] as const) {
    if (next[key] !== first[key]) {
      throw new Error(`Script identity changed between chunks for ${key}.`);
    }
  }
}

function parseScriptReplace(value: unknown): ScriptReplacePayload {
  const record = requireRecord(value, "script.replace structuredContent");
  const messages = record.compilerMessages;
  if (!Array.isArray(messages)) {
    throw new Error(`Expected compilerMessages array: ${JSON.stringify(record)}`);
  }
  return {
    mutationId: readString(record, "mutationId"),
    replayed: readBoolean(record, "replayed"),
    reconciled: readBoolean(record, "reconciled"),
    changed: readBoolean(record, "changed"),
    path: readString(record, "path"),
    guid: readString(record, "guid"),
    expectedContentSha256: readString(record, "expectedContentSha256"),
    contentSha256After: readString(record, "contentSha256After"),
    importRequested: readBoolean(record, "importRequested"),
    compileStatus: readString(record, "compileStatus"),
    compilationSequence: readNonNegativeInteger(record, "compilationSequence"),
    compilerErrorCount: readNonNegativeInteger(record, "compilerErrorCount"),
    compilerWarningCount: readNonNegativeInteger(record, "compilerWarningCount"),
    postReloadReadbackVerified: readBoolean(record, "postReloadReadbackVerified"),
    reloadObserved: readBoolean(record, "reloadObserved"),
    initialConnectionGeneration: readPositiveInteger(record, "initialConnectionGeneration"),
    finalConnectionGeneration: readPositiveInteger(record, "finalConnectionGeneration"),
  };
}

function parseScriptRead(value: unknown): ScriptReadPayload {
  const record = requireRecord(value, "script.read structuredContent");
  return {
    guid: readString(record, "guid"),
    path: readString(record, "path"),
    sourceKind: readString(record, "sourceKind"),
    packageName: readString(record, "packageName", true),
    dependencyHash: readString(record, "dependencyHash"),
    contentSha256: readString(record, "contentSha256"),
    encoding: readString(record, "encoding"),
    hasUtf8Bom: readBoolean(record, "hasUtf8Bom"),
    byteLength: readNonNegativeInteger(record, "byteLength"),
    utf16CharCount: readNonNegativeInteger(record, "utf16CharCount"),
    lineCount: readNonNegativeInteger(record, "lineCount"),
    offset: readNonNegativeInteger(record, "offset"),
    maxChars: readPositiveInteger(record, "maxChars"),
    returnedCharCount: readNonNegativeInteger(record, "returnedCharCount"),
    nextOffset: readNonNegativeInteger(record, "nextOffset"),
    truncated: readBoolean(record, "truncated"),
    content: readString(record, "content", true),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (record === null) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`);
  }
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`Expected ${key} to be ${allowEmpty ? "a string" : "a non-empty string"}: ${JSON.stringify(record)}`);
  }
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Expected ${key} to be boolean: ${JSON.stringify(record)}`);
  }
  return value;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Expected ${key} to be a non-negative integer: ${JSON.stringify(record)}`);
  }
  return value as number;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = readNonNegativeInteger(record, key);
  if (value <= 0) {
    throw new Error(`Expected ${key} to be positive: ${JSON.stringify(record)}`);
  }
  return value;
}

function readToolText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "No text error returned.";
  return result.content
    .map((entry) => {
      const record = asRecord(entry);
      return record !== null && typeof record.text === "string" ? record.text : "";
    })
    .filter((value) => value.length > 0)
    .join("\n");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ScriptReadPayload {
  guid: string;
  path: string;
  sourceKind: string;
  packageName: string;
  dependencyHash: string;
  contentSha256: string;
  encoding: string;
  hasUtf8Bom: boolean;
  byteLength: number;
  utf16CharCount: number;
  lineCount: number;
  offset: number;
  maxChars: number;
  returnedCharCount: number;
  nextOffset: number;
  truncated: boolean;
  content: string;
}

interface FullScript extends ScriptReadPayload {
  content: string;
}

interface ScriptReplacePayload {
  mutationId: string;
  replayed: boolean;
  reconciled: boolean;
  changed: boolean;
  path: string;
  guid: string;
  expectedContentSha256: string;
  contentSha256After: string;
  importRequested: boolean;
  compileStatus: string;
  compilationSequence: number;
  compilerErrorCount: number;
  compilerWarningCount: number;
  postReloadReadbackVerified: boolean;
  reloadObserved: boolean;
  initialConnectionGeneration: number;
  finalConnectionGeneration: number;
}
