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
        private static async Task<bool> TryHandleCheckpointCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "checkpoint.capture", StringComparison.Ordinal))
            {
                await HandleCheckpointCaptureAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "checkpoint.get", StringComparison.Ordinal))
            {
                await HandleCheckpointGetAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "checkpoint.restore", StringComparison.Ordinal))
            {
                await HandleCheckpointRestoreAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandleCheckpointCaptureAsync(
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
                    "checkpoint.capture requires risk='read' because it only observes Unity state and writes a bounded bridge-local SessionState record.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<CheckpointBridgeCommandDto>(rawJson);
            var globalObjectId = bridgeCommand != null && bridgeCommand.arguments != null
                ? bridgeCommand.arguments.globalObjectId
                : null;

            try
            {
                ObjectResolverCommand.ValidateArguments(globalObjectId);
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => CheckpointStore.Capture(globalObjectId));
                var response = new BridgeCheckpointSnapshotResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = new[]
                    {
                        "This first-slice checkpoint stores only one saved-Scene GameObject's name, activeSelf, parent identity, and local Transform in the current Editor session. It is not a Scene backup.",
                    },
                    dirtyState = "unchanged",
                    compileState = "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (CheckpointCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (CheckpointUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "checkpoint_target_unavailable", exception.Message, cancellationToken);
            }
            catch (GameObjectEditTargetUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "checkpoint_target_unavailable", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "checkpoint_capture_failed", exception.Message, cancellationToken);
            }
        }

        private static async Task HandleCheckpointGetAsync(
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
                    "checkpoint.get requires risk='read'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<CheckpointBridgeCommandDto>(rawJson);
            var checkpointId = bridgeCommand != null && bridgeCommand.arguments != null
                ? bridgeCommand.arguments.checkpointId
                : null;

            try
            {
                CheckpointStore.ValidateCheckpointId(checkpointId);
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => CheckpointStore.Get(checkpointId));
                var response = new BridgeCheckpointSnapshotResultDto
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
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (CheckpointNotFoundException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "checkpoint_not_found", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "checkpoint_get_failed", exception.Message, cancellationToken);
            }
        }

        private static async Task HandleCheckpointRestoreAsync(
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
                    "checkpoint.restore requires risk='write'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<CheckpointBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            var checkpointId = arguments != null ? arguments.checkpointId : null;
            var mutationId = arguments != null ? arguments.mutationId : null;
            var expectedStateEpoch = arguments != null ? arguments.expectedStateEpoch : null;
            var expectedStateRevision = arguments != null ? arguments.expectedStateRevision : 0;

            try
            {
                CheckpointRestoreCommand.ValidateArguments(
                    checkpointId,
                    mutationId,
                    expectedStateEpoch,
                    expectedStateRevision);
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => CheckpointRestoreCommand.Execute(
                        checkpointId,
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);
                var response = new BridgeCheckpointRestoreResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = new[]
                    {
                        "checkpoint.restore changes only the retained GameObject name/activeSelf/local Transform. It never recreates deleted objects, reparents objects, restores components, or restores persistent assets.",
                    },
                    changedTargets = result.changed && !result.replayed
                        ? new[]
                        {
                            new BridgeChangedTargetDto
                            {
                                globalObjectId = result.gameObject.globalObjectId,
                                instanceId = result.gameObject.instanceId,
                                name = result.gameObject.name,
                            },
                        }
                        : Array.Empty<BridgeChangedTargetDto>(),
                    dirtyState = result.gameObject.sceneIsDirty ? "dirty" : "clean",
                    undo = new BridgeUndoDto
                    {
                        available = result.changed && !result.replayed,
                        groupName = result.changed && !result.replayed
                            ? "Unity AI Bridge: Restore Checkpoint"
                            : string.Empty,
                    },
                    compileState = "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(current, command.requestId, "timeout", "deadline_exceeded", exception.Message, cancellationToken);
            }
            catch (CheckpointCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "state_revision_mismatch", exception.Message, cancellationToken);
            }
            catch (CheckpointNotFoundException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "checkpoint_not_found", exception.Message, cancellationToken);
            }
            catch (CheckpointUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "checkpoint_target_unavailable", exception.Message, cancellationToken);
            }
            catch (GameObjectEditTargetUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "checkpoint_target_unavailable", exception.Message, cancellationToken);
            }
            catch (CheckpointMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (CheckpointIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete", exception.Message, cancellationToken);
            }
            catch (CheckpointReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale", exception.Message, cancellationToken);
            }
            catch (CheckpointReadbackException exception)
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
                await SendErrorAsync(current, command.requestId, "unity_api", "checkpoint_restore_failed", exception.Message, cancellationToken);
            }
        }

        [Serializable]
        private sealed class CheckpointBridgeCommandDto
        {
            public CheckpointArgumentsDto arguments;
        }

        [Serializable]
        private sealed class CheckpointArgumentsDto
        {
            public string globalObjectId;
            public string checkpointId;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeCheckpointSnapshotResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public CheckpointSnapshotPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeCheckpointRestoreResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public CheckpointRestorePayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
