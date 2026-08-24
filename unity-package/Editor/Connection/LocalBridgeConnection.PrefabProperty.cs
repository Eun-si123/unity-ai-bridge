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
        private static async Task<bool> TryHandlePrefabPropertyCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.operation, "prefab.property.apply", StringComparison.Ordinal))
            {
                return false;
            }

            if (!string.Equals(command.risk, "destructive", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "prefab.property.apply requires risk='destructive' because it persistently modifies a Prefab Asset and does not claim Unity Undo.",
                    cancellationToken);
                return true;
            }

            var bridgeCommand = JsonUtility.FromJson<PrefabPropertyApplyBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => PrefabPropertyApplyCommand.Execute(
                        arguments != null ? arguments.componentGlobalObjectId : null,
                        arguments != null ? arguments.propertyPath : null,
                        arguments != null ? arguments.prefabPath : null,
                        arguments != null ? arguments.expectedPrefabDependencyHash : null,
                        arguments != null ? arguments.mutationId : null,
                        arguments != null ? arguments.expectedStateEpoch : null,
                        arguments != null ? arguments.expectedStateRevision : 0),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgePrefabPropertyApplyResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = result.replayed
                        ? Array.Empty<string>()
                        : new[]
                        {
                            "Prefab property apply is a persistent asset write and is not covered by Unity Undo. The first bounded slice applies one existing non-array serialized property override to an explicitly selected Prefab Asset.",
                        },
                    changedTargets = Array.Empty<BridgeChangedTargetDto>(),
                    dirtyState = "unknown",
                    undo = new BridgeUndoDto
                    {
                        available = false,
                        groupName = string.Empty,
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
            catch (PrefabPropertyApplyCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyPlayModeException exception)
            {
                await SendErrorAsync(current, command.requestId, "policy", "play_mode_blocked", exception.Message, cancellationToken);
            }
            catch (EditorStateStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "state_revision_mismatch", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyAssetChangedException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "prefab_asset_changed", exception.Message, cancellationToken);
            }
            catch (PrefabUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "prefab_unavailable", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "prefab_property_unavailable", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyUnsupportedException exception)
            {
                await SendErrorAsync(current, command.requestId, "policy", "prefab_property_unsupported", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "mutation_outcome_incomplete", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyReplayStaleException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "mutation_replay_stale", exception.Message, cancellationToken);
            }
            catch (PrefabPropertyApplyVerificationException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "prefab_property_verification_failed", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "prefab_property_apply_failed", exception.Message, cancellationToken);
            }

            return true;
        }

        [Serializable]
        private sealed class PrefabPropertyApplyBridgeCommandDto
        {
            public PrefabPropertyApplyCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class PrefabPropertyApplyCommandArgumentsDto
        {
            public string componentGlobalObjectId;
            public string propertyPath;
            public string prefabPath;
            public string expectedPrefabDependencyHash;
            public string mutationId;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgePrefabPropertyApplyResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public PrefabPropertyApplyPayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }
    }
}
