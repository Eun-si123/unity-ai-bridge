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
        private static async Task<bool> TryHandlePrefabCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "prefab.inspect", StringComparison.Ordinal))
            {
                await HandlePrefabInspectAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "prefab.instantiate", StringComparison.Ordinal))
            {
                await HandlePrefabInstantiateAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandlePrefabInspectAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "read", StringComparison.Ordinal))
            {
                await SendErrorAsync(current, command.requestId, "validation", "risk_mismatch",
                    "prefab.inspect requires risk='read'.", cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<PrefabInspectBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(() =>
                    PrefabInspectCommand.Execute(
                        arguments != null ? arguments.path : null,
                        arguments != null ? arguments.maxDepth : PrefabInspectCommand.DefaultMaxDepth,
                        arguments != null ? arguments.maxNodes : PrefabInspectCommand.DefaultMaxNodes));
                var response = new BridgePrefabInspectResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    dirtyState = "unchanged",
                    compileState = "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments",
                    exception.Message, cancellationToken);
            }
            catch (PrefabUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "prefab_unavailable",
                    exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "prefab_inspect_failed",
                    exception.Message, cancellationToken);
            }
        }

        private static async Task HandlePrefabInstantiateAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "write", StringComparison.Ordinal))
            {
                await SendErrorAsync(current, command.requestId, "validation", "risk_mismatch",
                    "prefab.instantiate requires risk='write'.", cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<PrefabInstantiateBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => PrefabInstantiateCommand.Execute(
                        arguments != null ? arguments.prefabPath : null,
                        arguments != null ? arguments.expectedPrefabDependencyHash : null,
                        arguments != null ? arguments.mutationId : null,
                        arguments != null ? arguments.expectedStateEpoch : null,
                        arguments != null ? arguments.expectedStateRevision : 0),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgePrefabInstantiateResultDto
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
                                globalObjectId = result.globalObjectId,
                                instanceId = result.instanceId,
                                name = result.name,
                            },
                        },
                    dirtyState = result.replayed ? "unchanged" : "dirty",
                    undo = new BridgeUndoDto
                    {
                        available = !result.replayed,
                        groupName = !result.replayed ? "Unity AI Bridge: Instantiate Prefab" : string.Empty,
                    },
                    compileState = "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments",
                    exception.Message, cancellationToken);
            }
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(current, command.requestId, "timeout", "deadline_exceeded",
                    exception.Message, cancellationToken);
            }
            catch (PrefabUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "prefab_unavailable",
                    exception.Message, cancellationToken);
            }
            catch (PrefabAssetChangedException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "prefab_asset_changed",
                    exception.Message, cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "state_revision_mismatch",
                    exception.Message, cancellationToken);
            }
            catch (EditorMutationPreflightException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    exception.Failure == EditorMutationPreflightFailure.Compiling ? "compile_reload" : "stale_state",
                    exception.Failure == EditorMutationPreflightFailure.Compiling ? "editor_compiling" : "active_scene_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (PrefabMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict",
                    exception.Message, cancellationToken);
            }
            catch (PrefabMutationIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete",
                    exception.Message, cancellationToken);
            }
            catch (PrefabReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale",
                    exception.Message, cancellationToken);
            }
            catch (PrefabReadbackException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "prefab_readback_failed",
                    exception.Message, cancellationToken);
            }
            catch (EditorMutationRollbackVerificationException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "rollback_verification_failed",
                    exception.Message, cancellationToken);
            }
            catch (EditorMutationRollbackException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "rollback_failed",
                    exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "prefab_instantiate_failed",
                    exception.Message, cancellationToken);
            }
        }

        [Serializable]
        private sealed class PrefabInspectBridgeCommandDto
        {
            public PrefabInspectCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class PrefabInspectCommandArgumentsDto
        {
            public string path;
            public int maxDepth = PrefabInspectCommand.DefaultMaxDepth;
            public int maxNodes = PrefabInspectCommand.DefaultMaxNodes;
        }

        [Serializable]
        private sealed class PrefabInstantiateBridgeCommandDto
        {
            public PrefabInstantiateCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class PrefabInstantiateCommandArgumentsDto
        {
            public string prefabPath;
            public string expectedPrefabDependencyHash;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgePrefabInspectResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public PrefabInspectPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgePrefabInstantiateResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public PrefabInstantiatePayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
