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
        private static async Task<bool> TryHandleAssetCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "asset.search", StringComparison.Ordinal))
            {
                await HandleAssetSearchAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "asset.inspect", StringComparison.Ordinal))
            {
                await HandleAssetInspectAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (await TryHandleScriptCommandAsync(
                    current,
                    command,
                    rawJson,
                    cancellationToken))
            {
                return true;
            }

            if (await TryHandlePrefabPropertyCommandAsync(
                    current,
                    command,
                    rawJson,
                    cancellationToken))
            {
                return true;
            }

            return await TryHandlePrefabCommandAsync(current, command, rawJson, cancellationToken);
        }

        private static async Task HandleAssetSearchAsync(
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
                    "asset.search requires risk='read'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<AssetSearchBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => AssetSearchCommand.Execute(
                        arguments != null ? arguments.filter ?? string.Empty : string.Empty,
                        arguments != null ? arguments.searchInFolders : null,
                        arguments != null ? arguments.maxResults : 0));

                var response = new BridgeAssetSearchResultDto
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
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_arguments",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "asset_search_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleAssetInspectAsync(
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
                    "asset.inspect requires risk='read'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<AssetInspectBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => AssetInspectCommand.Execute(
                        arguments != null ? arguments.path : null,
                        arguments != null ? arguments.maxDependencies : 0));

                var response = new BridgeAssetInspectResultDto
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
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_arguments",
                    exception.Message,
                    cancellationToken);
            }
            catch (AssetUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "asset_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "asset_inspect_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        [Serializable]
        private sealed class AssetSearchBridgeCommandDto
        {
            public AssetSearchCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class AssetSearchCommandArgumentsDto
        {
            public string filter;
            public string[] searchInFolders;
            public int maxResults;
        }

        [Serializable]
        private sealed class AssetInspectBridgeCommandDto
        {
            public AssetInspectCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class AssetInspectCommandArgumentsDto
        {
            public string path;
            public int maxDependencies;
        }

        [Serializable]
        private sealed class BridgeAssetSearchResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public AssetSearchPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeAssetInspectResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public AssetInspectPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
