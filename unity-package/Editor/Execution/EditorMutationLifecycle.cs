using System;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Execution
{
    internal sealed class EditorMutationLifecycleConflictException : InvalidOperationException
    {
        public EditorMutationLifecycleConflictException(string message)
            : base(message)
        {
        }
    }

    internal sealed class EditorMutationIncompleteException : InvalidOperationException
    {
        public EditorMutationIncompleteException(string message)
            : base(message)
        {
        }
    }

    [Serializable]
    internal sealed class EditorMutationLifecycleRecord
    {
        public string operation;
        public string mutationId;
        public string intentFingerprint;
        public string status;
        public long startedUnixMs;
        public string startedStateEpoch;
        public long startedStateRevision;
        public long finishedUnixMs;
        public string finishedStateEpoch;
        public long finishedStateRevision;
        public string failureKind;
    }

    internal static class EditorMutationLifecycle
    {
        internal const string StartedStatus = "started";
        internal const string CompletedStatus = "completed";
        internal const string FailedRolledBackStatus = "failed_rolled_back";
        internal const string FailedNoMutationStatus = "failed_no_mutation";
        internal const string RollbackFailedStatus = "rollback_failed";

        private const string SessionKeyPrefix = "UnityAiBridge.MutationLifecycle.v1.";

        public static EditorMutationLifecycleRecord Begin(
            string operation,
            string mutationId,
            string intentFingerprint,
            EditorStateRevisionSnapshot stateBefore)
        {
            ValidateIdentity(operation, mutationId, intentFingerprint);
            if (stateBefore == null)
            {
                throw new ArgumentNullException(nameof(stateBefore));
            }

            var existing = Read(mutationId);
            if (existing != null)
            {
                if (!string.Equals(existing.operation, operation, StringComparison.Ordinal) ||
                    !string.Equals(existing.intentFingerprint, intentFingerprint, StringComparison.Ordinal))
                {
                    throw new EditorMutationLifecycleConflictException(
                        "mutationId already belongs to a different operation or mutation intent.");
                }

                if (string.Equals(existing.status, StartedStatus, StringComparison.Ordinal))
                {
                    throw new EditorMutationIncompleteException(
                        "A previous delivery of this mutationId started but did not record a terminal outcome. " +
                        "This can happen across compilation/domain reload or an interrupted Editor operation. " +
                        "The mutation will not be executed again automatically; refresh native Unity state and reconcile before choosing a new mutationId.");
                }

                throw new EditorMutationIncompleteException(
                    $"mutationId already has terminal lifecycle status '{existing.status}', but no operation-specific completed result was available for replay. " +
                    "The mutation will not be executed again automatically.");
            }

            var record = new EditorMutationLifecycleRecord
            {
                operation = operation,
                mutationId = mutationId,
                intentFingerprint = intentFingerprint,
                status = StartedStatus,
                startedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                startedStateEpoch = stateBefore.epoch,
                startedStateRevision = stateBefore.revision,
                finishedUnixMs = 0,
                finishedStateEpoch = string.Empty,
                finishedStateRevision = 0,
                failureKind = string.Empty,
            };

            Write(record);
            return record;
        }

        public static void MarkCompleted(
            EditorMutationLifecycleRecord record,
            EditorStateRevisionSnapshot stateAfter)
        {
            MarkTerminal(record, CompletedStatus, string.Empty, stateAfter);
        }

        public static void MarkFailedRolledBack(
            EditorMutationLifecycleRecord record,
            EditorStateRevisionSnapshot stateAfter)
        {
            MarkTerminal(record, FailedRolledBackStatus, "verification_or_execution_failed", stateAfter);
        }

        public static void MarkFailedNoMutation(
            EditorMutationLifecycleRecord record,
            EditorStateRevisionSnapshot stateAfter)
        {
            MarkTerminal(record, FailedNoMutationStatus, "failed_before_undo_state", stateAfter);
        }

        public static void MarkRollbackFailed(
            EditorMutationLifecycleRecord record,
            EditorStateRevisionSnapshot stateAfter)
        {
            MarkTerminal(record, RollbackFailedStatus, "rollback_failed", stateAfter);
        }

        public static EditorMutationLifecycleRecord Read(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                return null;
            }

            var json = SessionState.GetString(SessionKeyPrefix + mutationId, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            var record = JsonUtility.FromJson<EditorMutationLifecycleRecord>(json);
            if (record == null || string.IsNullOrEmpty(record.mutationId))
            {
                throw new InvalidOperationException("The stored mutation lifecycle record is invalid.");
            }

            return record;
        }

        internal static void ClearForVerification(string mutationId)
        {
            if (!string.IsNullOrWhiteSpace(mutationId))
            {
                SessionState.EraseString(SessionKeyPrefix + mutationId);
            }
        }

        private static void MarkTerminal(
            EditorMutationLifecycleRecord record,
            string status,
            string failureKind,
            EditorStateRevisionSnapshot stateAfter)
        {
            if (record == null)
            {
                return;
            }
            if (stateAfter == null)
            {
                throw new ArgumentNullException(nameof(stateAfter));
            }

            record.status = status;
            record.finishedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            record.finishedStateEpoch = stateAfter.epoch;
            record.finishedStateRevision = stateAfter.revision;
            record.failureKind = failureKind ?? string.Empty;
            Write(record);
        }

        private static void Write(EditorMutationLifecycleRecord record)
        {
            SessionState.SetString(SessionKeyPrefix + record.mutationId, JsonUtility.ToJson(record));
        }

        private static void ValidateIdentity(string operation, string mutationId, string intentFingerprint)
        {
            if (string.IsNullOrWhiteSpace(operation))
            {
                throw new ArgumentException("operation is required.", nameof(operation));
            }
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                throw new ArgumentException("mutationId is required.", nameof(mutationId));
            }
            if (string.IsNullOrEmpty(intentFingerprint))
            {
                throw new ArgumentException("intentFingerprint is required.", nameof(intentFingerprint));
            }
        }
    }
}
