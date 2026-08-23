using System;
using System.IO;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Execution;
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

            if (string.Equals(command.operation, "editor.status", StringComparison.Ordinal))
            {
                await HandleEditorStatusAsync(current, command, cancellationToken);
                return;
            }

            if (string.Equals(command.operation, "scene.hierarchy", StringComparison.Ordinal))
            {
                await HandleHierarchyAsync(current, command, cancellationToken);
                return;
            }

            if (string.Equals(command.operation, "editor.diagnostics", StringComparison.Ordinal))
            {
                await HandleDiagnosticsAsync(current, command, cancellationToken);
                return;
            }

            if (string.Equals(command.operation, "object.resolve", StringComparison.Ordinal))
            {
                await HandleObjectResolveAsync(current, command, cancellationToken);
                return;
            }

            if (string.Equals(command.operation, "gameObject.create", StringComparison.Ordinal))
            {
                await HandleGameObjectCreateAsync(current, command, cancellationToken);
                return;
            }

            if (string.Equals(command.operation, "scene.save", StringComparison.Ordinal))
            {
                await HandleSceneSaveAsync(current, command, cancellationToken);
                return;
            }

            await SendErrorAsync(
                current,
                command.requestId,
                "unsupported",
                "operation_not_supported",
                $"Operation '{command.operation}' is not implemented.",
                cancellationToken);
        }

        private static async Task HandleEditorStatusAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            CancellationToken cancellationToken)
        {
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

        private static async Task HandleHierarchyAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            CancellationToken cancellationToken)
        {
            var maxDepth = command.arguments != null && command.arguments.maxDepth > 0
                ? command.arguments.maxDepth
                : HierarchyCommand.DefaultMaxDepth;
            var maxNodes = command.arguments != null && command.arguments.maxNodes > 0
                ? command.arguments.maxNodes
                : HierarchyCommand.DefaultMaxNodes;

            if (maxDepth < 1 || maxDepth > HierarchyCommand.MaximumMaxDepth ||
                maxNodes < 1 || maxNodes > HierarchyCommand.MaximumMaxNodes)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "hierarchy_limits",
                    $"Hierarchy limits must satisfy maxDepth=1..{HierarchyCommand.MaximumMaxDepth} and maxNodes=1..{HierarchyCommand.MaximumMaxNodes}.",
                    cancellationToken);
                return;
            }

            try
            {
                var hierarchy = await EditorMainThreadDispatcher.InvokeAsync(
                    () => HierarchyCommand.Execute(maxDepth, maxNodes));
                var response = new BridgeHierarchyResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = hierarchy,
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
                    "hierarchy_read_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleDiagnosticsAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            CancellationToken cancellationToken)
        {
            var maxEntries = command.arguments != null && command.arguments.maxEntries > 0
                ? command.arguments.maxEntries
                : DiagnosticsCommand.DefaultMaxEntries;
            var minimumSeverity = command.arguments != null && !string.IsNullOrEmpty(command.arguments.minimumSeverity)
                ? command.arguments.minimumSeverity
                : DiagnosticsCommand.DefaultMinimumSeverity;

            try
            {
                DiagnosticsCommand.ValidateArguments(maxEntries, minimumSeverity);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "diagnostics_arguments",
                    exception.Message,
                    cancellationToken);
                return;
            }

            try
            {
                var diagnostics = await EditorMainThreadDispatcher.InvokeAsync(
                    () => DiagnosticsCommand.Execute(maxEntries, minimumSeverity));
                var response = new BridgeDiagnosticsResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = diagnostics,
                    warnings = Array.Empty<string>(),
                    dirtyState = "unchanged",
                    compileState = diagnostics.isCompiling ? "compiling" : "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "diagnostics_read_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleObjectResolveAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            CancellationToken cancellationToken)
        {
            var globalObjectId = command.arguments != null ? command.arguments.globalObjectId : null;

            try
            {
                ObjectResolverCommand.ValidateArguments(globalObjectId);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "invalid_global_object_id",
                    exception.Message,
                    cancellationToken);
                return;
            }

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => ObjectResolverCommand.Execute(globalObjectId));
                var response = new BridgeObjectResolveResultDto
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
                    "object_resolve_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleGameObjectCreateAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "write", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "gameObject.create requires risk='write'.",
                    cancellationToken);
                return;
            }

            var name = command.arguments != null ? command.arguments.name : null;
            var mutationId = command.arguments != null ? command.arguments.mutationId : null;
            var expectedStateEpoch = command.arguments != null
                ? command.arguments.expectedStateEpoch
                : null;
            var expectedStateRevision = command.arguments != null
                ? command.arguments.expectedStateRevision
                : 0;

            try
            {
                GameObjectCreateCommand.ValidateArguments(
                    name,
                    mutationId,
                    expectedStateEpoch,
                    expectedStateRevision);
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
                return;
            }

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => GameObjectCreateCommand.Execute(
                        name,
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);
                var response = new BridgeGameObjectCreateResultDto
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
                        groupName = result.replayed ? string.Empty : "Unity AI Bridge: Create GameObject",
                    },
                    compileState = "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
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
            catch (GameObjectCreateCompilingException exception)
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
            catch (GameObjectCreateMutationConflictException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "mutation_id_conflict",
                    exception.Message,
                    cancellationToken);
            }
            catch (GameObjectCreateReplayStaleException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "mutation_replay_stale",
                    exception.Message,
                    cancellationToken);
            }
            catch (GameObjectCreateReadbackException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_target",
                    "native_readback_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "gameobject_create_failed",
                    exception.Message,
                    cancellationToken);
            }
        }

        private static async Task HandleSceneSaveAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "destructive", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "scene.save requires risk='destructive' because it persists Unity state to disk and has no Undo.",
                    cancellationToken);
                return;
            }

            var expectedScenePath = command.arguments != null
                ? command.arguments.expectedScenePath
                : null;
            var mutationId = command.arguments != null ? command.arguments.mutationId : null;
            var expectedStateEpoch = command.arguments != null
                ? command.arguments.expectedStateEpoch
                : null;
            var expectedStateRevision = command.arguments != null
                ? command.arguments.expectedStateRevision
                : 0;

            try
            {
                SceneSaveCommand.ValidateArguments(
                    expectedScenePath,
                    mutationId,
                    expectedStateEpoch,
                    expectedStateRevision);
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
                return;
            }

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => SceneSaveCommand.Execute(
                        expectedScenePath,
                        mutationId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    command.deadlineUnixMs,
                    command.operation);
                var response = new BridgeSceneSaveResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    dirtyState = result.isDirty ? "dirty" : "clean",
                    undo = new BridgeUndoDto
                    {
                        available = false,
                        groupName = string.Empty,
                    },
                    compileState = "idle",
                };

                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
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
            catch (SceneSaveCompilingException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "compile_reload",
                    "editor_compiling",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSavePlayModeException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "policy",
                    "play_mode_blocked",
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
            catch (SceneSaveSceneMismatchException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "active_scene_mismatch",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSaveUnavailableException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "policy",
                    "scene_save_unavailable",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSaveMutationConflictException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "mutation_id_conflict",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSaveIncompleteException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "save_outcome_incomplete",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSaveReplayStaleException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "stale_state",
                    "save_replay_stale",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSaveVerificationException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "scene_save_verification_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (SceneSaveFailedException exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "scene_save_failed",
                    exception.Message,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "unity_api",
                    "scene_save_failed",
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
        private sealed class CommandArgumentsDto
        {
            public int maxDepth;
            public int maxNodes;
            public int maxEntries;
            public string minimumSeverity;
            public string globalObjectId;
            public string name;
            public string mutationId;
            public string expectedScenePath;
            public string expectedStateEpoch;
            public long expectedStateRevision;
        }

        [Serializable]
        private sealed class BridgeCommandDto
        {
            public string protocolVersion;
            public string requestId;
            public string operation;
            public CommandArgumentsDto arguments;
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
        private sealed class BridgeHierarchyResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public HierarchyPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeDiagnosticsResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public DiagnosticsPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeObjectResolveResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public ObjectResolvePayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeGameObjectCreateResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public GameObjectCreatePayload result;
            public string[] warnings;
            public BridgeChangedTargetDto[] changedTargets;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeSceneSaveResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public SceneSavePayload result;
            public string[] warnings;
            public string dirtyState;
            public BridgeUndoDto undo;
            public string compileState;
        }

        [Serializable]
        private sealed class BridgeChangedTargetDto
        {
            public string globalObjectId;
            public int instanceId;
            public string name;
        }

        [Serializable]
        private sealed class BridgeUndoDto
        {
            public bool available;
            public string groupName;
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
