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
            if (string.Equals(command.operation, "script.read", StringComparison.Ordinal))
            {
                await HandleScriptReadAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "script.replace", StringComparison.Ordinal))
            {
                await HandleScriptReplaceAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandleScriptReadAsync(
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
                    "script.read requires risk='read'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<ScriptReadBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            var path = arguments != null ? arguments.path : null;
            var rawOffset = arguments != null ? arguments.offset : 0L;
            var rawMaxChars = arguments != null ? arguments.maxChars : 0L;

            if (rawOffset < 0 || rawOffset > int.MaxValue ||
                rawMaxChars < int.MinValue || rawMaxChars > int.MaxValue)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_arguments",
                    "script.read offset/maxChars must fit the Unity signed 32-bit integer range, and offset must be non-negative.",
                    cancellationToken);
                return;
            }

            var offset = (int)rawOffset;
            var maxChars = rawMaxChars > 0
                ? (int)rawMaxChars
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
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (ScriptUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "script_unavailable", exception.Message, cancellationToken);
            }
            catch (ScriptEncodingUnsupportedException exception)
            {
                await SendErrorAsync(current, command.requestId, "unsupported", "script_encoding", exception.Message, cancellationToken);
            }
            catch (ScriptReadLimitException exception)
            {
                await SendErrorAsync(current, command.requestId, "unsupported", "script_too_large", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "script_read_failed", exception.Message, cancellationToken);
            }
        }

        private static async Task HandleScriptReplaceAsync(
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
                    "script.replace requires risk='destructive'.",
                    cancellationToken);
                return;
            }

            var bridgeCommand = JsonUtility.FromJson<ScriptReplaceBridgeCommandDto>(rawJson);
            var arguments = bridgeCommand != null ? bridgeCommand.arguments : null;
            var path = arguments != null ? arguments.path : null;
            var expectedGuid = arguments != null ? arguments.expectedGuid : null;
            var expectedContentSha256 = arguments != null ? arguments.expectedContentSha256 : null;
            var content = arguments != null ? arguments.content : null;
            var mutationId = arguments != null ? arguments.mutationId : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => ScriptReplaceCommand.Execute(
                        path,
                        expectedGuid,
                        expectedContentSha256,
                        content,
                        mutationId));

                var response = new BridgeScriptReplaceResultDto
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
            catch (ScriptUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "script_unavailable", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceIdentityChangedException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "script_identity_changed", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceStaleContentException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "stale_content", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceNotEditableException exception)
            {
                await SendErrorAsync(current, command.requestId, "policy", "script_not_editable", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "already_compiling", exception.Message, cancellationToken);
            }
            catch (ScriptReplacePlayModeException exception)
            {
                await SendErrorAsync(current, command.requestId, "policy", "play_mode", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_conflict", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceIncompleteException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "mutation_incomplete", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceAtomicWriteException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "script_atomic_write_failed", exception.Message, cancellationToken);
            }
            catch (ScriptReplaceVerificationException exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "script_write_verification_failed", exception.Message, cancellationToken);
            }
            catch (ScriptEncodingUnsupportedException exception)
            {
                await SendErrorAsync(current, command.requestId, "unsupported", "script_encoding", exception.Message, cancellationToken);
            }
            catch (ScriptReadLimitException exception)
            {
                await SendErrorAsync(current, command.requestId, "unsupported", "script_too_large", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "script_replace_failed", exception.Message, cancellationToken);
            }
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
            public long offset;
            public long maxChars;
        }

        [Serializable]
        private sealed class ScriptReplaceBridgeCommandDto
        {
            public ScriptReplaceCommandArgumentsDto arguments;
        }

        [Serializable]
        private sealed class ScriptReplaceCommandArgumentsDto
        {
            public string path;
            public string expectedGuid;
            public string expectedContentSha256;
            public string content;
            public string mutationId;
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

        [Serializable]
        private sealed class BridgeScriptReplaceResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ScriptReplacePayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
