using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Protocol;
using UnityEngine;

namespace UnityAiBridge.Editor.Connection
{
    internal static partial class LocalBridgeConnection
    {
        private static async Task<bool> TryHandleComponentInspectCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.operation, "component.inspect", StringComparison.Ordinal))
            {
                if (await TryHandleAssetCommandAsync(
                        current,
                        command,
                        rawJson,
                        cancellationToken))
                {
                    return true;
                }

                if (await TryHandleComponentPropertyCommandAsync(
                        current,
                        command,
                        rawJson,
                        cancellationToken))
                {
                    return true;
                }

                return await TryHandleComponentMutationCommandAsync(
                    current,
                    command,
                    rawJson,
                    cancellationToken);
            }

            if (!string.Equals(command.risk, "read", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "component.inspect requires risk='read'.",
                    cancellationToken);
                return true;
            }

            var inspectCommand = JsonUtility.FromJson<ComponentInspectBridgeCommandDto>(rawJson);
            var arguments = inspectCommand != null ? inspectCommand.arguments : null;
            var gameObjectGlobalObjectId = arguments != null
                ? arguments.gameObjectGlobalObjectId
                : null;
            var maxComponents = arguments != null && arguments.maxComponents > 0
                ? arguments.maxComponents
                : ComponentInspectCommand.DefaultMaxComponents;
            var maxPropertiesPerComponent =
                arguments != null && arguments.maxPropertiesPerComponent > 0
                    ? arguments.maxPropertiesPerComponent
                    : ComponentInspectCommand.DefaultMaxPropertiesPerComponent;
            var maxDepth = arguments != null && arguments.maxDepth >= 0
                ? arguments.maxDepth
                : ComponentInspectCommand.DefaultMaxDepth;

            try
            {
                ComponentInspectCommand.ValidateArguments(
                    gameObjectGlobalObjectId,
                    maxComponents,
                    maxPropertiesPerComponent,
                    maxDepth);
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
                    () => ComponentInspectCommand.Execute(
                        gameObjectGlobalObjectId,
                        maxComponents,
                        maxPropertiesPerComponent,
                        maxDepth));

                var response = new BridgeComponentInspectResultDto
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
            catch (GameObjectEditTargetUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "gameobject_target_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "component_inspect_failed",
                    exception.Message,
                    cancellationToken);
            }

            return true;
        }

        [Serializable]
        private sealed class ComponentInspectBridgeCommandDto
        {
            public ComponentInspectCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class ComponentInspectCommandArgumentsDto
        {
            public string gameObjectGlobalObjectId;
            public int maxComponents;
            public int maxPropertiesPerComponent;
            public int maxDepth = -1;
        }

        [Serializable]
        private sealed class BridgeComponentInspectResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ComponentInspectPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
