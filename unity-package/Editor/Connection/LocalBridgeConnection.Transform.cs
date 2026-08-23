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
        private static async Task<bool> TryHandleTransformCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "transform.get", StringComparison.Ordinal))
            {
                await HandleTransformGetAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "transform.set", StringComparison.Ordinal))
            {
                await HandleTransformSetAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (await TryHandleGameObjectEditCommandAsync(current, command, rawJson, cancellationToken))
            {
                return true;
            }

            return false;
        }

        private static async Task HandleTransformGetAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            var transformCommand = JsonUtility.FromJson<TransformBridgeCommandDto>(rawJson);
            var globalObjectId = transformCommand != null && transformCommand.arguments != null
                ? transformCommand.arguments.globalObjectId
                : null;

            try
            {
                ObjectResolverCommand.ValidateArguments(globalObjectId);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_global_object_id",
                    exception.Message,
                    cancellationToken);
                return;
            }

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => TransformGetCommand.Execute(globalObjectId));
                var response = new BridgeTransformGetResultDto
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
            catch (TransformTargetUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "transform_target_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "transform_read_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleTransformSetAsync(
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
                    "transform.set requires risk='write'.",
                    cancellationToken);
                return;
            }

            var transformCommand = JsonUtility.FromJson<TransformBridgeCommandDto>(rawJson);
            var arguments = transformCommand != null ? transformCommand.arguments : null;
            var globalObjectId = arguments != null ? arguments.globalObjectId : null;
            var localPosition = arguments != null ? arguments.localPosition : null;
            var localEulerAngles = arguments != null ? arguments.localEulerAngles : null;
            var localScale = arguments != null ? arguments.localScale : null;
            var mutationId = arguments != null ? arguments.mutationId : null;
            var expectedStateEpoch = arguments != null ? arguments.expectedStateEpoch : null;
            var expectedStateRevision = arguments != null ? arguments.expectedStateRevision : 0;

            try
            {
                TransformSetCommand.ValidateArguments(
                    globalObjectId,
                    localPosition,
                    localEulerAngles,
                    localScale,
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
                    () => TransformSetCommand.Execute(
                        globalObjectId,
                        localPosition,
                        localEulerAngles,
                        localScale,
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);
                var response = new BridgeTransformSetResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    changedTargets = result.replayed
                        ? Array.Empty<BridgeChangedTargetDto>()
                        : new[]
                        {
                            new BridgeChangedTargetDto
                            {
                                globalObjectId = result.transform.globalObjectId,
                                instanceId = result.transform.instanceId,
                                name = result.transform.name,
                            },
                        },
                    dirtyState = result.replayed ? "unchanged" : "dirty",
                    undo = new BridgeUndoDto
                    {
                        available = !result.replayed,
                        groupName = result.replayed
                            ? string.Empty
                            : "Unity AI Bridge: Set Transform",
                    },
                    compileState = "idle",
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
            catch (TransformCompilingException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "compile_reload",
                    "editor_compiling",
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
            catch (TransformTargetUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "transform_target_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (TransformMutationConflictException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "mutation_id_conflict",
                    exception.Message,
                    cancellationToken);
            }
            catch (TransformIncompleteException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "mutation_outcome_incomplete",
                    exception.Message,
                    cancellationToken);
            }
            catch (TransformReplayStaleException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "mutation_replay_stale",
                    exception.Message,
                    cancellationToken);
            }
            catch (TransformReadbackException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "native_readback_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (EditorMutationRollbackVerificationException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "rollback_verification_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (EditorMutationRollbackException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "rollback_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "transform_set_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        [Serializable]
        private sealed class TransformBridgeCommandDto
        {
            public TransformCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class TransformCommandArgumentsDto
        {
            public string globalObjectId;
            public TransformVector3Payload localPosition;
            public TransformVector3Payload localEulerAngles;
            public TransformVector3Payload localScale;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeTransformGetResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public TransformSnapshotPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeTransformSetResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public TransformSetPayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
