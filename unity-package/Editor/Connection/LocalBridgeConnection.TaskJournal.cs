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
