using System;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class MutationStatusPayload
    {
        public string mutationId;
        public bool found;
        public string journalKind;
        public string sessionScope;
        public string coverage;
        public string operation;
        public string status;
        public bool terminal;
        public long startedUnixMs;
        public string startedStateEpoch;
        public long startedStateRevision;
        public long finishedUnixMs;
        public string finishedStateEpoch;
        public long finishedStateRevision;
        public string failureKind;
        public bool intentIdentityRecorded;
        public bool safeToBlindRetry;
        public string recommendedAction;
    }

    internal static class MutationStatusCommand
    {
        public const int MaximumMutationIdLength = 128;

        private const string JournalKind = "editor_mutation_lifecycle_v1";
        private const string SessionScope = "current_editor_session";
        private const string Coverage = "editor_mutation_transaction_v1";
        private const string NotFoundStatus = "not_found";

        public static void ValidateArguments(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                throw new ArgumentException("mutationId is required.", nameof(mutationId));
            }
            if (mutationId.Length > MaximumMutationIdLength)
            {
                throw new ArgumentException(
                    $"mutationId must be at most {MaximumMutationIdLength} characters.",
                    nameof(mutationId));
            }

            for (var index = 0; index < mutationId.Length; index++)
            {
                var character = mutationId[index];
                if (!IsAllowedMutationIdCharacter(character))
                {
                    throw new ArgumentException(
                        "mutationId may contain only letters, digits, '.', '_', ':', or '-'.",
                        nameof(mutationId));
                }
            }
        }

        public static MutationStatusPayload Execute(string mutationId)
        {
            ValidateArguments(mutationId);
            var record = EditorMutationLifecycle.Read(mutationId);
            if (record == null)
            {
                return new MutationStatusPayload
                {
                    mutationId = mutationId,
                    found = false,
                    journalKind = JournalKind,
                    sessionScope = SessionScope,
                    coverage = Coverage,
                    operation = string.Empty,
                    status = NotFoundStatus,
                    terminal = false,
                    startedUnixMs = 0,
                    startedStateEpoch = string.Empty,
                    startedStateRevision = 0,
                    finishedUnixMs = 0,
                    finishedStateEpoch = string.Empty,
                    finishedStateRevision = 0,
                    failureKind = string.Empty,
                    intentIdentityRecorded = false,
                    safeToBlindRetry = false,
                    recommendedAction = "reobserve_native_state",
                };
            }

            ValidateStoredStatus(record.status);
            return new MutationStatusPayload
            {
                mutationId = record.mutationId,
                found = true,
                journalKind = JournalKind,
                sessionScope = SessionScope,
                coverage = Coverage,
                operation = record.operation ?? string.Empty,
                status = record.status,
                terminal = !string.Equals(
                    record.status,
                    EditorMutationLifecycle.StartedStatus,
                    StringComparison.Ordinal),
                startedUnixMs = record.startedUnixMs,
                startedStateEpoch = record.startedStateEpoch ?? string.Empty,
                startedStateRevision = record.startedStateRevision,
                finishedUnixMs = record.finishedUnixMs,
                finishedStateEpoch = record.finishedStateEpoch ?? string.Empty,
                finishedStateRevision = record.finishedStateRevision,
                failureKind = record.failureKind ?? string.Empty,
                intentIdentityRecorded = !string.IsNullOrEmpty(record.intentFingerprint),
                safeToBlindRetry = false,
                recommendedAction = RecommendedAction(record.status),
            };
        }

        private static string RecommendedAction(string status)
        {
            if (string.Equals(status, EditorMutationLifecycle.StartedStatus, StringComparison.Ordinal))
            {
                return "reconcile_native_state_before_retry";
            }
            if (string.Equals(status, EditorMutationLifecycle.CompletedStatus, StringComparison.Ordinal))
            {
                return "operation_specific_same_id_replay_or_reobserve";
            }
            if (string.Equals(status, EditorMutationLifecycle.FailedNoMutationStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.FailedRolledBackStatus, StringComparison.Ordinal))
            {
                return "reobserve_then_new_mutation_id_if_needed";
            }

            return "manual_reconciliation_required";
        }

        private static void ValidateStoredStatus(string status)
        {
            if (string.Equals(status, EditorMutationLifecycle.StartedStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.CompletedStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.FailedRolledBackStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.FailedNoMutationStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.RollbackFailedStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.RollbackVerificationFailedStatus, StringComparison.Ordinal))
            {
                return;
            }

            throw new InvalidOperationException(
                $"The stored mutation lifecycle status '{status}' is not recognized by mutation.status.");
        }

        private static bool IsAllowedMutationIdCharacter(char value)
        {
            return (value >= 'A' && value <= 'Z') ||
                (value >= 'a' && value <= 'z') ||
                (value >= '0' && value <= '9') ||
                value == '.' ||
                value == '_' ||
                value == ':' ||
                value == '-';
        }
    }
}
