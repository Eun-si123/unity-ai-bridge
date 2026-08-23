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
        private static async Task<bool> TryHandleComponentMutationCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "component.add", StringComparison.Ordinal))
            {
                await HandleComponentAddAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "component.remove", StringComparison.Ordinal))
            {
                await HandleComponentRemoveAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandleComponentAddAsync(
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
                    "component.add requires risk='write'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<ComponentMutationBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => ComponentAddCommand.Execute(
                        arguments != null ? arguments.gameObjectGlobalObjectId : null,
                        arguments != null ? arguments.typeName : null,
                        arguments != null ? arguments.mutationId : null,
                        arguments != null ? arguments.expectedStateEpoch : null,
                        arguments != null ? arguments.expectedStateRevision : 0),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgeComponentAddResultDto
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
                                globalObjectId = result.component.globalObjectId,
                                instanceId = result.component.instanceId,
                                name = result.component.typeName,
                            },
                        },
                    dirtyState = result.replayed ? "unchanged" : "dirty",
                    undo = new BridgeUndoDto
                    {
                        available = !result.replayed,
                        groupName = result.replayed
                            ? string.Empty
                            : "Unity AI Bridge: Add Component",
                    },
                    compileState = "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (ComponentTypeUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "component_type_unavailable", exception.Message, cancellationToken);
            }
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(current, command.requestId, "timeout", "deadline_exceeded", exception.Message, cancellationToken);
            }
            catch (ComponentMutationCompilingException exception)
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
            catch (ComponentMutationTargetUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "component_target_unavailable", exception.Message, cancellationToken);
            }
            catch (ComponentMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (ComponentMutationIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete", exception.Message, cancellationToken);
            }
            catch (ComponentMutationReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale", exception.Message, cancellationToken);
            }
            catch (ComponentMutationReadbackException exception)
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
                await SendErrorAsync(current, command.requestId, "unity_api", "component_add_failed", exception.Message, cancellationToken);
            }
        }

        private static async Task HandleComponentRemoveAsync(
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
                    "component.remove requires risk='destructive'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<ComponentMutationBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => ComponentRemoveCommand.Execute(
                        arguments != null ? arguments.componentGlobalObjectId : null,
                        arguments != null ? arguments.mutationId : null,
                        arguments != null ? arguments.expectedStateEpoch : null,
                        arguments != null ? arguments.expectedStateRevision : 0),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgeComponentRemoveResultDto
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
                            : "Unity AI Bridge: Remove Component",
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
            catch (ComponentMutationCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "state_revision_mismatch", exception.Message, cancellationToken);
            }
            catch (ComponentMutationTargetUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "component_target_unavailable", exception.Message, cancellationToken);
            }
            catch (ComponentMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (ComponentMutationIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete", exception.Message, cancellationToken);
            }
            catch (ComponentMutationReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale", exception.Message, cancellationToken);
            }
            catch (ComponentMutationReadbackException exception)
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
                await SendErrorAsync(current, command.requestId, "unity_api", "component_remove_failed", exception.Message, cancellationToken);
            }
        }

        [Serializable]
        private sealed class ComponentMutationBridgeCommandDto
        {
            public ComponentMutationCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class ComponentMutationCommandArgumentsDto
        {
            public string gameObjectGlobalObjectId;
            public string componentGlobalObjectId;
            public string typeName;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeComponentAddResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ComponentAddPayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeComponentRemoveResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ComponentRemovePayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
