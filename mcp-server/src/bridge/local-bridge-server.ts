import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCommandEnvelope,
  type BridgeResultEnvelope,
  type BridgeRoute,
  type RiskClass,
} from "../protocol/bridge.js";

export interface BridgeHello {
  type: "hello";
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  editorId: string;
  connectionGeneration: number;
  unityVersion: string;
  projectName: string;
}

export interface EditorStatusPayload {
  unityVersion: string;
  projectName: string;
  activeScene: string;
  isPlaying: boolean;
  isCompiling: boolean;
}

export interface HierarchyOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface HierarchyNodePayload {
  globalObjectId: string;
  instanceId: number;
  name: string;
  hierarchyPath: string;
  parentGlobalObjectId: string;
  depth: number;
  siblingIndex: number;
  childCount: number;
  activeSelf: boolean;
  activeInHierarchy: boolean;
}

export interface HierarchyPayload {
  sceneName: string;
  scenePath: string;
  rootCount: number;
  returnedNodeCount: number;
  maxDepth: number;
  maxNodes: number;
  truncatedByDepth: boolean;
  truncatedByNodes: boolean;
  nodes: HierarchyNodePayload[];
}

export interface DiagnosticsOptions {
  maxEntries?: number;
  minimumSeverity?: "error" | "warning" | "log";
}

export interface ConsoleCountsPayload {
  errors: number;
  warnings: number;
  logs: number;
}

export interface ConsoleDiagnosticPayload {
  timestampUnixMs: number;
  severity: "error" | "warning" | "log";
  message: string;
  stackTrace: string;
}

export interface CompilerDiagnosticPayload {
  severity: "error" | "warning";
  message: string;
  file: string;
  line: number;
  column: number;
  assemblyPath: string;
}

export interface CompilationSnapshotPayload {
  sequence: number;
  completedUnixMs: number;
  truncated: boolean;
  messages: CompilerDiagnosticPayload[];
}

export interface DiagnosticsPayload {
  consoleCounts: ConsoleCountsPayload;
  isCompiling: boolean;
  captureStartedUnixMs: number;
  minimumSeverity: "error" | "warning" | "log";
  maxEntries: number;
  consoleEntryCoverage: string;
  compilerCoverage: string;
  consoleEntriesTruncated: boolean;
  compilerMessagesTruncated: boolean;
  recentConsoleEntries: ConsoleDiagnosticPayload[];
  latestCompilation: CompilationSnapshotPayload;
}

export interface ObjectResolvePayload {
  requestedGlobalObjectId: string;
  found: boolean;
  canonicalGlobalObjectId: string;
  instanceId: number;
  name: string;
  objectType: string;
  isGameObject: boolean;
  isComponent: boolean;
  owningGameObjectGlobalObjectId: string;
  owningGameObjectInstanceId: number;
  sceneName: string;
  scenePath: string;
  hierarchyPath: string;
  siblingIndex: number;
  activeSelf: boolean;
  activeInHierarchy: boolean;
}

export interface GameObjectCreateOptions {
  name: string;
  mutationId?: string;
}

export interface GameObjectCreatePayload {
  mutationId: string;
  replayed: boolean;
  globalObjectId: string;
  instanceId: number;
  name: string;
  hierarchyPath: string;
  sceneName: string;
  scenePath: string;
  siblingIndex: number;
}

interface ActiveEditor {
  socket: WebSocket;
  hello: BridgeHello;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_HIERARCHY_MAX_DEPTH = 8;
const DEFAULT_HIERARCHY_MAX_NODES = 200;
const MAX_HIERARCHY_DEPTH = 32;
const MAX_HIERARCHY_NODES = 500;
const DEFAULT_DIAGNOSTICS_MAX_ENTRIES = 100;
const MAX_DIAGNOSTICS_ENTRIES = 200;
const DEFAULT_DIAGNOSTICS_MINIMUM_SEVERITY = "warning" as const;
const DIAGNOSTICS_SEVERITIES = new Set(["error", "warning", "log"]);
const MAX_GLOBAL_OBJECT_ID_LENGTH = 256;
const MAX_GAMEOBJECT_NAME_LENGTH = 128;
const MAX_MUTATION_ID_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class LocalBridgeServer {
  private readonly server: WebSocketServer;
  private readonly pending = new Map<string, PendingRequest>();
  private activeEditor: ActiveEditor | undefined;

  public constructor(
    private readonly host = "127.0.0.1",
    private readonly requestedPort = 5081,
  ) {
    this.server = new WebSocketServer({
      host: this.host,
      port: this.requestedPort,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    });

    this.server.on("connection", (socket) => this.onConnection(socket));
  }

  public async start(): Promise<number> {
    if (this.server.address() !== null) {
      return this.port;
    }

    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        this.server.off("listening", onListening);
        this.server.off("error", onError);
      };

      this.server.once("listening", onListening);
      this.server.once("error", onError);
    });

    return this.port;
  }

  public get port(): number {
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Local bridge server is not listening.");
    }

    return (address as AddressInfo).port;
  }

  public get connectedEditor(): BridgeHello | undefined {
    return this.activeEditor?.hello;
  }

  public async waitForEditor(timeoutMs = 5000): Promise<BridgeHello> {
    const current = this.activeEditor?.hello;
    if (current !== undefined) {
      return current;
    }

    return await new Promise<BridgeHello>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.server.off("editor-connected", onEditorConnected);
        reject(new Error(`No Unity Editor connected within ${timeoutMs} ms.`));
      }, timeoutMs);

      const onEditorConnected = (hello: BridgeHello): void => {
        clearTimeout(timeout);
        resolve(hello);
      };

      this.server.once("editor-connected", onEditorConnected);
    });
  }

  public async requestEditorStatus(timeoutMs = 5000): Promise<EditorStatusPayload> {
    const editor = this.requireActiveEditor();
    return await this.requestEditorStatusForRoute(
      {
        editorId: editor.hello.editorId,
        connectionGeneration: editor.hello.connectionGeneration,
      },
      timeoutMs,
    );
  }

  public async requestEditorStatusForRoute(
    route: BridgeRoute,
    timeoutMs = 5000,
  ): Promise<EditorStatusPayload> {
    const result = await this.requestOperation("editor.status", {}, route, timeoutMs);
    if (!isEditorStatusPayload(result)) {
      throw new Error("Unity returned an invalid editor.status payload.");
    }
    return result;
  }

  public async requestHierarchy(
    options: HierarchyOptions = {},
    timeoutMs = 5000,
  ): Promise<HierarchyPayload> {
    const editor = this.requireActiveEditor();
    const maxDepth = options.maxDepth ?? DEFAULT_HIERARCHY_MAX_DEPTH;
    const maxNodes = options.maxNodes ?? DEFAULT_HIERARCHY_MAX_NODES;

    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_HIERARCHY_DEPTH) {
      throw new Error(`maxDepth must be an integer between 1 and ${MAX_HIERARCHY_DEPTH}.`);
    }
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_HIERARCHY_NODES) {
      throw new Error(`maxNodes must be an integer between 1 and ${MAX_HIERARCHY_NODES}.`);
    }

    const result = await this.requestOperation(
      "scene.hierarchy",
      { maxDepth, maxNodes },
      {
        editorId: editor.hello.editorId,
        connectionGeneration: editor.hello.connectionGeneration,
      },
      timeoutMs,
    );

    if (!isHierarchyPayload(result)) {
      throw new Error("Unity returned an invalid scene.hierarchy payload.");
    }
    return result;
  }

  public async requestDiagnostics(
    options: DiagnosticsOptions = {},
    timeoutMs = 5000,
  ): Promise<DiagnosticsPayload> {
    const editor = this.requireActiveEditor();
    const maxEntries = options.maxEntries ?? DEFAULT_DIAGNOSTICS_MAX_ENTRIES;
    const minimumSeverity = options.minimumSeverity ?? DEFAULT_DIAGNOSTICS_MINIMUM_SEVERITY;

    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_DIAGNOSTICS_ENTRIES) {
      throw new Error(`maxEntries must be an integer between 1 and ${MAX_DIAGNOSTICS_ENTRIES}.`);
    }
    if (!DIAGNOSTICS_SEVERITIES.has(minimumSeverity)) {
      throw new Error("minimumSeverity must be one of 'error', 'warning', or 'log'.");
    }

    const result = await this.requestOperation(
      "editor.diagnostics",
      { maxEntries, minimumSeverity },
      {
        editorId: editor.hello.editorId,
        connectionGeneration: editor.hello.connectionGeneration,
      },
      timeoutMs,
    );

    if (!isDiagnosticsPayload(result)) {
      throw new Error("Unity returned an invalid editor.diagnostics payload.");
    }
    return result;
  }

  public async requestResolveObject(
    globalObjectId: string,
    timeoutMs = 5000,
  ): Promise<ObjectResolvePayload> {
    const editor = this.requireActiveEditor();
    if (typeof globalObjectId !== "string" || globalObjectId.trim().length === 0) {
      throw new Error("globalObjectId is required.");
    }
    if (globalObjectId.length > MAX_GLOBAL_OBJECT_ID_LENGTH) {
      throw new Error(`globalObjectId must be at most ${MAX_GLOBAL_OBJECT_ID_LENGTH} characters.`);
    }

    const result = await this.requestOperation(
      "object.resolve",
      { globalObjectId },
      {
        editorId: editor.hello.editorId,
        connectionGeneration: editor.hello.connectionGeneration,
      },
      timeoutMs,
    );

    if (!isObjectResolvePayload(result)) {
      throw new Error("Unity returned an invalid object.resolve payload.");
    }
    return result;
  }

  public async requestCreateGameObject(
    options: GameObjectCreateOptions,
    timeoutMs = 5000,
  ): Promise<GameObjectCreatePayload> {
    const editor = this.requireActiveEditor();
    const name = options.name;
    const mutationId = options.mutationId ?? randomUUID();

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error("name must contain at least one non-whitespace character.");
    }
    if (name.length > MAX_GAMEOBJECT_NAME_LENGTH) {
      throw new Error(`name must be at most ${MAX_GAMEOBJECT_NAME_LENGTH} characters.`);
    }
    if (
      typeof mutationId !== "string" ||
      mutationId.length === 0 ||
      mutationId.length > MAX_MUTATION_ID_LENGTH ||
      !MUTATION_ID_PATTERN.test(mutationId)
    ) {
      throw new Error(
        "mutationId must be 1..128 characters using only letters, digits, '-', '_', '.', and ':'.",
      );
    }

    try {
      const result = await this.requestOperation(
        "gameObject.create",
        { name, mutationId },
        {
          editorId: editor.hello.editorId,
          connectionGeneration: editor.hello.connectionGeneration,
        },
        timeoutMs,
        "write",
      );

      if (!isGameObjectCreatePayload(result)) {
        throw new Error("Unity returned an invalid gameObject.create payload.");
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} mutationId=${mutationId}`);
    }
  }

  public async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Local bridge server stopped before the request completed."));
    }
    this.pending.clear();

    for (const client of this.server.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async requestOperation(
    operation: string,
    args: Record<string, unknown>,
    route: BridgeRoute,
    timeoutMs: number,
    risk: RiskClass = "read",
  ): Promise<unknown> {
    const editor = this.requireActiveEditor();
    const requestId = randomUUID();
    const command: BridgeCommandEnvelope = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId,
      operation,
      arguments: args,
      risk,
      route,
      deadlineUnixMs: Date.now() + timeoutMs,
    };

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${operation} timed out after ${timeoutMs} ms.`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      editor.socket.send(JSON.stringify(command), (error) => {
        if (error == null) {
          return;
        }

        const pending = this.pending.get(requestId);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.reject(error);
        }
      });
    });
  }

  private requireActiveEditor(): ActiveEditor {
    const editor = this.activeEditor;
    if (editor === undefined || editor.socket.readyState !== WebSocket.OPEN) {
      throw new Error("No Unity Editor is connected to the local bridge.");
    }
    return editor;
  }

  private onConnection(socket: WebSocket): void {
    socket.on("message", (data) => this.onMessage(socket, data));
    socket.on("close", () => {
      if (this.activeEditor?.socket === socket) {
        this.activeEditor = undefined;
        this.rejectPendingForDisconnect();
      }
    });
  }

  private onMessage(socket: WebSocket, data: RawData): void {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      socket.close(1003, "invalid JSON");
      return;
    }

    if (isBridgeHello(message)) {
      const previous = this.activeEditor;
      if (previous !== undefined && previous.socket !== socket) {
        previous.socket.close(1000, "replaced by newer editor connection");
      }

      this.activeEditor = { socket, hello: message };
      this.server.emit("editor-connected", message);
      return;
    }

    if (isBridgeResultEnvelope(message)) {
      const pending = this.pending.get(message.requestId);
      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);

      if (message.ok) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new Error(
            `${message.error.category}/${message.error.code}: ${message.error.message}`,
          ),
        );
      }
    }
  }

  private rejectPendingForDisconnect(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Unity Editor disconnected before the request completed."));
    }
    this.pending.clear();
  }
}

function isBridgeHello(value: unknown): value is BridgeHello {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "hello" &&
    candidate.protocolVersion === BRIDGE_PROTOCOL_VERSION &&
    typeof candidate.editorId === "string" &&
    candidate.editorId.length > 0 &&
    typeof candidate.connectionGeneration === "number" &&
    Number.isSafeInteger(candidate.connectionGeneration) &&
    typeof candidate.unityVersion === "string" &&
    typeof candidate.projectName === "string"
  );
}

function isBridgeResultEnvelope(value: unknown): value is BridgeResultEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== BRIDGE_PROTOCOL_VERSION ||
    typeof candidate.requestId !== "string" ||
    typeof candidate.ok !== "boolean" ||
    !Array.isArray(candidate.warnings)
  ) {
    return false;
  }

  if (candidate.ok) {
    return candidate.error === undefined;
  }

  return typeof candidate.error === "object" && candidate.error !== null;
}

function isEditorStatusPayload(value: unknown): value is EditorStatusPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.unityVersion === "string" &&
    typeof candidate.projectName === "string" &&
    typeof candidate.activeScene === "string" &&
    typeof candidate.isPlaying === "boolean" &&
    typeof candidate.isCompiling === "boolean"
  );
}

function isHierarchyPayload(value: unknown): value is HierarchyPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sceneName !== "string" ||
    typeof candidate.scenePath !== "string" ||
    !isNonNegativeInteger(candidate.rootCount) ||
    !isNonNegativeInteger(candidate.returnedNodeCount) ||
    !isPositiveInteger(candidate.maxDepth) ||
    !isPositiveInteger(candidate.maxNodes) ||
    typeof candidate.truncatedByDepth !== "boolean" ||
    typeof candidate.truncatedByNodes !== "boolean" ||
    !Array.isArray(candidate.nodes)
  ) {
    return false;
  }

  if (candidate.returnedNodeCount !== candidate.nodes.length) {
    return false;
  }

  return candidate.nodes.every(isHierarchyNodePayload);
}

function isHierarchyNodePayload(value: unknown): value is HierarchyNodePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.globalObjectId === "string" &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    typeof candidate.parentGlobalObjectId === "string" &&
    isNonNegativeInteger(candidate.depth) &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    isNonNegativeInteger(candidate.childCount) &&
    typeof candidate.activeSelf === "boolean" &&
    typeof candidate.activeInHierarchy === "boolean"
  );
}

function isDiagnosticsPayload(value: unknown): value is DiagnosticsPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isConsoleCountsPayload(candidate.consoleCounts) &&
    typeof candidate.isCompiling === "boolean" &&
    isNonNegativeInteger(candidate.captureStartedUnixMs) &&
    (candidate.minimumSeverity === "error" ||
      candidate.minimumSeverity === "warning" ||
      candidate.minimumSeverity === "log") &&
    isPositiveInteger(candidate.maxEntries) &&
    typeof candidate.consoleEntryCoverage === "string" &&
    typeof candidate.compilerCoverage === "string" &&
    typeof candidate.consoleEntriesTruncated === "boolean" &&
    typeof candidate.compilerMessagesTruncated === "boolean" &&
    Array.isArray(candidate.recentConsoleEntries) &&
    candidate.recentConsoleEntries.every(isConsoleDiagnosticPayload) &&
    isCompilationSnapshotPayload(candidate.latestCompilation)
  );
}

function isConsoleCountsPayload(value: unknown): value is ConsoleCountsPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(candidate.errors) &&
    isNonNegativeInteger(candidate.warnings) &&
    isNonNegativeInteger(candidate.logs)
  );
}

function isConsoleDiagnosticPayload(value: unknown): value is ConsoleDiagnosticPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(candidate.timestampUnixMs) &&
    (candidate.severity === "error" ||
      candidate.severity === "warning" ||
      candidate.severity === "log") &&
    typeof candidate.message === "string" &&
    typeof candidate.stackTrace === "string"
  );
}

function isCompilationSnapshotPayload(value: unknown): value is CompilationSnapshotPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(candidate.sequence) &&
    isNonNegativeInteger(candidate.completedUnixMs) &&
    typeof candidate.truncated === "boolean" &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isCompilerDiagnosticPayload)
  );
}

function isCompilerDiagnosticPayload(value: unknown): value is CompilerDiagnosticPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.severity === "error" || candidate.severity === "warning") &&
    typeof candidate.message === "string" &&
    typeof candidate.file === "string" &&
    isNonNegativeInteger(candidate.line) &&
    isNonNegativeInteger(candidate.column) &&
    typeof candidate.assemblyPath === "string"
  );
}

function isObjectResolvePayload(value: unknown): value is ObjectResolvePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestedGlobalObjectId === "string" &&
    typeof candidate.found === "boolean" &&
    typeof candidate.canonicalGlobalObjectId === "string" &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.objectType === "string" &&
    typeof candidate.isGameObject === "boolean" &&
    typeof candidate.isComponent === "boolean" &&
    typeof candidate.owningGameObjectGlobalObjectId === "string" &&
    typeof candidate.owningGameObjectInstanceId === "number" &&
    Number.isSafeInteger(candidate.owningGameObjectInstanceId) &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    isNonNegativeInteger(candidate.siblingIndex) &&
    typeof candidate.activeSelf === "boolean" &&
    typeof candidate.activeInHierarchy === "boolean"
  );
}

function isGameObjectCreatePayload(value: unknown): value is GameObjectCreatePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mutationId === "string" &&
    candidate.mutationId.length > 0 &&
    typeof candidate.replayed === "boolean" &&
    typeof candidate.globalObjectId === "string" &&
    candidate.globalObjectId.length > 0 &&
    typeof candidate.instanceId === "number" &&
    Number.isSafeInteger(candidate.instanceId) &&
    typeof candidate.name === "string" &&
    typeof candidate.hierarchyPath === "string" &&
    typeof candidate.sceneName === "string" &&
    typeof candidate.scenePath === "string" &&
    isNonNegativeInteger(candidate.siblingIndex)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
