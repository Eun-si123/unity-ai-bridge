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
        private static async Task<bool> TryHandleScriptCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.operation, "script.read", StringComparison.Ordinal))
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
                    "script.read requires risk='read'.",
                    cancellationToken);
                return true;
            }

            var bridgeCommand = JsonUtility.FromJson<ScriptReadBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            var path = arguments != null ? arguments.path : null;
            var offset = arguments != null ? arguments.offset : 0;
            var maxChars = arguments != null && arguments.maxChars > 0
                ? arguments.maxChars
                : ScriptReadCommand.DefaultMaxChars;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => ScriptReadCommand.Execute(path, offset, maxChars));

                var response = new BridgeScriptReadResultDto
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
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_arguments",
                    exception.Message,
                    cancellationToken);
            }
            catch (ScriptUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "script_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (ScriptEncodingUnsupportedException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unsupported",
                    "script_encoding",
                    exception.Message,
                    cancellationToken);
            }
            catch (ScriptReadLimitException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unsupported",
                    "script_too_large",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "script_read_failed",
                    exception.Message,
                    cancellationToken);
            }

            return true;
        }

        [Serializable]
        private sealed class ScriptReadBridgeCommandDto
        {
            public ScriptReadCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class ScriptReadCommandArgumentsDto
        {
            public string path;
            public int offset;
            public int maxChars;
        }

        [Serializable]
        private sealed class BridgeScriptReadResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ScriptReadPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
