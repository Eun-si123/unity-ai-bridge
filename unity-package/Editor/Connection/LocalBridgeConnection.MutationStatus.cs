using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Protocol;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Connection
{
    internal static partial class LocalBridgeConnection
    {
        private static async Task<bool> TryHandleMutationStatusCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.operation, "mutation.status", StringComparison.Ordinal))
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
                    "mutation.status requires risk='read'.",
                    cancellationToken);
                return true;
            }

            var statusCommand = JsonUtility.FromJson<MutationStatusBridgeCommandDto>(rawJson);
            var mutationId = statusCommand != null && statusCommand.arguments != null
                ? statusCommand.arguments.mutationId
                : null;

            try
            {
                MutationStatusCommand.ValidateArguments(mutationId);
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
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => MutationStatusCommand.Execute(mutationId));
                var response = new BridgeMutationStatusResultDto
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
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "mutation_status_failed",
                    exception.Message,
                    cancellationToken);
            }

            return true;
        }

        [Serializable]
        private sealed class MutationStatusBridgeCommandDto
        {
            public MutationStatusCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class MutationStatusCommandArgumentsDto
        {
            public string mutationId;
        }

        [Serializable]
        private sealed class BridgeMutationStatusResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public MutationStatusPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
