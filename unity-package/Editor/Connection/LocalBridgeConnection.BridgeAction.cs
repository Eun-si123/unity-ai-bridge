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
        private static async Task<bool> TryHandleBridgeActionCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "action.history", StringComparison.Ordinal))
            {
                await HandleBridgeActionHistoryAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "action.undoLast", StringComparison.Ordinal))
            {
                await HandleBridgeActionUndoLastAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandleBridgeActionHistoryAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "read", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "action.history requires risk='read'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<BridgeActionHistoryBridgeCommandDto>(rawJson);
            var maxResults = bridgeCommand != null && bridgeCommand.arguments != null &&
                bridgeCommand.arguments.maxResults > 0
                    ? bridgeCommand.arguments.maxResults
                    : BridgeActionHistoryCommand.DefaultMaxResults;

            try
            {
                BridgeActionHistoryCommand.ValidateArguments(maxResults);
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => BridgeActionHistoryCommand.Execute(maxResults));
                var response = new BridgeActionHistoryResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    dirtyState = "unchanged",
                    compileState = EditorApplication.isCompiling ? "compiling" : "idle",
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
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "action_history_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleBridgeActionUndoLastAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "write", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "action.undoLast requires risk='write'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<BridgeActionUndoBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            var mutationId = arguments != null ? arguments.mutationId : null;
            var expectedStateEpoch = arguments != null ? arguments.expectedStateEpoch : null;
            var expectedStateRevision = arguments != null ? arguments.expectedStateRevision : 0;

            try
            {
                BridgeActionUndoLastCommand.ValidateArguments(
                    mutationId,
                    expectedStateEpoch,
                    expectedStateRevision);
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => BridgeActionUndoLastCommand.Execute(
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);
                var response = new BridgeActionUndoResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = new[]
                    {
                        "Safe last-action Undo only applies to the exact current Unity Undo top recorded for the latest bridge action. It is not arbitrary historical rollback.",
                    },
                    dirtyState = result.sceneIsDirty ? "dirty" : "clean",
                    compileState = "idle",
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
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "timeout",
                    "deadline_exceeded",
                    exception.Message,
                    cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "state_revision_mismatch",
                    exception.Message,
                    cancellationToken);
            }
            catch (BridgeActionUndoUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "policy",
                    "undo_not_safe",
                    exception.Message,
                    cancellationToken);
            }
            catch (BridgeActionUndoVerificationException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "undo_verification_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "action_undo_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        [Serializable]
        private sealed class BridgeActionHistoryBridgeCommandDto
        {
            public BridgeActionHistoryArgumentsDto arguments;
        }

        [Serializable]
        private sealed class BridgeActionHistoryArgumentsDto
        {
            public int maxResults;
        }

        [Serializable]
        private sealed class BridgeActionUndoBridgeCommandDto
        {
            public BridgeActionUndoArgumentsDto arguments;
        }

        [Serializable]
        private sealed class BridgeActionUndoArgumentsDto
        {
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeActionHistoryResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public BridgeActionHistoryPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeActionUndoResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public BridgeActionUndoPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
