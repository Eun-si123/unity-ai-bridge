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
        private static async Task<bool> TryHandleComponentPropertyCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.operation, "component.property.set", StringComparison.Ordinal))
            {
                return false;
            }

            if (!string.Equals(command.risk, "write", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "component.property.set requires risk='write'.",
                    cancellationToken);
                return true;
            }

            var bridgeCommand = JsonUtility.FromJson<ComponentPropertyBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => ComponentPropertySetCommand.Execute(
                        arguments != null ? arguments.componentGlobalObjectId : null,
                        arguments != null ? arguments.propertyPath : null,
                        arguments != null ? arguments.value : null,
                        arguments != null ? arguments.mutationId : null,
                        arguments != null ? arguments.expectedStateEpoch : null,
                        arguments != null ? arguments.expectedStateRevision : 0),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgeComponentPropertySetResultDto
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
                                globalObjectId = result.component.globalObjectId,
                                instanceId = result.component.instanceId,
                                name = result.component.typeName,
                            },
                        },
                    dirtyState = result.replayed || !result.changed ? "unchanged" : "dirty",
                    undo = new BridgeUndoDto
                    {
                        available = !result.replayed && result.changed,
                        groupName = !result.replayed && result.changed
                            ? "Unity AI Bridge: Set Component Property"
                            : string.Empty,
                    },
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
            catch (ComponentPropertyUnsupportedException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "component_property_unsupported",
                    exception.Message,
                    cancellationToken);
            }
            catch (ComponentPropertyUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "component_property_unavailable",
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
            catch (ComponentMutationCompilingException exception)
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
            catch (ComponentMutationTargetUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "component_target_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (ComponentMutationConflictException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "mutation_id_conflict",
                    exception.Message,
                    cancellationToken);
            }
            catch (ComponentMutationIncompleteException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "mutation_outcome_incomplete",
                    exception.Message,
                    cancellationToken);
            }
            catch (ComponentMutationReplayStaleException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "mutation_replay_stale",
                    exception.Message,
                    cancellationToken);
            }
            catch (ComponentMutationReadbackException exception)
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
                    "component_property_set_failed",
                    exception.Message,
                    cancellationToken);
            }

            return true;
        }

        [Serializable]
        private sealed class ComponentPropertyBridgeCommandDto
        {
            public ComponentPropertyCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class ComponentPropertyCommandArgumentsDto
        {
            public string componentGlobalObjectId;
            public string propertyPath;
            public ComponentPropertyValuePayload value;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeComponentPropertySetResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ComponentPropertySetPayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
