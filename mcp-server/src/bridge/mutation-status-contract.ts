const MAX_MUTATION_ID_LENGTH = 128;
const MAX_OPERATION_LENGTH = 128;
const MAX_STATE_EPOCH_LENGTH = 128;
const MAX_FAILURE_KIND_LENGTH = 128;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type MutationLifecycleStatus =
  | "not_found"
  | "started"
  | "completed"
  | "failed_rolled_back"
  | "failed_no_mutation"
  | "rollback_failed"
  | "rollback_verification_failed";

export type MutationStatusRecommendedAction =
  | "reobserve_native_state"
  | "reconcile_native_state_before_retry"
  | "operation_specific_same_id_replay_or_reobserve"
  | "reobserve_then_new_mutation_id_if_needed"
  | "manual_reconciliation_required";

export interface MutationStatusPayload {
  mutationId: string;
  found: boolean;
  journalKind: "editor_mutation_lifecycle_v1";
  sessionScope: "current_editor_session";
  coverage: "editor_mutation_transaction_v1";
  operation: string;
  status: MutationLifecycleStatus;
  terminal: boolean;
  startedUnixMs: number;
  startedStateEpoch: string;
  startedStateRevision: number;
  finishedUnixMs: number;
  finishedStateEpoch: string;
  finishedStateRevision: number;
  failureKind: string;
  intentIdentityRecorded: boolean;
  safeToBlindRetry: false;
  recommendedAction: MutationStatusRecommendedAction;
}

export function validateMutationId(value: string): void {
  if (
    value.length < 1 ||
    value.length > MAX_MUTATION_ID_LENGTH ||
    !MUTATION_ID_PATTERN.test(value)
  ) {
    throw new Error(
      "mutationId must be 1..128 characters using only letters, digits, '.', '_', ':', or '-'.",
    );
  }
}

export function isMutationStatusPayload(value: unknown): value is MutationStatusPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mutationId !== "string" ||
    candidate.mutationId.length < 1 ||
    candidate.mutationId.length > MAX_MUTATION_ID_LENGTH ||
    !MUTATION_ID_PATTERN.test(candidate.mutationId) ||
    typeof candidate.found !== "boolean" ||
    candidate.journalKind !== "editor_mutation_lifecycle_v1" ||
    candidate.sessionScope !== "current_editor_session" ||
    candidate.coverage !== "editor_mutation_transaction_v1" ||
    typeof candidate.operation !== "string" ||
    candidate.operation.length > MAX_OPERATION_LENGTH ||
    !isLifecycleStatus(candidate.status) ||
    typeof candidate.terminal !== "boolean" ||
    !isNonNegativeSafeInteger(candidate.startedUnixMs) ||
    typeof candidate.startedStateEpoch !== "string" ||
    candidate.startedStateEpoch.length > MAX_STATE_EPOCH_LENGTH ||
    !isNonNegativeSafeInteger(candidate.startedStateRevision) ||
    !isNonNegativeSafeInteger(candidate.finishedUnixMs) ||
    typeof candidate.finishedStateEpoch !== "string" ||
    candidate.finishedStateEpoch.length > MAX_STATE_EPOCH_LENGTH ||
    !isNonNegativeSafeInteger(candidate.finishedStateRevision) ||
    typeof candidate.failureKind !== "string" ||
    candidate.failureKind.length > MAX_FAILURE_KIND_LENGTH ||
    typeof candidate.intentIdentityRecorded !== "boolean" ||
    candidate.safeToBlindRetry !== false ||
    !isRecommendedAction(candidate.recommendedAction)
  ) {
    return false;
  }

  if (!candidate.found) {
    return candidate.status === "not_found" &&
      candidate.operation === "" &&
      candidate.terminal === false &&
      candidate.startedUnixMs === 0 &&
      candidate.startedStateEpoch === "" &&
      candidate.startedStateRevision === 0 &&
      candidate.finishedUnixMs === 0 &&
      candidate.finishedStateEpoch === "" &&
      candidate.finishedStateRevision === 0 &&
      candidate.failureKind === "" &&
      candidate.intentIdentityRecorded === false &&
      candidate.recommendedAction === "reobserve_native_state";
  }

  if (candidate.status === "not_found" || candidate.operation.length === 0) return false;
  if (!candidate.intentIdentityRecorded) return false;
  if (candidate.startedUnixMs <= 0 || candidate.startedStateEpoch.length === 0) return false;

  if (candidate.status === "started") {
    return candidate.terminal === false &&
      candidate.finishedUnixMs === 0 &&
      candidate.finishedStateEpoch === "" &&
      candidate.finishedStateRevision === 0 &&
      candidate.failureKind === "" &&
      candidate.recommendedAction === "reconcile_native_state_before_retry";
  }

  if (
    candidate.terminal !== true ||
    candidate.finishedUnixMs <= 0 ||
    candidate.finishedStateEpoch.length === 0
  ) {
    return false;
  }

  if (candidate.status === "completed") {
    return candidate.failureKind === "" &&
      candidate.recommendedAction === "operation_specific_same_id_replay_or_reobserve";
  }
  if (candidate.status === "failed_no_mutation" || candidate.status === "failed_rolled_back") {
    return candidate.failureKind.length > 0 &&
      candidate.recommendedAction === "reobserve_then_new_mutation_id_if_needed";
  }

  return candidate.failureKind.length > 0 &&
    candidate.recommendedAction === "manual_reconciliation_required";
}

function isLifecycleStatus(value: unknown): value is MutationLifecycleStatus {
  return value === "not_found" ||
    value === "started" ||
    value === "completed" ||
    value === "failed_rolled_back" ||
    value === "failed_no_mutation" ||
    value === "rollback_failed" ||
    value === "rollback_verification_failed";
}

function isRecommendedAction(value: unknown): value is MutationStatusRecommendedAction {
  return value === "reobserve_native_state" ||
    value === "reconcile_native_state_before_retry" ||
    value === "operation_specific_same_id_replay_or_reobserve" ||
    value === "reobserve_then_new_mutation_id_if_needed" ||
    value === "manual_reconciliation_required";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
