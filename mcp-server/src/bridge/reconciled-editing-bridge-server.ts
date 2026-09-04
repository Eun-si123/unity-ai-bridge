import { EditingBridgeServer } from "./editing-bridge-server.js";
import {
  isMutationStatusPayload,
  type MutationStatusPayload,
} from "./mutation-status-contract.js";
import type { BridgeRoute, RiskClass } from "../protocol/bridge.js";

export const RECONCILED_COMMON_MUTATION_OPERATIONS = new Set([
  "gameObject.create",
  "gameObject.update",
  "gameObject.delete",
  "transform.set",
  "component.add",
  "component.remove",
  "component.property.set",
]);
const RECONCILIATION_GRACE_MS = 5_000;
const RECONCILIATION_POLL_MS = 100;
const STATUS_READ_TIMEOUT_MS = 1_000;
const REPLAY_TIMEOUT_MS = 2_000;

export class ReconciledEditingBridgeServer extends EditingBridgeServer {
  protected override async requestOperation(
    operation: string,
    args: Record<string, unknown>,
    route: BridgeRoute,
    timeoutMs: number,
    risk: RiskClass = "read",
  ): Promise<unknown> {
    if (!RECONCILED_COMMON_MUTATION_OPERATIONS.has(operation)) {
      return await super.requestOperation(operation, args, route, timeoutMs, risk);
    }

    const mutationId = args.mutationId;
    if (typeof mutationId !== "string" || mutationId.length === 0) {
      return await super.requestOperation(operation, args, route, timeoutMs, risk);
    }

    try {
      return await super.requestOperation(operation, args, route, timeoutMs, risk);
    } catch (error) {
      const initialError = errorMessage(error);
      if (!isAmbiguousDeliveryError(initialError, operation)) {
        throw error;
      }

      return await this.reconcileAmbiguousMutation(
        operation,
        args,
        mutationId,
        route.editorId,
        risk,
        initialError,
        Date.now() + RECONCILIATION_GRACE_MS,
      );
    }
  }

  private async reconcileAmbiguousMutation(
    operation: string,
    args: Record<string, unknown>,
    mutationId: string,
    editorId: string,
    risk: RiskClass,
    initialError: string,
    deadlineUnixMs: number,
  ): Promise<unknown> {
    let lastObservation = initialError;

    while (remainingMs(deadlineUnixMs) > 0) {
      const editor = await this.waitForMutationEditor(editorId, deadlineUnixMs);
      const route = {
        editorId: editor.editorId,
        connectionGeneration: editor.connectionGeneration,
      };

      let status: MutationStatusPayload;
      try {
        const rawStatus = await super.requestOperation(
          "mutation.status",
          { mutationId },
          route,
          Math.min(STATUS_READ_TIMEOUT_MS, Math.max(1, remainingMs(deadlineUnixMs))),
          "read",
        );
        if (!isMutationStatusPayload(rawStatus) || rawStatus.mutationId !== mutationId) {
          throw new Error("Unity returned an invalid mutation.status payload during reconciliation.");
        }
        status = rawStatus;
      } catch (error) {
        const message = errorMessage(error);
        if (isTransientReconciliationError(message)) {
          lastObservation = message;
          await delayBounded(deadlineUnixMs);
          continue;
        }
        throw new Error(
          `${operation} delivery became ambiguous and mutation.status reconciliation failed: ${message} mutationId=${mutationId}`,
        );
      }

      if (!status.found) {
        throw new Error(
          `${operation} delivery became ambiguous and mutation.status returned not_found. ` +
          `The bridge will not blindly retry because absence from the bounded current-session journal does not prove that no side effect occurred. ` +
          `recommendedAction=${status.recommendedAction} originalError=${initialError} mutationId=${mutationId}`,
        );
      }

      if (status.operation !== operation) {
        throw new Error(
          `${operation} delivery became ambiguous but mutationId belongs to operation '${status.operation}'. ` +
          `Automatic reconciliation is refused. mutationId=${mutationId}`,
        );
      }

      if (status.status === "started") {
        lastObservation = "mutation.status=started";
        await delayBounded(deadlineUnixMs);
        continue;
      }

      if (status.status === "completed") {
        try {
          return await super.requestOperation(
            operation,
            args,
            route,
            Math.min(REPLAY_TIMEOUT_MS, Math.max(1, remainingMs(deadlineUnixMs))),
            risk,
          );
        } catch (error) {
          const message = errorMessage(error);
          if (isAmbiguousDeliveryError(message, operation) || isTransientReconciliationError(message)) {
            lastObservation = `completed; replay delivery ambiguous: ${message}`;
            await delayBounded(deadlineUnixMs);
            continue;
          }
          throw new Error(
            `${operation} completed according to mutation.status, but its operation-specific same-id replay did not return a verified result: ${message} mutationId=${mutationId}`,
          );
        }
      }

      throw new Error(
        `${operation} delivery became ambiguous and reached terminal lifecycle status '${status.status}'. ` +
        `No automatic re-execution is allowed. recommendedAction=${status.recommendedAction} ` +
        `failureKind=${status.failureKind || "none"} mutationId=${mutationId}`,
      );
    }

    throw new Error(
      `${operation} delivery became ambiguous and could not be reconciled before the bounded recovery window expired. ` +
      `lastObservation=${lastObservation} mutationId=${mutationId}`,
    );
  }

  private async waitForMutationEditor(
    editorId: string,
    deadlineUnixMs: number,
  ): Promise<{ editorId: string; connectionGeneration: number }> {
    while (remainingMs(deadlineUnixMs) > 0) {
      const current = this.connectedEditor;
      if (current !== undefined) {
        if (current.editorId !== editorId) {
          throw new Error(
            `A different Unity Editor connected during mutation reconciliation. expectedEditorId=${editorId} observedEditorId=${current.editorId}`,
          );
        }
        return {
          editorId: current.editorId,
          connectionGeneration: current.connectionGeneration,
        };
      }

      try {
        const hello = await this.waitForEditor(
          Math.min(500, Math.max(1, remainingMs(deadlineUnixMs))),
        );
        if (hello.editorId !== editorId) {
          throw new Error(
            `A different Unity Editor connected during mutation reconciliation. expectedEditorId=${editorId} observedEditorId=${hello.editorId}`,
          );
        }
        return {
          editorId: hello.editorId,
          connectionGeneration: hello.connectionGeneration,
        };
      } catch (error) {
        const message = errorMessage(error);
        if (message.includes("different Unity Editor")) {
          throw error;
        }
      }
    }

    throw new Error(
      `The original Unity Editor did not become available during mutation reconciliation. expectedEditorId=${editorId}`,
    );
  }
}

function isAmbiguousDeliveryError(message: string, operation: string): boolean {
  return (
    message.includes("Unity Editor disconnected before the request completed") ||
    message.includes(`${operation} timed out after`)
  );
}

function isTransientReconciliationError(message: string): boolean {
  return (
    message.includes("Unity Editor disconnected before the request completed") ||
    message.includes("mutation.status timed out after") ||
    message.includes("No Unity Editor is connected to the local bridge")
  );
}

function remainingMs(deadlineUnixMs: number): number {
  return Math.max(0, deadlineUnixMs - Date.now());
}

async function delayBounded(deadlineUnixMs: number): Promise<void> {
  const remaining = remainingMs(deadlineUnixMs);
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(RECONCILIATION_POLL_MS, remaining)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
