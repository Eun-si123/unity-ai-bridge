export const BRIDGE_PROTOCOL_VERSION = "0" as const;

export type BridgeProtocolVersion = typeof BRIDGE_PROTOCOL_VERSION;
export type RiskClass = "read" | "write" | "destructive" | "privileged";
export type DirtyState = "unchanged" | "dirty" | "unknown";
export type CompileState = "idle" | "compiling" | "failed" | "unknown";

export interface BridgeRoute {
  editorId: string;
  connectionGeneration: number;
}

export interface BridgeCommandEnvelope {
  protocolVersion: BridgeProtocolVersion;
  requestId: string;
  operation: string;
  arguments: Record<string, unknown>;
  risk: RiskClass;
  route?: BridgeRoute;
  deadlineUnixMs?: number;
}

export type BridgeErrorCategory =
  | "validation"
  | "policy"
  | "routing"
  | "stale_target"
  | "timeout"
  | "unity_api"
  | "compile_reload"
  | "disconnected"
  | "unsupported"
  | "transport"
  | "internal";

export interface BridgeError {
  category: BridgeErrorCategory;
  code: string;
  message: string;
  details?: unknown;
}

export interface BridgeUndoMetadata {
  available: boolean;
  groupName?: string;
}

interface BridgeResultCommon<TResult> {
  protocolVersion: BridgeProtocolVersion;
  requestId: string;
  result?: TResult;
  warnings: string[];
  changedTargets?: Array<Record<string, unknown>>;
  dirtyState?: DirtyState;
  undo?: BridgeUndoMetadata;
  compileState?: CompileState;
}

export interface BridgeSuccessResult<TResult = unknown>
  extends BridgeResultCommon<TResult> {
  ok: true;
  error?: never;
}

export interface BridgeFailureResult<TResult = unknown>
  extends BridgeResultCommon<TResult> {
  ok: false;
  error: BridgeError;
}

export type BridgeResultEnvelope<TResult = unknown> =
  | BridgeSuccessResult<TResult>
  | BridgeFailureResult<TResult>;

export function isBridgeProtocolVersion(value: unknown): value is BridgeProtocolVersion {
  return value === BRIDGE_PROTOCOL_VERSION;
}
