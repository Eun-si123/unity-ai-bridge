using System;
using System.IO;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Protocol;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Connection
{
    [InitializeOnLoad]
    internal static class LocalBridgeConnection
    {
        private const string Endpoint = "ws://127.0.0.1:5081";
        private const int ReconnectDelayMs = 1000;
        private const int ReceiveBufferBytes = 64 * 1024;

        private static readonly CancellationTokenSource Lifetime = new CancellationTokenSource();
        private static readonly SemaphoreSlim SendGate = new SemaphoreSlim(1, 1);
        private static readonly long ConnectionGeneration = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        private static ClientWebSocket socket;
        private static string editorId;

        static LocalBridgeConnection()
        {
            AssemblyReloadEvents.beforeAssemblyReload += Shutdown;
            EditorApplication.quitting += Shutdown;
            EditorApplication.delayCall += Start;
        }

        private static async void Start()
        {
            try
            {
                var identity = await EditorMainThreadDispatcher.InvokeAsync(CreateIdentity);
                editorId = identity.editorId;
                await RunConnectionLoopAsync(identity, Lifetime.Token);
            }
            catch (OperationCanceledException)
            {
                // Expected during domain reload or Editor shutdown.
            }
            catch (Exception exception)
            {
                EditorMainThreadDispatcher.Post(() =>
                    Debug.LogWarning($"[Unity AI Bridge] Local bridge stopped: {exception.Message}"));
            }
        }

        private static async Task RunConnectionLoopAsync(EditorIdentity identity, CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                ClientWebSocket current = null;
                try
                {
                    current = new ClientWebSocket();
                    current.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                    socket = current;

                    await current.ConnectAsync(new Uri(Endpoint), cancellationToken);
                    await SendHelloAsync(current, identity, cancellationToken);
                    EditorMainThreadDispatcher.Post(() =>
                        Debug.Log($"[Unity AI Bridge] Connected to local bridge at {Endpoint}."));

                    await ReceiveLoopAsync(current, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    EditorMainThreadDispatcher.Post(() =>
                        Debug.LogWarning($"[Unity AI Bridge] Local bridge unavailable: {exception.Message}"));
                }
                finally
                {
                    if (ReferenceEquals(socket, current))
                    {
                        socket = null;
                    }
                    current?.Dispose();
                }

                try
                {
                    await Task.Delay(ReconnectDelayMs, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        private static async Task ReceiveLoopAsync(ClientWebSocket current, CancellationToken cancellationToken)
        {
            var buffer = new byte[ReceiveBufferBytes];

            while (current.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                using (var messageStream = new MemoryStream())
                {
                    WebSocketReceiveResult receiveResult;
                    do
                    {
                        receiveResult = await current.ReceiveAsync(
                            new ArraySegment<byte>(buffer),
                            cancellationToken);

                        if (receiveResult.MessageType == WebSocketMessageType.Close)
                        {
                            await CloseSocketAsync(current, cancellationToken);
                            return;
                        }

                        if (messageStream.Length + receiveResult.Count > ReceiveBufferBytes)
                        {
                            await current.CloseAsync(
                                WebSocketCloseStatus.MessageTooBig,
                                "message too large",
                                cancellationToken);
                            return;
                        }

                        messageStream.Write(buffer, 0, receiveResult.Count);
                    }
                    while (!receiveResult.EndOfMessage);

                    if (receiveResult.MessageType != WebSocketMessageType.Text)
                    {
                        continue;
                    }

                    var json = Encoding.UTF8.GetString(messageStream.ToArray());
                    await HandleCommandAsync(current, json, cancellationToken);
                }
            }
        }

        private static async Task HandleCommandAsync(
            ClientWebSocket current,
            string json,
            CancellationToken cancellationToken)
        {
            BridgeCommandDto command;
            try
            {
                command = JsonUtility.FromJson<BridgeCommandDto>(json);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    string.Empty,
                    "validation",
                    "invalid_json",
                    exception.Message,
                    cancellationToken);
                return;
            }

            if (command == null || string.IsNullOrEmpty(command.requestId))
            {
                await SendErrorAsync(
                    current,
                    command != null ? command.requestId : string.Empty,
                    "validation",
                    "invalid_command",
                    "requestId is required.",
                    cancellationToken);
                return;
            }

            if (command.protocolVersion != BridgeProtocol.Version)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unsupported",
                    "protocol_version",
                    $"Unsupported bridge protocol '{command.protocolVersion}'.",
                    cancellationToken);
                return;
            }

            if (command.route != null &&
                (!string.Equals(command.route.editorId, editorId, StringComparison.Ordinal) ||
                 command.route.connectionGeneration != ConnectionGeneration))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "routing",
                    "stale_connection",
                    "Command targets a different editor connection generation.",
                    cancellationToken);
                return;
            }

            if (command.deadlineUnixMs > 0 &&
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > command.deadlineUnixMs)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "timeout",
                    "deadline_exceeded",
                    "Command deadline elapsed before Unity execution.",
                    cancellationToken);
                return;
            }

            if (!string.Equals(command.operation, "editor.status", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unsupported",
                    "operation_not_supported",
                    $"Operation '{command.operation}' is not implemented.",
                    cancellationToken);
                return;
            }

            try
            {
                var status = await EditorMainThreadDispatcher.InvokeAsync(EditorStatusCommand.Execute);
                var response = new BridgeStatusResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = status,
                    warnings = Array.Empty<string>(),
                    dirtyState = "unchanged",
                    compileState = status.isCompiling ? "compiling" : "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "editor_status_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task SendHelloAsync(
            ClientWebSocket current,
            EditorIdentity identity,
            CancellationToken cancellationToken)
        {
            var hello = new BridgeHelloDto
            {
                type = "hello",
                protocolVersion = BridgeProtocol.Version,
                editorId = identity.editorId,
                connectionGeneration = ConnectionGeneration,
                unityVersion = identity.unityVersion,
                projectName = identity.projectName,
            };

            await SendJsonAsync(current, JsonUtility.ToJson(hello), cancellationToken);
        }

        private static async Task SendErrorAsync(
            ClientWebSocket current,
            string requestId,
            string category,
            string code,
            string message,
            CancellationToken cancellationToken)
        {
            var response = new BridgeErrorResultDto
            {
                protocolVersion = BridgeProtocol.Version,
                requestId = requestId ?? string.Empty,
                ok = false,
                warnings = Array.Empty<string>(),
                error = new BridgeErrorDto
                {
                    category = category,
                    code = code,
                    message = message,
                },
            };

            await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
        }

        private static async Task SendJsonAsync(
            ClientWebSocket current,
            string json,
            CancellationToken cancellationToken)
        {
            var payload = Encoding.UTF8.GetBytes(json);
            await SendGate.WaitAsync(cancellationToken);
            try
            {
                await current.SendAsync(
                    new ArraySegment<byte>(payload),
                    WebSocketMessageType.Text,
                    true,
                    cancellationToken);
            }
            finally
            {
                SendGate.Release();
            }
        }

        private static async Task CloseSocketAsync(
            ClientWebSocket current,
            CancellationToken cancellationToken)
        {
            if (current.State == WebSocketState.CloseReceived)
            {
                await current.CloseOutputAsync(
                    WebSocketCloseStatus.NormalClosure,
                    "closing",
                    cancellationToken);
            }
        }

        private static EditorIdentity CreateIdentity()
        {
            var projectRoot = Directory.GetParent(Application.dataPath);
            var projectName = projectRoot != null ? projectRoot.Name : string.Empty;
            var canonicalPath = projectRoot != null ? projectRoot.FullName : Application.dataPath;

            string id;
            using (var sha256 = SHA256.Create())
            {
                var digest = sha256.ComputeHash(Encoding.UTF8.GetBytes(canonicalPath));
                var builder = new StringBuilder(digest.Length * 2);
                foreach (var value in digest)
                {
                    builder.Append(value.ToString("x2"));
                }
                id = builder.ToString();
            }

            return new EditorIdentity
            {
                editorId = id,
                unityVersion = Application.unityVersion,
                projectName = projectName,
            };
        }

        private static void Shutdown()
        {
            if (!Lifetime.IsCancellationRequested)
            {
                Lifetime.Cancel();
            }

            var current = socket;
            if (current != null)
            {
                try
                {
                    current.Abort();
                }
                catch
                {
                    // Best-effort shutdown during domain reload.
                }
            }
        }

        [Serializable]
        private sealed class EditorIdentity
        {
            public string editorId;
            public string unityVersion;
            public string projectName;
        }

        [Serializable]
        private sealed class BridgeRouteDto
        {
            public string editorId;
            public long connectionGeneration;
        }

        [Serializable]
        private sealed class BridgeCommandDto
        {
            public string protocolVersion;
            public string requestId;
            public string operation;
            public string risk;
            public BridgeRouteDto route;
            public long deadlineUnixMs;
        }

        [Serializable]
        private sealed class BridgeHelloDto
        {
            public string type;
            public string protocolVersion;
            public string editorId;
            public long connectionGeneration;
            public string unityVersion;
            public string projectName;
        }

        [Serializable]
        private sealed class BridgeStatusResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public EditorStatusPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeErrorResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public string[] warnings;
            public BridgeErrorDto error;
        }

        [Serializable]
        private sealed class BridgeErrorDto
        {
            public string category;
            public string code;
            public string message;
        }
    }
}
