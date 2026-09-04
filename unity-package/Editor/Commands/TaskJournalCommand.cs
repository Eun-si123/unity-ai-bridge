using System;
using System.Collections.Generic;
using System.Globalization;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class TaskStepPlanPayload
    {
        public int index;
        public string operation;
        public string mutationId;
        public string globalObjectId;
        public string name;
        public bool activeSelf;
        public TransformVector3Payload localPosition;
        public TransformVector3Payload localEulerAngles;
        public TransformVector3Payload localScale;
    }

    [Serializable]
    internal sealed class TaskStepStatusPayload
    {
        public int index;
        public string operation;
        public string mutationId;
        public string globalObjectId;
        public string name;
        public bool activeSelf;
        public TransformVector3Payload localPosition;
        public TransformVector3Payload localEulerAngles;
        public TransformVector3Payload localScale;
        public string stepStatus;
        public string lifecycleStatus;
        public long startedUnixMs;
        public long finishedUnixMs;
        public string finishedStateEpoch;
        public long finishedStateRevision;
        public string failureKind;
    }

    [Serializable]
    internal sealed class TaskJournalPayload
    {
        public string taskId;
        public bool found;
        public bool replayed;
        public string journalKind;
        public string sessionScope;
        public string[] supportedOperations;
        public long createdUnixMs;
        public string createdStateEpoch;
        public long createdStateRevision;
        public string currentStateEpoch;
        public long currentStateRevision;
        public string expectedBoundaryStateEpoch;
        public long expectedBoundaryStateRevision;
        public bool currentStateMatchesExpectedBoundary;
        public string status;
        public string resumeState;
        public bool safeToExecuteNextStep;
        public int nextStepIndex;
        public string nextOperation;
        public string nextMutationId;
        public TaskStepStatusPayload[] steps;
        public int retainedTaskCount;
        public int maximumRetainedTasks;
        public int maximumStepsPerTask;
    }

    internal sealed class TaskJournalUnavailableException : InvalidOperationException
    {
        public TaskJournalUnavailableException(string message) : base(message) { }
    }

    internal static class TaskJournalCommand
    {
        public const int MaximumTaskIdLength = 128;
        public const string GameObjectUpdateOperation = "gameObject.update";
        public const string TransformSetOperation = "transform.set";

        private const string JournalKind = "bounded_task_journal_v1";
        private const string SessionScope = "current_editor_session";

        private static readonly string[] SupportedOperations =
        {
            GameObjectUpdateOperation,
            TransformSetOperation,
        };

        public static TaskJournalPayload Begin(string taskId, TaskStepPlanPayload[] steps)
        {
            ValidateTaskId(taskId);
            var records = BuildStepRecords(steps);

            var existing = EditorTaskJournal.Read(taskId);
            if (existing == null)
            {
                if (EditorApplication.isCompiling)
                {
                    throw new TaskJournalUnavailableException(
                        "Unity is compiling; a new task journal was not created.");
                }

                RequireNewTaskTargetsAvailable(records);
            }

            var stateBefore = EditorStateRevision.Capture();
            var record = EditorTaskJournal.Begin(taskId, records, stateBefore, out var replayed);
            return BuildPayload(record, replayed);
        }

        public static TaskJournalPayload Get(string taskId)
        {
            ValidateTaskId(taskId);
            var record = EditorTaskJournal.Read(taskId);
            if (record == null)
            {
                var current = EditorStateRevision.Capture();
                return new TaskJournalPayload
                {
                    taskId = taskId,
                    found = false,
                    replayed = false,
                    journalKind = JournalKind,
                    sessionScope = SessionScope,
                    supportedOperations = CopySupportedOperations(),
                    createdUnixMs = 0,
                    createdStateEpoch = string.Empty,
                    createdStateRevision = 0,
                    currentStateEpoch = current.epoch,
                    currentStateRevision = current.revision,
                    expectedBoundaryStateEpoch = string.Empty,
                    expectedBoundaryStateRevision = 0,
                    currentStateMatchesExpectedBoundary = false,
                    status = "not_found",
                    resumeState = "task_not_retained",
                    safeToExecuteNextStep = false,
                    nextStepIndex = -1,
                    nextOperation = string.Empty,
                    nextMutationId = string.Empty,
                    steps = Array.Empty<TaskStepStatusPayload>(),
                    retainedTaskCount = EditorTaskJournal.RetainedTaskCount(),
                    maximumRetainedTasks = EditorTaskJournal.MaximumRetainedTasks,
                    maximumStepsPerTask = EditorTaskJournal.MaximumStepsPerTask,
                };
            }

            return BuildPayload(record, false);
        }

        public static void ValidateTaskId(string taskId)
        {
            if (string.IsNullOrWhiteSpace(taskId))
            {
                throw new ArgumentException("taskId is required.", nameof(taskId));
            }
            if (taskId.Length > MaximumTaskIdLength)
            {
                throw new ArgumentException(
                    $"taskId must be at most {MaximumTaskIdLength} characters.",
                    nameof(taskId));
            }

            for (var index = 0; index < taskId.Length; index++)
            {
                var value = taskId[index];
                var allowed =
                    (value >= 'a' && value <= 'z') ||
                    (value >= 'A' && value <= 'Z') ||
                    (value >= '0' && value <= '9') ||
                    value == '-' || value == '_' || value == '.' || value == ':';
                if (!allowed)
                {
                    throw new ArgumentException(
                        "taskId may contain only letters, digits, '-', '_', '.', and ':'.",
                        nameof(taskId));
                }
            }
        }

        internal static string BuildGameObjectUpdateIntentPrefix(
            string globalObjectId,
            string name,
            bool activeSelf)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new ArgumentException("gameObject.update task step name is required.", nameof(name));
            }
            if (name.Length > GameObjectUpdateCommand.MaximumNameLength)
            {
                throw new ArgumentException(
                    $"gameObject.update task step name must be at most {GameObjectUpdateCommand.MaximumNameLength} characters.",
                    nameof(name));
            }

            return string.Join(
                "|",
                "target:" + globalObjectId,
                "name:" + name.Length.ToString(CultureInfo.InvariantCulture) + ":" + name,
                "active:" + (activeSelf ? "1" : "0"));
        }

        internal static string BuildTransformSetIntentPrefix(
            string globalObjectId,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            ValidateVector(localPosition, nameof(localPosition));
            ValidateVector(localEulerAngles, nameof(localEulerAngles));
            ValidateVector(localScale, nameof(localScale));

            return string.Join(
                "|",
                "target:" + globalObjectId,
                "position:" + FormatVector(localPosition),
                "euler:" + FormatVector(localEulerAngles),
                "scale:" + FormatVector(localScale));
        }

        private static EditorTaskStepRecord[] BuildStepRecords(TaskStepPlanPayload[] steps)
        {
            if (steps == null ||
                steps.Length < 1 ||
                steps.Length > EditorTaskJournal.MaximumStepsPerTask)
            {
                throw new ArgumentException(
                    $"steps must contain between 1 and {EditorTaskJournal.MaximumStepsPerTask} entries.",
                    nameof(steps));
            }

            var mutationIds = new HashSet<string>(StringComparer.Ordinal);
            var records = new EditorTaskStepRecord[steps.Length];
            for (var index = 0; index < steps.Length; index++)
            {
                var step = steps[index];
                if (step == null)
                {
                    throw new ArgumentException($"steps[{index}] is required.", nameof(steps));
                }
                if (step.index != index)
                {
                    throw new ArgumentException(
                        $"steps[{index}].index must equal its zero-based position {index}.",
                        nameof(steps));
                }

                GameObjectUpdateCommand.ValidateMutationId(step.mutationId);
                if (!mutationIds.Add(step.mutationId))
                {
                    throw new ArgumentException(
                        "Each task step must use a unique mutationId.",
                        nameof(steps));
                }

                if (string.Equals(step.operation, GameObjectUpdateOperation, StringComparison.Ordinal))
                {
                    if (step.localPosition != null || step.localEulerAngles != null || step.localScale != null)
                    {
                        throw new ArgumentException(
                            $"steps[{index}] gameObject.update must not include Transform fields.",
                            nameof(steps));
                    }

                    records[index] = new EditorTaskStepRecord
                    {
                        index = index,
                        operation = step.operation,
                        mutationId = step.mutationId,
                        intentPrefix = BuildGameObjectUpdateIntentPrefix(
                            step.globalObjectId,
                            step.name,
                            step.activeSelf),
                        globalObjectId = step.globalObjectId,
                        name = step.name,
                        activeSelf = step.activeSelf,
                    };
                    continue;
                }

                if (string.Equals(step.operation, TransformSetOperation, StringComparison.Ordinal))
                {
                    if (!string.IsNullOrEmpty(step.name))
                    {
                        throw new ArgumentException(
                            $"steps[{index}] transform.set must not include name.",
                            nameof(steps));
                    }

                    var prefix = BuildTransformSetIntentPrefix(
                        step.globalObjectId,
                        step.localPosition,
                        step.localEulerAngles,
                        step.localScale);
                    records[index] = new EditorTaskStepRecord
                    {
                        index = index,
                        operation = step.operation,
                        mutationId = step.mutationId,
                        intentPrefix = prefix,
                        globalObjectId = step.globalObjectId,
                        name = string.Empty,
                        activeSelf = false,
                        localPositionX = step.localPosition.x,
                        localPositionY = step.localPosition.y,
                        localPositionZ = step.localPosition.z,
                        localEulerX = step.localEulerAngles.x,
                        localEulerY = step.localEulerAngles.y,
                        localEulerZ = step.localEulerAngles.z,
                        localScaleX = step.localScale.x,
                        localScaleY = step.localScale.y,
                        localScaleZ = step.localScale.z,
                    };
                    continue;
                }

                throw new ArgumentException(
                    $"steps[{index}].operation must be '{GameObjectUpdateOperation}' or '{TransformSetOperation}'.",
                    nameof(steps));
            }

            return records;
        }

        private static void RequireNewTaskTargetsAvailable(EditorTaskStepRecord[] steps)
        {
            var activeScene = SceneManager.GetActiveScene();
            if (!activeScene.IsValid() || !activeScene.isLoaded || string.IsNullOrEmpty(activeScene.path))
            {
                throw new TaskJournalUnavailableException(
                    "A new multi-step task requires a saved active Scene so every reserved target identity remains durable.");
            }

            for (var index = 0; index < steps.Length; index++)
            {
                GameObject target;
                try
                {
                    target = GameObjectSnapshotCommand.ResolveGameObject(
                        steps[index].globalObjectId,
                        out var canonicalGlobalObjectId);
                    if (!string.Equals(
                            canonicalGlobalObjectId,
                            steps[index].globalObjectId,
                            StringComparison.Ordinal))
                    {
                        throw new TaskJournalUnavailableException(
                            $"Task step {index} must use the canonical current GameObject GlobalObjectId.");
                    }
                }
                catch (GameObjectEditTargetUnavailableException exception)
                {
                    throw new TaskJournalUnavailableException(
                        $"Task step {index} target is unavailable. {exception.Message}");
                }

                if (target.scene != activeScene)
                {
                    throw new TaskJournalUnavailableException(
                        $"Task step {index} target must belong to the saved active Scene.");
                }
            }
        }

        private static TaskJournalPayload BuildPayload(
            EditorTaskJournalRecord record,
            bool replayed)
        {
            var current = EditorStateRevision.Capture();
            var stepStatuses = new TaskStepStatusPayload[record.steps.Length];
            var expectedEpoch = record.createdStateEpoch;
            var expectedRevision = record.createdStateRevision;
            var firstUnresolved = -1;
            var firstUnresolvedKind = string.Empty;
            var blockedReason = string.Empty;

            for (var index = 0; index < record.steps.Length; index++)
            {
                var step = record.steps[index];
                var lifecycle = EditorMutationLifecycle.Read(step.mutationId);
                var payload = CopyStep(step);
                stepStatuses[index] = payload;

                if (lifecycle == null)
                {
                    payload.stepStatus = "pending";
                    payload.lifecycleStatus = "not_found";
                    if (firstUnresolved < 0)
                    {
                        firstUnresolved = index;
                        firstUnresolvedKind = "pending";
                    }
                    continue;
                }

                payload.lifecycleStatus = lifecycle.status ?? string.Empty;
                payload.startedUnixMs = lifecycle.startedUnixMs;
                payload.finishedUnixMs = lifecycle.finishedUnixMs;
                payload.finishedStateEpoch = lifecycle.finishedStateEpoch ?? string.Empty;
                payload.finishedStateRevision = lifecycle.finishedStateRevision;
                payload.failureKind = lifecycle.failureKind ?? string.Empty;

                if (!string.Equals(lifecycle.operation, step.operation, StringComparison.Ordinal))
                {
                    payload.stepStatus = "conflict";
                    blockedReason = "blocked_step_operation_conflict";
                    if (firstUnresolved < 0)
                    {
                        firstUnresolved = index;
                        firstUnresolvedKind = "conflict";
                    }
                    continue;
                }

                if (string.Equals(lifecycle.status, EditorMutationLifecycle.CompletedStatus, StringComparison.Ordinal))
                {
                    payload.stepStatus = "completed";
                    if (firstUnresolved >= 0)
                    {
                        blockedReason = "blocked_out_of_order_lifecycle";
                    }
                    else
                    {
                        expectedEpoch = lifecycle.finishedStateEpoch;
                        expectedRevision = lifecycle.finishedStateRevision;
                    }
                    continue;
                }

                if (string.Equals(lifecycle.status, EditorMutationLifecycle.StartedStatus, StringComparison.Ordinal))
                {
                    payload.stepStatus = "started";
                    if (firstUnresolved < 0)
                    {
                        firstUnresolved = index;
                        firstUnresolvedKind = "started";
                    }
                    else if (firstUnresolved != index)
                    {
                        blockedReason = "blocked_out_of_order_lifecycle";
                    }
                    continue;
                }

                if (IsKnownTerminalFailure(lifecycle.status))
                {
                    payload.stepStatus = "failed";
                    if (firstUnresolved < 0)
                    {
                        firstUnresolved = index;
                        firstUnresolvedKind = "failed";
                    }
                    blockedReason = "blocked_terminal_step_failure";
                    continue;
                }

                throw new InvalidOperationException(
                    $"Task step {index} has unrecognized mutation lifecycle status '{lifecycle.status}'.");
            }

            var stateMatchesBoundary =
                string.Equals(current.epoch, expectedEpoch, StringComparison.Ordinal) &&
                current.revision == expectedRevision;

            var status = string.Empty;
            var resumeState = string.Empty;
            var safe = false;
            var nextStepIndex = -1;
            var nextOperation = string.Empty;
            var nextMutationId = string.Empty;

            if (!string.IsNullOrEmpty(blockedReason))
            {
                status = "blocked";
                resumeState = blockedReason;
            }
            else if (firstUnresolved < 0)
            {
                status = "completed";
                resumeState = stateMatchesBoundary ? "completed" : "completed_state_drifted";
            }
            else if (string.Equals(firstUnresolvedKind, "started", StringComparison.Ordinal))
            {
                status = "waiting_reconciliation";
                resumeState = "reconcile_started_step_before_resume";
                nextStepIndex = firstUnresolved;
                nextOperation = record.steps[firstUnresolved].operation;
                nextMutationId = record.steps[firstUnresolved].mutationId;
            }
            else if (string.Equals(firstUnresolvedKind, "pending", StringComparison.Ordinal))
            {
                nextStepIndex = firstUnresolved;
                nextOperation = record.steps[firstUnresolved].operation;
                nextMutationId = record.steps[firstUnresolved].mutationId;
                if (stateMatchesBoundary)
                {
                    status = "ready";
                    resumeState = "execute_next_reserved_step";
                    safe = true;
                }
                else
                {
                    status = "blocked";
                    resumeState = "blocked_state_drift";
                }
            }
            else
            {
                status = "blocked";
                resumeState = "blocked_task_conflict";
            }

            return new TaskJournalPayload
            {
                taskId = record.taskId,
                found = true,
                replayed = replayed,
                journalKind = JournalKind,
                sessionScope = SessionScope,
                supportedOperations = CopySupportedOperations(),
                createdUnixMs = record.createdUnixMs,
                createdStateEpoch = record.createdStateEpoch,
                createdStateRevision = record.createdStateRevision,
                currentStateEpoch = current.epoch,
                currentStateRevision = current.revision,
                expectedBoundaryStateEpoch = expectedEpoch,
                expectedBoundaryStateRevision = expectedRevision,
                currentStateMatchesExpectedBoundary = stateMatchesBoundary,
                status = status,
                resumeState = resumeState,
                safeToExecuteNextStep = safe,
                nextStepIndex = nextStepIndex,
                nextOperation = nextOperation,
                nextMutationId = nextMutationId,
                steps = stepStatuses,
                retainedTaskCount = EditorTaskJournal.RetainedTaskCount(),
                maximumRetainedTasks = EditorTaskJournal.MaximumRetainedTasks,
                maximumStepsPerTask = EditorTaskJournal.MaximumStepsPerTask,
            };
        }

        private static TaskStepStatusPayload CopyStep(EditorTaskStepRecord step)
        {
            var isTransform = string.Equals(
                step.operation,
                TransformSetOperation,
                StringComparison.Ordinal);
            return new TaskStepStatusPayload
            {
                index = step.index,
                operation = step.operation,
                mutationId = step.mutationId,
                globalObjectId = step.globalObjectId,
                name = step.name ?? string.Empty,
                activeSelf = step.activeSelf,
                localPosition = isTransform
                    ? new TransformVector3Payload
                    {
                        x = step.localPositionX,
                        y = step.localPositionY,
                        z = step.localPositionZ,
                    }
                    : null,
                localEulerAngles = isTransform
                    ? new TransformVector3Payload
                    {
                        x = step.localEulerX,
                        y = step.localEulerY,
                        z = step.localEulerZ,
                    }
                    : null,
                localScale = isTransform
                    ? new TransformVector3Payload
                    {
                        x = step.localScaleX,
                        y = step.localScaleY,
                        z = step.localScaleZ,
                    }
                    : null,
                stepStatus = string.Empty,
                lifecycleStatus = string.Empty,
                startedUnixMs = 0,
                finishedUnixMs = 0,
                finishedStateEpoch = string.Empty,
                finishedStateRevision = 0,
                failureKind = string.Empty,
            };
        }

        private static bool IsKnownTerminalFailure(string status)
        {
            return string.Equals(status, EditorMutationLifecycle.FailedRolledBackStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.FailedNoMutationStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.RollbackFailedStatus, StringComparison.Ordinal) ||
                string.Equals(status, EditorMutationLifecycle.RollbackVerificationFailedStatus, StringComparison.Ordinal);
        }

        private static void ValidateVector(TransformVector3Payload value, string parameterName)
        {
            if (value == null)
            {
                throw new ArgumentException(parameterName + " is required.", parameterName);
            }
            if (!IsFinite(value.x) || !IsFinite(value.y) || !IsFinite(value.z))
            {
                throw new ArgumentException(parameterName + " must contain only finite numeric values.", parameterName);
            }
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private static string FormatVector(TransformVector3Payload value)
        {
            return string.Join(
                ",",
                value.x.ToString("R", CultureInfo.InvariantCulture),
                value.y.ToString("R", CultureInfo.InvariantCulture),
                value.z.ToString("R", CultureInfo.InvariantCulture));
        }

        private static string[] CopySupportedOperations()
        {
            return new[]
            {
                SupportedOperations[0],
                SupportedOperations[1],
            };
        }
    }
}
