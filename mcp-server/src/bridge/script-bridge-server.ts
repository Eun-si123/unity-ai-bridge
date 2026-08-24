import { AssetBridgeServer } from "./asset-bridge-server.js";

export interface ScriptReadOptions {
  path: string;
  offset?: number;
  maxChars?: number;
}

export interface ScriptReadPayload {
  guid: string;
  path: string;
  sourceKind: "Assets" | "Packages";
  packageName: string;
  dependencyHash: string;
  contentSha256: string;
  encoding: "utf-8";
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

const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 100_000;
const MAX_OFFSET = 2_147_483_647;
const MAX_PATH_LENGTH = 512;

export class ScriptBridgeServer extends AssetBridgeServer {
  public async requestReadScript(
    options: ScriptReadOptions,
    timeoutMs = 5000,
  ): Promise<ScriptReadPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateScriptPath(options.path);
    const offset = options.offset ?? 0;
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    validateSafeInteger(offset, "offset", 0, MAX_OFFSET);
    validateSafeInteger(maxChars, "maxChars", 1, MAX_CHARS);

    const result = await this.requestOperation(
      "script.read",
      { path: options.path, offset, maxChars },
      { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
      timeoutMs,
      "read",
    );

    if (!isScriptReadPayload(result)) {
      throw new Error("Unity returned an invalid script.read payload.");
    }
    return result;
  }
}

function validateScriptPath(path: string): void {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new Error(`path must contain 1..${MAX_PATH_LENGTH} characters.`);
  }
  if (path.includes("\\")) {
    throw new Error("path must use Unity project-relative forward slashes.");
  }
  if (!/\.cs$/i.test(path)) {
    throw new Error("script.read requires an exact .cs asset path.");
  }
  if (!path.startsWith("Assets/") && !path.startsWith("Packages/")) {
    throw new Error("script.read paths must be under Assets or Packages.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("path must not contain empty, '.' or '..' segments.");
  }
}

function validateSafeInteger(value: number, name: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in the range ${min}..${max}.`);
  }
}

function isScriptReadPayload(value: unknown): value is ScriptReadPayload {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.guid) || !isNonEmptyString(value.path)) return false;
  if (value.sourceKind !== "Assets" && value.sourceKind !== "Packages") return false;
  if (typeof value.packageName !== "string") return false;
  if (!isNonEmptyString(value.dependencyHash)) return false;
  if (!/^[0-9a-f]{64}$/.test(String(value.contentSha256))) return false;
  if (value.encoding !== "utf-8" || typeof value.hasUtf8Bom !== "boolean") return false;

  const byteLength = nonNegativeInteger(value.byteLength);
  const utf16CharCount = nonNegativeInteger(value.utf16CharCount);
  const lineCount = nonNegativeInteger(value.lineCount);
  const offset = nonNegativeInteger(value.offset);
  const maxChars = nonNegativeInteger(value.maxChars);
  const returnedCharCount = nonNegativeInteger(value.returnedCharCount);
  const nextOffset = nonNegativeInteger(value.nextOffset);
  if (
    byteLength === undefined ||
    utf16CharCount === undefined ||
    lineCount === undefined ||
    offset === undefined ||
    maxChars === undefined ||
    returnedCharCount === undefined ||
    nextOffset === undefined
  ) {
    return false;
  }

  if (offset > MAX_OFFSET || nextOffset > MAX_OFFSET) return false;
  if (maxChars < 1 || maxChars > MAX_CHARS) return false;
  if (offset > utf16CharCount || nextOffset > utf16CharCount) return false;
  if (nextOffset !== offset + returnedCharCount) return false;
  if (typeof value.truncated !== "boolean" || typeof value.content !== "string") return false;
  if (value.content.length !== returnedCharCount) return false;
  if (value.truncated !== (nextOffset < utf16CharCount)) return false;
  if (value.sourceKind === "Assets" && value.packageName.length !== 0) return false;
  if (value.sourceKind === "Packages" && value.packageName.length === 0) return false;
  return true;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
