import { randomUUID } from "node:crypto";

import { AssetBridgeServer } from "./asset-bridge-server.js";
import type { CompilerDiagnosticPayload, DiagnosticsPayload } from "./local-bridge-server.js";

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

export interface ScriptReplaceOptions {
  path: string;
  expectedGuid: string;
  expectedContentSha256: string;
  content: string;
  mutationId?: string;
}

export type ScriptCompileStatus = "not_requested" | "succeeded" | "failed" | "not_observed";

export interface ScriptReplacePersistencePayload {
  mutationId: string;
  replayed: boolean;
  reconciled: boolean;
  changed: boolean;
  path: string;
  guid: string;
  expectedGuid: string;
  expectedContentSha256: string;
  contentSha256Before: string;
  contentSha256After: string;
  hasUtf8Bom: boolean;
  byteLengthBefore: number;
  byteLengthAfter: number;
  utf16CharCountAfter: number;
  lineCountAfter: number;
  baselineCompilationSequence: number;
  writeCompletedUnixMs: number;
  importRequested: boolean;
  importRequestedUnixMs: number;
  importCallReturned: boolean;
  importError: string;
}

export interface ScriptReplacePayload extends ScriptReplacePersistencePayload {
  compileStatus: ScriptCompileStatus;
  compilationSequence: number;
  compilationCompletedUnixMs: number;
  compilerErrorCount: number;
  compilerWarningCount: number;
  compilerMessagesTruncated: boolean;
  compilerMessages: CompilerDiagnosticPayload[];
  dependencyHashAfter: string;
  postReloadReadbackVerified: boolean;
  reloadObserved: boolean;
  initialConnectionGeneration: number;
  finalConnectionGeneration: number;
}

const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 100_000;
const MAX_OFFSET = 2_147_483_647;
const MAX_PATH_LENGTH = 512;
const MAX_REPLACEMENT_CHARS = 128_000;
const MAX_MUTATION_ID_LENGTH = 128;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const GUID_PATTERN = /^[0-9a-f]{32}$/i;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const DELIVERY_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 200;
const RELOAD_GRACE_MS = 5_000;

export class ScriptBridgeServer extends AssetBridgeServer {
  public async requestReadScript(
    options: ScriptReadOptions,
    timeoutMs = 5000,
  ): Promise<ScriptReadPayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateScriptPath(options.path, true);
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

  public async requestReplaceScript(
    options: ScriptReplaceOptions,
    timeoutMs = 60_000,
  ): Promise<ScriptReplacePayload> {
    const initialEditor = this.connectedEditor;
    if (initialEditor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    validateScriptPath(options.path, false);
    validateGuid(options.expectedGuid);
    validateSha256(options.expectedContentSha256, "expectedContentSha256");
    if (typeof options.content !== "string") {
      throw new Error("content must be a string.");
    }
    if (options.content.length > MAX_REPLACEMENT_CHARS) {
      throw new Error(`content must be at most ${MAX_REPLACEMENT_CHARS} UTF-16 code units.`);
    }

    const mutationId = options.mutationId ?? randomUUID();
    validateMutationId(mutationId);

    const args = {
      path: options.path,
      expectedGuid: options.expectedGuid,
      expectedContentSha256: options.expectedContentSha256,
      content: options.content,
      mutationId,
    };
    const totalDeadline = Date.now() + timeoutMs;

    let persistence: ScriptReplacePersistencePayload;
    try {
      persistence = await this.deliverScriptReplace(args, Math.min(DELIVERY_TIMEOUT_MS, timeoutMs));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isAmbiguousDeliveryError(message)) {
        throw new Error(`${message} mutationId=${mutationId}`);
      }

      await this.waitForSameEditor(initialEditor.editorId, totalDeadline);
      const remaining = remainingMs(totalDeadline);
      if (remaining <= 0) {
        throw new Error(
          `script.replace delivery became ambiguous and the Editor did not become available for reconciliation before timeout. mutationId=${mutationId}`,
        );
      }
      persistence = await this.deliverScriptReplace(args, Math.min(DELIVERY_TIMEOUT_MS, remaining));
    }

    if (!persistence.changed) {
      const finalRead = await this.readBackAfterReplace(
        persistence,
        initialEditor.editorId,
        totalDeadline,
      );
      return combineReplaceOutcome(
        persistence,
        "not_requested",
        emptyCompilation(),
        finalRead,
        initialEditor.connectionGeneration,
        this.connectedEditor?.connectionGeneration ?? initialEditor.connectionGeneration,
      );
    }

    const compilation = await this.waitForCompilationOutcome(
      persistence.baselineCompilationSequence,
      initialEditor.editorId,
      totalDeadline,
    );

    if (compilation === undefined) {
      const finalRead = await this.readBackAfterReplace(
        persistence,
        initialEditor.editorId,
        totalDeadline,
      );
      return combineReplaceOutcome(
        persistence,
        "not_observed",
        emptyCompilation(),
        finalRead,
        initialEditor.connectionGeneration,
        this.connectedEditor?.connectionGeneration ?? initialEditor.connectionGeneration,
      );
    }

    const errors = compilation.latestCompilation.messages.filter((message) => message.severity === "error");
    const compileStatus: ScriptCompileStatus = errors.length > 0 ? "failed" : "succeeded";

    // CompilationPipeline.compilationFinished can be observed just before Unity reloads
    // the newly compiled assemblies. Give a successful compile a small bounded window to
    // expose that expected connection-generation change instead of racing the reload.
    if (compileStatus === "succeeded") {
      await this.waitForExpectedReload(
        initialEditor.editorId,
        initialEditor.connectionGeneration,
        Math.min(totalDeadline, Date.now() + RELOAD_GRACE_MS),
      );
    }

    const finalRead = await this.readBackAfterReplace(
      persistence,
      initialEditor.editorId,
      totalDeadline,
    );
    const finalGeneration = this.connectedEditor?.connectionGeneration ?? initialEditor.connectionGeneration;

    return combineReplaceOutcome(
      persistence,
      compileStatus,
      compilation,
      finalRead,
      initialEditor.connectionGeneration,
      finalGeneration,
    );
  }

  private async deliverScriptReplace(
    args: {
      path: string;
      expectedGuid: string;
      expectedContentSha256: string;
      content: string;
      mutationId: string;
    },
    timeoutMs: number,
  ): Promise<ScriptReplacePersistencePayload> {
    const editor = this.connectedEditor;
    if (editor === undefined) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }

    const result = await this.requestOperation(
      "script.replace",
      args,
      { editorId: editor.editorId, connectionGeneration: editor.connectionGeneration },
      timeoutMs,
      "destructive",
    );
    if (!isScriptReplacePersistencePayload(result)) {
      throw new Error("Unity returned an invalid script.replace persistence payload.");
    }
    return result;
  }

  private async waitForCompilationOutcome(
    baselineSequence: number,
    editorId: string,
    deadlineUnixMs: number,
  ): Promise<DiagnosticsPayload | undefined> {
    while (remainingMs(deadlineUnixMs) > 0) {
      await this.ensureSameEditorAvailable(editorId, deadlineUnixMs);
      try {
        const diagnostics = await this.requestDiagnostics(
          { maxEntries: 200, minimumSeverity: "warning" },
          Math.min(2_000, Math.max(1, remainingMs(deadlineUnixMs))),
        );
        if (
          diagnostics.latestCompilation.sequence > baselineSequence &&
          diagnostics.latestCompilation.completedUnixMs > 0 &&
          !diagnostics.isCompiling
        ) {
          return diagnostics;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isAmbiguousDeliveryError(message) && !message.includes("No Unity Editor is connected")) {
          throw error;
        }
      }
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, remainingMs(deadlineUnixMs))));
    }
    return undefined;
  }

  private async waitForExpectedReload(
    editorId: string,
    initialConnectionGeneration: number,
    deadlineUnixMs: number,
  ): Promise<void> {
    while (remainingMs(deadlineUnixMs) > 0) {
      const current = this.connectedEditor;
      if (current === undefined) {
        await this.waitForSameEditor(editorId, deadlineUnixMs);
        continue;
      }
      if (current.editorId !== editorId) {
        throw new Error(
          `A different Unity Editor connected during script.replace reload observation. expectedEditorId=${editorId} observedEditorId=${current.editorId}`,
        );
      }
      if (current.connectionGeneration !== initialConnectionGeneration) {
        return;
      }
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, remainingMs(deadlineUnixMs))));
    }
  }

  private async readBackAfterReplace(
    persistence: ScriptReplacePersistencePayload,
    editorId: string,
    deadlineUnixMs: number,
  ): Promise<ScriptReadPayload> {
    while (remainingMs(deadlineUnixMs) > 0) {
      await this.ensureSameEditorAvailable(editorId, deadlineUnixMs);
      try {
        const readback = await this.requestReadScript(
          { path: persistence.path, offset: 0, maxChars: 1 },
          Math.min(2_000, Math.max(1, remainingMs(deadlineUnixMs))),
        );
        if (readback.guid.toLowerCase() !== persistence.guid.toLowerCase()) {
          throw new Error(
            `script.replace post-write GUID mismatch: expected ${persistence.guid}, observed ${readback.guid}.`,
          );
        }
        if (readback.contentSha256.toLowerCase() !== persistence.contentSha256After.toLowerCase()) {
          throw new Error(
            `script.replace post-write SHA mismatch: expected ${persistence.contentSha256After}, observed ${readback.contentSha256}.`,
          );
        }
        return readback;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isAmbiguousDeliveryError(message) && !message.includes("No Unity Editor is connected")) {
          throw error;
        }
      }
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, remainingMs(deadlineUnixMs))));
    }

    throw new Error(
      `script.replace persisted bytes but post-write Script readback was not available before timeout. mutationId=${persistence.mutationId}`,
    );
  }

  private async ensureSameEditorAvailable(editorId: string, deadlineUnixMs: number): Promise<void> {
    const current = this.connectedEditor;
    if (current !== undefined) {
      if (current.editorId !== editorId) {
        throw new Error(
          `A different Unity Editor connected during script.replace reconciliation. expectedEditorId=${editorId} observedEditorId=${current.editorId}`,
        );
      }
      return;
    }
    await this.waitForSameEditor(editorId, deadlineUnixMs);
  }

  private async waitForSameEditor(editorId: string, deadlineUnixMs: number): Promise<void> {
    while (remainingMs(deadlineUnixMs) > 0) {
      try {
        const hello = await this.waitForEditor(
          Math.min(2_000, Math.max(1, remainingMs(deadlineUnixMs))),
        );
        if (hello.editorId !== editorId) {
          throw new Error(
            `A different Unity Editor connected during script.replace reconciliation. expectedEditorId=${editorId} observedEditorId=${hello.editorId}`,
          );
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("different Unity Editor")) throw error;
      }
    }
  }
}

function validateScriptPath(path: string, allowPackages: boolean): void {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new Error(`path must contain 1..${MAX_PATH_LENGTH} characters.`);
  }
  if (path.includes("\\")) {
    throw new Error("path must use Unity project-relative forward slashes.");
  }
  if (!/\.cs$/i.test(path)) {
    throw new Error("Script workflows require an exact .cs asset path.");
  }
  const allowedRoot = path.startsWith("Assets/") || (allowPackages && path.startsWith("Packages/"));
  if (!allowedRoot) {
    throw new Error(
      allowPackages
        ? "script.read paths must be under Assets or Packages."
        : "script.replace paths must be under Assets; Packages are read-only.",
    );
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("path must not contain empty, '.' or '..' segments.");
  }
}

function validateGuid(value: string): void {
  if (typeof value !== "string" || !GUID_PATTERN.test(value)) {
    throw new Error("expectedGuid must be exactly 32 hexadecimal characters from unity_read_script.");
  }
}

function validateSha256(value: string, name: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be exactly 64 hexadecimal characters.`);
  }
}

function validateMutationId(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MUTATION_ID_LENGTH ||
    !MUTATION_ID_PATTERN.test(value)
  ) {
    throw new Error(
      "mutationId must be 1..128 characters using only letters, digits, '-', '_', '.', and ':'.",
    );
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
  if (!SHA256_PATTERN.test(String(value.contentSha256))) return false;
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

function isScriptReplacePersistencePayload(value: unknown): value is ScriptReplacePersistencePayload {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.mutationId)) return false;
  if (typeof value.replayed !== "boolean" || typeof value.reconciled !== "boolean") return false;
  if (typeof value.changed !== "boolean") return false;
  if (!isNonEmptyString(value.path) || !GUID_PATTERN.test(String(value.guid))) return false;
  if (!GUID_PATTERN.test(String(value.expectedGuid))) return false;
  if (!SHA256_PATTERN.test(String(value.expectedContentSha256))) return false;
  if (!SHA256_PATTERN.test(String(value.contentSha256Before))) return false;
  if (!SHA256_PATTERN.test(String(value.contentSha256After))) return false;
  if (typeof value.hasUtf8Bom !== "boolean") return false;
  for (const key of [
    "byteLengthBefore",
    "byteLengthAfter",
    "utf16CharCountAfter",
    "lineCountAfter",
    "baselineCompilationSequence",
    "writeCompletedUnixMs",
    "importRequestedUnixMs",
  ] as const) {
    if (nonNegativeInteger(value[key]) === undefined) return false;
  }
  if (typeof value.importRequested !== "boolean") return false;
  if (typeof value.importCallReturned !== "boolean") return false;
  if (typeof value.importError !== "string") return false;
  if (String(value.guid).toLowerCase() !== String(value.expectedGuid).toLowerCase()) return false;
  if (String(value.contentSha256Before).toLowerCase() !== String(value.expectedContentSha256).toLowerCase()) return false;
  if (value.changed && String(value.contentSha256After).toLowerCase() === String(value.contentSha256Before).toLowerCase()) return false;
  if (!value.changed && String(value.contentSha256After).toLowerCase() !== String(value.contentSha256Before).toLowerCase()) return false;
  if (!value.importRequested && value.importRequestedUnixMs !== 0) return false;
  return true;
}

function combineReplaceOutcome(
  persistence: ScriptReplacePersistencePayload,
  compileStatus: ScriptCompileStatus,
  diagnostics: DiagnosticsPayload,
  finalRead: ScriptReadPayload,
  initialConnectionGeneration: number,
  finalConnectionGeneration: number,
): ScriptReplacePayload {
  const messages = diagnostics.latestCompilation.messages ?? [];
  const compilerErrorCount = messages.filter((message) => message.severity === "error").length;
  const compilerWarningCount = messages.filter((message) => message.severity === "warning").length;
  return {
    ...persistence,
    compileStatus,
    compilationSequence: diagnostics.latestCompilation.sequence,
    compilationCompletedUnixMs: diagnostics.latestCompilation.completedUnixMs,
    compilerErrorCount,
    compilerWarningCount,
    compilerMessagesTruncated: diagnostics.latestCompilation.truncated,
    compilerMessages: messages,
    dependencyHashAfter: finalRead.dependencyHash,
    postReloadReadbackVerified: true,
    reloadObserved: finalConnectionGeneration !== initialConnectionGeneration,
    initialConnectionGeneration,
    finalConnectionGeneration,
  };
}

function emptyCompilation(): DiagnosticsPayload {
  return {
    consoleCounts: { errors: 0, warnings: 0, logs: 0 },
    isCompiling: false,
    captureStartedUnixMs: 0,
    minimumSeverity: "warning",
    maxEntries: 0,
    consoleEntryCoverage: "not_requested",
    compilerCoverage: "not_requested",
    consoleEntriesTruncated: false,
    compilerMessagesTruncated: false,
    recentConsoleEntries: [],
    latestCompilation: {
      sequence: 0,
      completedUnixMs: 0,
      truncated: false,
      messages: [],
    },
  };
}

function isAmbiguousDeliveryError(message: string): boolean {
  return (
    message.includes("Unity Editor disconnected before the request completed") ||
    message.includes("script.replace timed out after") ||
    message.includes("Local bridge server stopped before the request completed")
  );
}

function remainingMs(deadlineUnixMs: number): number {
  return Math.max(0, deadlineUnixMs - Date.now());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
