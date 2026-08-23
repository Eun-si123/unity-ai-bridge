using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Execution;
using UnityAiBridge.Editor.Protocol;
using UnityEngine;

namespace UnityAiBridge.Editor.Connection
{
    internal static partial class LocalBridgeConnection
    {
        private static async Task<bool> TryHandleGameObjectEditCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "gameObject.update", StringComparison.Ordinal))
            {
                await HandleGameObjectUpdateAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "gameObject.delete", StringComparison.Ordinal))
            {
                await HandleGameObjectDeleteAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandleGameObjectUpdateAsync(
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
                    "gameObject.update requires risk='write'.",
                    cancellationToken);
                return;
            }

            var editCommand = JsonUtility.FromJson<GameObjectEditBridgeCommandDto>(rawJson);
            var arguments = editCommand != null ? editCommand.arguments : null;
            var globalObjectId = arguments != null ? arguments.globalObjectId : null;
            var name = arguments != null ? arguments.name : null;
            var activeSelf = arguments != null && arguments.activeSelf;
            var mutationId = arguments != null ? arguments.mutationId : null;
            var expectedStateEpoch = arguments != null ? arguments.expectedStateEpoch : null;
            var expectedStateRevision = arguments != null ? arguments.expectedStateRevision : 0;

            try
            {
                GameObjectUpdateCommand.ValidateArguments(
                    globalObjectId,
                    name,
                    mutationId,
                    expectedStateEpoch,
                    expectedStateRevision);
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
                    () => GameObjectUpdateCommand.Execute(
                        globalObjectId,
                        name,
                        activeSelf,
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgeGameObjectUpdateResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    changedTargets = result.replayed || !result.changed
                        ? Array.Empty<BridgeChangedTargetDto>()
                        : new[]
                        {
                            new BridgeChangedTargetDto
                            {
                                globalObjectId = result.gameObject.globalObjectId,
                                instanceId = result.gameObject.instanceId,
                                name = result.gameObject.name,
                            },
                        },
                    dirtyState = result.replayed || !result.changed ? "unchanged" : "dirty",
                    undo = new BridgeUndoDto
                    {
                        available = !result.replayed && result.changed,
                        groupName = !result.replayed && result.changed
                            ? "Unity AI Bridge: Update GameObject"
                            : string.Empty,
                    },
                    compileState = "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(current, command.requestId, "timeout", "deadline_exceeded", exception.Message, cancellationToken);
            }
            catch (GameObjectEditCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "state_revision_mismatch", exception.Message, cancellationToken);
            }
            catch (GameObjectEditTargetUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "gameobject_target_unavailable", exception.Message, cancellationToken);
            }
            catch (GameObjectEditMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (GameObjectEditIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete", exception.Message, cancellationToken);
            }
            catch (GameObjectEditReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale", exception.Message, cancellationToken);
            }
            catch (GameObjectEditReadbackException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "native_readback_failed", exception.Message, cancellationToken);
            }
            catch (EditorMutationRollbackVerificationException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "rollback_verification_failed", exception.Message, cancellationToken);
            }
            catch (EditorMutationRollbackException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "rollback_failed", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "gameobject_update_failed", exception.Message, cancellationToken);
            }
        }

        private static async Task HandleGameObjectDeleteAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "destructive", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "gameObject.delete requires risk='destructive'.",
                    cancellationToken);
                return;
            }

            var editCommand = JsonUtility.FromJson<GameObjectEditBridgeCommandDto>(rawJson);
            var arguments = editCommand != null ? editCommand.arguments : null;
            var globalObjectId = arguments != null ? arguments.globalObjectId : null;
            var mutationId = arguments != null ? arguments.mutationId : null;
            var expectedStateEpoch = arguments != null ? arguments.expectedStateEpoch : null;
            var expectedStateRevision = arguments != null ? arguments.expectedStateRevision : 0;

            try
            {
                GameObjectDeleteCommand.ValidateArguments(
                    globalObjectId,
                    mutationId,
                    expectedStateEpoch,
                    expectedStateRevision);
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
                    () => GameObjectDeleteCommand.Execute(
                        globalObjectId,
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgeGameObjectDeleteResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    changedTargets = Array.Empty<BridgeChangedTargetDto>(),
                    dirtyState = result.replayed ? "unchanged" : "dirty",
                    undo = new BridgeUndoDto
                    {
                        available = !result.replayed,
                        groupName = result.replayed
                            ? string.Empty
                            : "Unity AI Bridge: Delete GameObject",
                    },
                    compileState = "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(current, command.requestId, "timeout", "deadline_exceeded", exception.Message, cancellationToken);
            }
            catch (GameObjectEditCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "state_revision_mismatch", exception.Message, cancellationToken);
            }
            catch (GameObjectEditTargetUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "gameobject_target_unavailable", exception.Message, cancellationToken);
            }
            catch (GameObjectEditMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (GameObjectEditIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete", exception.Message, cancellationToken);
            }
            catch (GameObjectEditReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale", exception.Message, cancellationToken);
            }
            catch (GameObjectEditReadbackException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "native_readback_failed", exception.Message, cancellationToken);
            }
            catch (EditorMutationRollbackVerificationException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "rollback_verification_failed", exception.Message, cancellationToken);
            }
            catch (EditorMutationRollbackException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "rollback_failed", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "gameobject_delete_failed", exception.Message, cancellationToken);
            }
        }

        [Serializable]
        private sealed class GameObjectEditBridgeCommandDto
        {
            public GameObjectEditCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class GameObjectEditCommandArgumentsDto
        {
            public string globalObjectId;
            public string name;
            public bool activeSelf;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeGameObjectUpdateResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public GameObjectUpdatePayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeGameObjectDeleteResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public GameObjectDeletePayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
