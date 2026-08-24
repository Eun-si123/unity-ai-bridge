import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 60_000;
const pollIntervalMs = 300;
const scriptPath = "Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs";
const chunkSize = 64;

const client = new Client({
  name: "unity-ai-bridge-script-read-verifier",
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
  if (!tools.some((tool) => tool.name === "unity_read_script")) {
    throw new Error("MCP server did not advertise unity_read_script.");
  }
  if (!tools.some((tool) => tool.name === "unity_get_status")) {
    throw new Error("MCP server did not advertise unity_get_status.");
  }

  console.log("[Unity AI Bridge] Waiting for script.read Unity capability...");
  const status = await waitForScriptReadCapability();

  let offset = 0;
  let first: ScriptReadPayload | undefined;
  let chunks = 0;
  let reconstructed = "";

  while (true) {
    const payload = await readScript(offset, chunkSize);
    chunks++;

    if (first === undefined) {
      first = payload;
      if (payload.path !== scriptPath) {
        throw new Error(`Unity canonicalized the script to an unexpected path: ${payload.path}`);
      }
      if (payload.sourceKind !== "Packages" || payload.packageName !== "com.eunsung.unity-ai-bridge") {
        throw new Error(`Unexpected package identity: ${JSON.stringify(payload)}`);
      }
      if (!/^[0-9a-f]{64}$/.test(payload.contentSha256)) {
        throw new Error(`Invalid raw SHA-256: ${payload.contentSha256}`);
      }
      if (payload.byteLength <= 0 || payload.utf16CharCount <= 0 || payload.lineCount <= 0) {
        throw new Error(`Script metadata reported non-positive source dimensions: ${JSON.stringify(payload)}`);
      }
    } else {
      if (
        payload.guid !== first.guid ||
        payload.path !== first.path ||
        payload.dependencyHash !== first.dependencyHash ||
        payload.contentSha256 !== first.contentSha256 ||
        payload.byteLength !== first.byteLength ||
        payload.utf16CharCount !== first.utf16CharCount ||
        payload.lineCount !== first.lineCount ||
        payload.encoding !== first.encoding ||
        payload.hasUtf8Bom !== first.hasUtf8Bom
      ) {
        throw new Error(
          `Script identity/content metadata changed between read chunks: ${JSON.stringify({ first, payload })}`,
        );
      }
    }

    if (payload.offset !== offset || payload.returnedCharCount !== payload.content.length) {
      throw new Error(`Script chunk offsets/counts are inconsistent: ${JSON.stringify(payload)}`);
    }
    if (payload.nextOffset !== payload.offset + payload.returnedCharCount) {
      throw new Error(`Script nextOffset is inconsistent: ${JSON.stringify(payload)}`);
    }

    reconstructed += payload.content;
    offset = payload.nextOffset;

    if (!payload.truncated) {
      break;
    }
    if (payload.returnedCharCount === 0) {
      throw new Error("A truncated script chunk made no paging progress.");
    }
    if (chunks > 10_000) {
      throw new Error("Script verifier exceeded its defensive chunk-count limit.");
    }
  }

  if (first === undefined) {
    throw new Error("No script chunk was returned.");
  }
  if (reconstructed.length !== first.utf16CharCount || offset !== first.utf16CharCount) {
    throw new Error(
      `Reconstructed source length disagreed with Unity metadata: ${JSON.stringify({ reconstructed: reconstructed.length, offset, expected: first.utf16CharCount })}`,
    );
  }
  if (!reconstructed.includes("internal static class BridgeProtocol")) {
    throw new Error("Reconstructed BridgeProtocol.cs did not contain the expected type declaration.");
  }
  if (!reconstructed.includes("PackageVersion")) {
    throw new Error("Reconstructed BridgeProtocol.cs did not contain the expected package-version declaration.");
  }

  const repeat = await readScript(0, Math.min(chunkSize, first.utf16CharCount || chunkSize));
  if (
    repeat.guid !== first.guid ||
    repeat.contentSha256 !== first.contentSha256 ||
    repeat.dependencyHash !== first.dependencyHash ||
    repeat.content !== first.content
  ) {
    throw new Error("Immediate repeat read changed script identity/hash/content without an intervening write.");
  }

  console.log("[Unity AI Bridge] Script read MCP end-to-end reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: readString(status, "unityVersion"),
    scriptPath: first.path,
    guid: first.guid,
    sourceKind: first.sourceKind,
    packageName: first.packageName,
    dependencyHash: first.dependencyHash,
    contentSha256: first.contentSha256,
    encoding: first.encoding,
    hasUtf8Bom: first.hasUtf8Bom,
    byteLength: first.byteLength,
    utf16CharCount: first.utf16CharCount,
    lineCount: first.lineCount,
    chunkSize,
    chunkCount: chunks,
    reconstructedExactly: true,
    chunkIdentityStable: true,
    immediateRepeatStable: true,
    projectMutated: false,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Script read MCP verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForScriptReadCapability(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = "No status result received.";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError) {
      const record = asRecord(result.structuredContent);
      if (record !== null) {
        const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
        if (capabilities.includes("script.read")) {
          return record;
        }
        last = JSON.stringify(capabilities);
      }
    } else {
      last = readToolText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for script.read Agent capability. Last observation: ${last}`);
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

function parseScriptRead(value: unknown): ScriptReadPayload {
  const record = asRecord(value);
  if (record === null) {
    throw new Error(`Invalid script.read structuredContent: ${JSON.stringify(value)}`);
  }

  const payload: ScriptReadPayload = {
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

  return payload;
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
