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
        private static async Task<bool> TryHandlePlayModeCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.operation, "editor.playMode.set", StringComparison.Ordinal))
            {
                return await TryHandleTestRunnerCommandAsync(current, command, rawJson, cancellationToken);
            }

            await HandlePlayModeSetAsync(current, command, rawJson, cancellationToken);
            return true;
        }

        private static async Task HandlePlayModeSetAsync(
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
                    "editor.playMode.set requires risk='write'.",
                    cancellationToken);
                return;
            }

            var playModeCommand = JsonUtility.FromJson<PlayModeBridgeCommandDto>(rawJson);
            var arguments = playModeCommand != null ? playModeCommand.arguments : null;
            var targetMode = arguments != null ? arguments.targetMode : null;
            var expectedCurrentMode = arguments != null ? arguments.expectedCurrentMode : null;
            var mutationId = arguments != null ? arguments.mutationId : null;

            try
            {
                PlayModeCommand.ValidateArguments(targetMode, expectedCurrentMode, mutationId);
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
                return;
            }

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => PlayModeCommand.Execute(targetMode, expectedCurrentMode, mutationId),
                    command.deadlineUnixMs,
                    command.operation);
                var response = new BridgePlayModeSetResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = new[]
                    {
                        "Play Mode transitions are asynchronous operational state changes and are not Unity Undo operations.",
                    },
                    changedTargets = Array.Empty<BridgeChangedTargetDto>(),
                    dirtyState = "unchanged",
                    undo = new BridgeUndoDto
                    {
                        available = false,
                        groupName = string.Empty,
                    },
                    compileState = EditorApplication.isCompiling ? "compiling" : "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
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
            catch (PlayModeCompilingException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "compile_reload",
                    "editor_compiling",
                    exception.Message,
                    cancellationToken);
            }
            catch (PlayModeStateMismatchException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "play_mode_state_mismatch",
                    exception.Message,
                    cancellationToken);
            }
            catch (PlayModeTransitionInProgressException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "play_mode_transition_in_progress",
                    exception.Message,
                    cancellationToken);
            }
            catch (PlayModeMutationConflictException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "mutation_id_conflict",
                    exception.Message,
                    cancellationToken);
            }
            catch (PlayModeIncompleteException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "mutation_outcome_incomplete",
                    exception.Message,
                    cancellationToken);
            }
            catch (PlayModeReplayStaleException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "mutation_replay_stale",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "play_mode_set_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        [Serializable]
        private sealed class PlayModeBridgeCommandDto
        {
            public PlayModeCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class PlayModeCommandArgumentsDto
        {
            public string targetMode;
            public string expectedCurrentMode;
            public string mutationId;
        }

        [Serializable]
        private sealed class BridgePlayModeSetResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public PlayModeSetPayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
