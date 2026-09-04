using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Execution;
using UnityAiBridge.Editor.Protocol;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Connection
{
    internal static partial class LocalBridgeConnection
    {
        private static async Task<bool> TryHandleTaskJournalCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            var isBegin = string.Equals(command.operation, "task.begin", StringComparison.Ordinal);
            var isGet = string.Equals(command.operation, "task.get", StringComparison.Ordinal);
            if (!isBegin && !isGet)
            {
                return false;
            }

            if (!string.Equals(command.risk, "read", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    command.operation + " requires risk='read'.",
                    cancellationToken);
                return true;
            }

            var taskCommand = JsonUtility.FromJson<TaskJournalBridgeCommandDto>(rawJson);
            var arguments = taskCommand != null ? taskCommand.arguments : null;
            var taskId = arguments != null ? arguments.taskId : null;

            try
            {
                TaskJournalCommand.ValidateTaskId(taskId);
                if (isBegin && (arguments == null || arguments.steps == null))
                {
                    throw new ArgumentException("steps are required for task.begin.");
                }
                if (isBegin)
                {
                    NormalizeTaskStepJsonUtilityArtifacts(arguments.steps);
                }
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_arguments",
                    exception.Message,
                    cancellationToken);
                return true;
            }

            try
            {
                var observation = await EditorMainThreadDispatcher.InvokeAsync(
                    () => new TaskJournalExecutionObservation
                    {
                        result = isBegin
                            ? TaskJournalCommand.Begin(taskId, arguments.steps)
                            : TaskJournalCommand.Get(taskId),
                        isCompiling = EditorApplication.isCompiling,
                    });

                var response = new BridgeTaskJournalResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = observation.result,
                    warnings = Array.Empty<string>(),
                    dirtyState = "unchanged",
                    compileState = observation.isCompiling ? "compiling" : "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_arguments",
                    exception.Message,
                    cancellationToken);
            }
            catch (EditorTaskJournalConflictException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "task_conflict",
                    exception.Message,
                    cancellationToken);
            }
            catch (TaskJournalUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "task_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "task_journal_failed",
                    exception.Message,
                    cancellationToken);
            }

            return true;
        }

        internal static void NormalizeTaskStepJsonUtilityArtifacts(TaskStepPlanPayload[] steps)
        {
            if (steps == null)
            {
                return;
            }

            for (var index = 0; index < steps.Length; index++)
            {
                var step = steps[index];
                if (step == null ||
                    !string.Equals(
                        step.operation,
                        TaskJournalCommand.GameObjectUpdateOperation,
                        StringComparison.Ordinal))
                {
                    continue;
                }

                step.localPosition = NormalizeDefaultVectorArtifact(step.localPosition);
                step.localEulerAngles = NormalizeDefaultVectorArtifact(step.localEulerAngles);
                step.localScale = NormalizeDefaultVectorArtifact(step.localScale);
            }
        }

        private static TransformVector3Payload NormalizeDefaultVectorArtifact(
            TransformVector3Payload value)
        {
            if (value == null)
            {
                return null;
            }

            // Unity's by-value serializer cannot reliably preserve null custom-class
            // references and may materialize an omitted nested object as an all-default
            // inline instance. Treat only that exact zero/default shape as a wire artifact.
            // Any non-default irrelevant Transform payload is intentionally retained so
            // TaskJournalCommand's operation-specific validation still rejects it.
            return value.x == 0f && value.y == 0f && value.z == 0f
                ? null
                : value;
        }

        private sealed class TaskJournalExecutionObservation
        {
            public TaskJournalPayload result;
            public bool isCompiling;
        }

        [Serializable]
        private sealed class TaskJournalBridgeCommandDto
        {
            public TaskJournalCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class TaskJournalCommandArgumentsDto
        {
            public string taskId;
            public TaskStepPlanPayload[] steps;
        }

        [Serializable]
        private sealed class BridgeTaskJournalResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public TaskJournalPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
