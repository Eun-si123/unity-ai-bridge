using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Execution
{
    [Serializable]
    internal sealed class EditorTaskStepRecord
    {
        public int index;
        public string operation;
        public string mutationId;
        public string intentPrefix;
        public string globalObjectId;
        public string name;
        public bool activeSelf;
        public float localPositionX;
        public float localPositionY;
        public float localPositionZ;
        public float localEulerX;
        public float localEulerY;
        public float localEulerZ;
        public float localScaleX;
        public float localScaleY;
        public float localScaleZ;
    }

    [Serializable]
    internal sealed class EditorTaskJournalRecord
    {
        public string taskId;
        public string intentFingerprint;
        public long createdUnixMs;
        public string createdStateEpoch;
        public long createdStateRevision;
        public EditorTaskStepRecord[] steps;
    }

    [Serializable]
    internal sealed class EditorTaskReservationRecord
    {
        public string taskId;
        public int stepIndex;
        public string operation;
        public string mutationId;
        public string intentPrefix;
    }

    [Serializable]
    internal sealed class EditorTaskIndexRecord
    {
        public string[] taskIds;
    }

    internal sealed class EditorTaskJournalConflictException : InvalidOperationException
    {
        public EditorTaskJournalConflictException(string message)
            : base(message)
        {
        }
    }

    internal static class EditorTaskJournal
    {
        public const int MaximumRetainedTasks = 16;
        public const int MaximumStepsPerTask = 8;

        private const string TaskKeyPrefix = "UnityAiBridge.TaskJournal.v1.";
        private const string ReservationKeyPrefix = "UnityAiBridge.TaskReservation.v1.";
        private const string IndexKey = "UnityAiBridge.TaskJournal.Index.v1";

        public static EditorTaskJournalRecord Begin(
            string taskId,
            EditorTaskStepRecord[] steps,
            EditorStateRevisionSnapshot state,
            out bool replayed)
        {
            if (string.IsNullOrWhiteSpace(taskId))
            {
                throw new ArgumentException("taskId is required.", nameof(taskId));
            }
            if (steps == null || steps.Length < 1 || steps.Length > MaximumStepsPerTask)
            {
                throw new ArgumentException(
                    $"A task must contain between 1 and {MaximumStepsPerTask} steps.",
                    nameof(steps));
            }
            if (state == null)
            {
                throw new ArgumentNullException(nameof(state));
            }

            var fingerprint = ComputeFingerprint(steps);
            var existing = Read(taskId);
            if (existing != null)
            {
                if (!string.Equals(existing.intentFingerprint, fingerprint, StringComparison.Ordinal))
                {
                    throw new EditorTaskJournalConflictException(
                        "taskId already belongs to a different immutable task plan.");
                }

                replayed = true;
                return existing;
            }

            for (var index = 0; index < steps.Length; index++)
            {
                var step = steps[index];
                ValidateStepRecord(step, index);

                var lifecycle = EditorMutationLifecycle.Read(step.mutationId);
                if (lifecycle != null)
                {
                    throw new EditorTaskJournalConflictException(
                        $"Task step {index} mutationId already has mutation lifecycle state. " +
                        "A task plan must be journaled before any of its step side effects begin.");
                }

                var reservation = ReadReservation(step.mutationId);
                if (reservation != null)
                {
                    throw new EditorTaskJournalConflictException(
                        $"Task step {index} mutationId is already reserved by task '{reservation.taskId}'.");
                }
            }

            var record = new EditorTaskJournalRecord
            {
                taskId = taskId,
                intentFingerprint = fingerprint,
                createdUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                createdStateEpoch = state.epoch,
                createdStateRevision = state.revision,
                steps = CopySteps(steps),
            };

            SessionState.SetString(TaskKeyPrefix + taskId, JsonUtility.ToJson(record));
            for (var index = 0; index < record.steps.Length; index++)
            {
                var step = record.steps[index];
                SessionState.SetString(
                    ReservationKeyPrefix + step.mutationId,
                    JsonUtility.ToJson(new EditorTaskReservationRecord
                    {
                        taskId = taskId,
                        stepIndex = index,
                        operation = step.operation,
                        mutationId = step.mutationId,
                        intentPrefix = step.intentPrefix,
                    }));
            }

            var taskIds = ReadIndex();
            taskIds.Remove(taskId);
            taskIds.Insert(0, taskId);
            while (taskIds.Count > MaximumRetainedTasks)
            {
                var evictedTaskId = taskIds[taskIds.Count - 1];
                taskIds.RemoveAt(taskIds.Count - 1);
                EraseTaskAndReservations(evictedTaskId);
            }
            WriteIndex(taskIds);

            replayed = false;
            return record;
        }

        public static EditorTaskJournalRecord Read(string taskId)
        {
            if (string.IsNullOrWhiteSpace(taskId))
            {
                return null;
            }

            var json = SessionState.GetString(TaskKeyPrefix + taskId, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            var record = JsonUtility.FromJson<EditorTaskJournalRecord>(json);
            if (record == null ||
                !string.Equals(record.taskId, taskId, StringComparison.Ordinal) ||
                string.IsNullOrEmpty(record.intentFingerprint) ||
                string.IsNullOrEmpty(record.createdStateEpoch) ||
                record.createdStateRevision <= 0 ||
                record.steps == null ||
                record.steps.Length < 1 ||
                record.steps.Length > MaximumStepsPerTask)
            {
                throw new InvalidOperationException("The retained task journal record is invalid.");
            }

            for (var index = 0; index < record.steps.Length; index++)
            {
                ValidateStepRecord(record.steps[index], index);
            }
            if (!string.Equals(
                    record.intentFingerprint,
                    ComputeFingerprint(record.steps),
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException("The retained task journal intent fingerprint is invalid.");
            }

            return record;
        }

        public static int RetainedTaskCount()
        {
            return ReadIndex().Count;
        }

        public static void ValidateMutationReservation(
            string operation,
            string mutationId,
            string actualIntentFingerprint,
            EditorStateRevisionSnapshot stateBefore)
        {
            var reservation = ReadReservation(mutationId);
            if (reservation == null)
            {
                return;
            }

            if (stateBefore == null)
            {
                throw new ArgumentNullException(nameof(stateBefore));
            }

            var task = Read(reservation.taskId);
            if (task == null)
            {
                throw new EditorMutationLifecycleConflictException(
                    "mutationId is reserved by a task journal that is no longer available. " +
                    "Execution is refused because the reservation cannot be reconciled safely.");
            }
            if (reservation.stepIndex < 0 || reservation.stepIndex >= task.steps.Length)
            {
                throw new EditorMutationLifecycleConflictException(
                    "The task mutation reservation has an invalid step index.");
            }

            var step = task.steps[reservation.stepIndex];
            if (!string.Equals(step.operation, operation, StringComparison.Ordinal) ||
                !string.Equals(step.mutationId, mutationId, StringComparison.Ordinal) ||
                !string.Equals(step.intentPrefix, reservation.intentPrefix, StringComparison.Ordinal))
            {
                throw new EditorMutationLifecycleConflictException(
                    "The task mutation reservation does not match the requested operation or mutation identity.");
            }

            var expectedPrefix = step.intentPrefix + "|epoch:";
            if (string.IsNullOrEmpty(actualIntentFingerprint) ||
                !actualIntentFingerprint.StartsWith(expectedPrefix, StringComparison.Ordinal))
            {
                throw new EditorMutationLifecycleConflictException(
                    "The reserved task mutation was invoked with arguments that differ from the immutable task plan. " +
                    "Execution was refused before the side effect began.");
            }

            var expectedEpoch = task.createdStateEpoch;
            var expectedRevision = task.createdStateRevision;
            for (var index = 0; index < reservation.stepIndex; index++)
            {
                var priorStep = task.steps[index];
                var priorLifecycle = EditorMutationLifecycle.Read(priorStep.mutationId);
                if (priorLifecycle == null ||
                    !string.Equals(priorLifecycle.operation, priorStep.operation, StringComparison.Ordinal) ||
                    !string.Equals(priorLifecycle.status, EditorMutationLifecycle.CompletedStatus, StringComparison.Ordinal))
                {
                    throw new EditorMutationLifecycleConflictException(
                        $"Task step {reservation.stepIndex} cannot execute because prior step {index} is not verified completed.");
                }

                expectedEpoch = priorLifecycle.finishedStateEpoch;
                expectedRevision = priorLifecycle.finishedStateRevision;
            }

            for (var index = reservation.stepIndex + 1; index < task.steps.Length; index++)
            {
                var laterLifecycle = EditorMutationLifecycle.Read(task.steps[index].mutationId);
                if (laterLifecycle != null)
                {
                    throw new EditorMutationLifecycleConflictException(
                        "The task journal is out of order because a later step already has lifecycle state. " +
                        "Automatic continuation is refused.");
                }
            }

            if (!string.Equals(stateBefore.epoch, expectedEpoch, StringComparison.Ordinal) ||
                stateBefore.revision != expectedRevision)
            {
                throw new EditorMutationLifecycleConflictException(
                    "Unity state advanced outside the exact completed task boundary. " +
                    "The reserved task step will not execute until the task is re-observed and replanned.");
            }
        }

        internal static void ClearForVerification(string taskId)
        {
            if (string.IsNullOrWhiteSpace(taskId))
            {
                return;
            }

            EraseTaskAndReservations(taskId);
            var taskIds = ReadIndex();
            if (taskIds.Remove(taskId))
            {
                WriteIndex(taskIds);
            }
        }

        private static EditorTaskReservationRecord ReadReservation(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                return null;
            }

            var json = SessionState.GetString(
                ReservationKeyPrefix + mutationId,
                string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            var reservation = JsonUtility.FromJson<EditorTaskReservationRecord>(json);
            if (reservation == null ||
                string.IsNullOrEmpty(reservation.taskId) ||
                string.IsNullOrEmpty(reservation.operation) ||
                string.IsNullOrEmpty(reservation.mutationId) ||
                string.IsNullOrEmpty(reservation.intentPrefix))
            {
                throw new InvalidOperationException("The stored task mutation reservation is invalid.");
            }
            return reservation;
        }

        private static string ComputeFingerprint(EditorTaskStepRecord[] steps)
        {
            var builder = new StringBuilder();
            builder.Append("task-v1|");
            builder.Append(steps.Length.ToString(CultureInfo.InvariantCulture));
            for (var index = 0; index < steps.Length; index++)
            {
                var step = steps[index];
                builder.Append('|');
                builder.Append(index.ToString(CultureInfo.InvariantCulture));
                builder.Append(':');
                builder.Append(step.operation ?? string.Empty);
                builder.Append(':');
                builder.Append(step.mutationId ?? string.Empty);
                builder.Append(':');
                builder.Append(step.intentPrefix ?? string.Empty);
            }

            using (var sha256 = SHA256.Create())
            {
                var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(builder.ToString()));
                var hex = new StringBuilder(hash.Length * 2);
                for (var index = 0; index < hash.Length; index++)
                {
                    hex.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return hex.ToString();
            }
        }

        private static EditorTaskStepRecord[] CopySteps(EditorTaskStepRecord[] steps)
        {
            var copy = new EditorTaskStepRecord[steps.Length];
            for (var index = 0; index < steps.Length; index++)
            {
                var step = steps[index];
                copy[index] = new EditorTaskStepRecord
                {
                    index = index,
                    operation = step.operation,
                    mutationId = step.mutationId,
                    intentPrefix = step.intentPrefix,
                    globalObjectId = step.globalObjectId,
                    name = step.name,
                    activeSelf = step.activeSelf,
                    localPositionX = step.localPositionX,
                    localPositionY = step.localPositionY,
                    localPositionZ = step.localPositionZ,
                    localEulerX = step.localEulerX,
                    localEulerY = step.localEulerY,
                    localEulerZ = step.localEulerZ,
                    localScaleX = step.localScaleX,
                    localScaleY = step.localScaleY,
                    localScaleZ = step.localScaleZ,
                };
            }
            return copy;
        }

        private static void ValidateStepRecord(EditorTaskStepRecord step, int expectedIndex)
        {
            if (step == null ||
                step.index != expectedIndex ||
                string.IsNullOrEmpty(step.operation) ||
                string.IsNullOrEmpty(step.mutationId) ||
                string.IsNullOrEmpty(step.intentPrefix) ||
                string.IsNullOrEmpty(step.globalObjectId))
            {
                throw new InvalidOperationException("The task step record is invalid.");
            }
        }

        private static List<string> ReadIndex()
        {
            var json = SessionState.GetString(IndexKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return new List<string>();
            }

            var payload = JsonUtility.FromJson<EditorTaskIndexRecord>(json);
            return payload != null && payload.taskIds != null
                ? new List<string>(payload.taskIds)
                : new List<string>();
        }

        private static void WriteIndex(List<string> taskIds)
        {
            SessionState.SetString(
                IndexKey,
                JsonUtility.ToJson(new EditorTaskIndexRecord
                {
                    taskIds = taskIds.ToArray(),
                }));
        }

        private static void EraseTaskAndReservations(string taskId)
        {
            var record = Read(taskId);
            if (record != null && record.steps != null)
            {
                for (var index = 0; index < record.steps.Length; index++)
                {
                    var mutationId = record.steps[index].mutationId;
                    if (!string.IsNullOrEmpty(mutationId))
                    {
                        SessionState.EraseString(ReservationKeyPrefix + mutationId);
                    }
                }
            }
            SessionState.EraseString(TaskKeyPrefix + taskId);
        }
    }
}
