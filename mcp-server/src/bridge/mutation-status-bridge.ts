import { PrefabPropertyBridgeServer } from "./prefab-property-bridge-server.js";
import {
  isMutationStatusPayload,
  validateMutationId,
  type MutationLifecycleStatus,
  type MutationStatusPayload,
  type MutationStatusRecommendedAction,
} from "./mutation-status-contract.js";

export {
  isMutationStatusPayload,
  validateMutationId,
};
export type {
  MutationLifecycleStatus,
  MutationStatusPayload,
  MutationStatusRecommendedAction,
};

interface EditorIdentity {
  editorId: string;
  connectionGeneration: number;
}

class MutationStatusBridgeAccess extends PrefabPropertyBridgeServer {
  public connectedEditorAccess(): EditorIdentity | undefined {
    const current = this.connectedEditor;
    return current === undefined
      ? undefined
      : {
          editorId: current.editorId,
          connectionGeneration: current.connectionGeneration,
        };
  }

  public requestOperationAccess(
    operation: string,
    args: Record<string, unknown>,
    route: EditorIdentity,
    timeoutMs: number,
    risk: "read",
  ): Promise<unknown> {
    return this.requestOperation(operation, args, route, timeoutMs, risk);
  }
}

export async function requestMutationStatus(
  bridge: PrefabPropertyBridgeServer,
  mutationId: string,
  timeoutMs = 5_000,
): Promise<MutationStatusPayload> {
  validateMutationId(mutationId);
  const editor = connectedEditor(bridge);
  if (editor === undefined) {
    throw new Error("No Unity Editor is connected to the local bridge.");
  }

  const result = await requestOperation(
    bridge,
    "mutation.status",
    { mutationId },
    editor,
    timeoutMs,
    "read",
  );
  if (!isMutationStatusPayload(result)) {
    throw new Error("Unity returned an invalid mutation.status payload.");
  }
  return result;
}

function access(bridge: PrefabPropertyBridgeServer): MutationStatusBridgeAccess {
  return bridge as unknown as MutationStatusBridgeAccess;
}

function connectedEditor(bridge: PrefabPropertyBridgeServer): EditorIdentity | undefined {
  return MutationStatusBridgeAccess.prototype.connectedEditorAccess.call(access(bridge));
}

function requestOperation(
  bridge: PrefabPropertyBridgeServer,
  operation: string,
  args: Record<string, unknown>,
  route: EditorIdentity,
  timeoutMs: number,
  risk: "read",
): Promise<unknown> {
  return MutationStatusBridgeAccess.prototype.requestOperationAccess.call(
    access(bridge),
    operation,
    args,
    route,
    timeoutMs,
    risk,
  );
}
