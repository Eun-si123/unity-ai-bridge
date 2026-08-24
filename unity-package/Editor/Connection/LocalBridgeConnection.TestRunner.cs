using System;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using UnityAiBridge.Editor.Dispatch;
using UnityAiBridge.Editor.Execution;
using UnityAiBridge.Editor.Protocol;
using UnityAiBridge.Editor.Testing;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Connection
{
    internal static partial class LocalBridgeConnection
    {
        private static async Task<bool> TryHandleTestRunnerCommandAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (string.Equals(command.operation, "test.run.editMode.start", StringComparison.Ordinal))
            {
                await HandleEditModeTestStartAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            if (string.Equals(command.operation, "test.run.get", StringComparison.Ordinal))
            {
                await HandleTestRunGetAsync(current, command, rawJson, cancellationToken);
                return true;
            }

            return false;
        }

        private static async Task HandleEditModeTestStartAsync(
            ClientWebSocket current,
            BridgeCommandDto command,
            string rawJson,
            CancellationToken cancellationToken)
        {
            if (!string.Equals(command.risk, "write", StringComparison.Ordinal))
            {
                await SendErrorAsync(
                    current,
                    command.requestId,
                    "validation",
                    "risk_mismatch",
                    "test.run.editMode.start requires risk='write' because the selected tests may mutate Editor/project state.",
                    cancellationToken);
                return;
            }

            var dto = JsonUtility.FromJson<TestRunStartBridgeCommandDto>(rawJson);
            var arguments = dto != null ? dto.arguments : null;
            var assemblyName = arguments != null ? arguments.assemblyName : null;
            var testNames = arguments != null ? arguments.testNames : null;
            var mutationId = arguments != null ? arguments.mutationId : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => TestRunnerControl.StartEditMode(assemblyName, testNames, mutationId),
                    command.deadlineUnixMs,
                    command.operation);

                var response = new BridgeTestRunResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = new[]
                    {
                        "Test execution is an operational action: selected tests may mutate scenes/assets or other Editor/project state. Unity AI Bridge does not claim Undo or automatic cleanup for arbitrary test code.",
                    },
                    dirtyState = "unknown",
                    compileState = EditorApplication.isCompiling ? "compiling" : "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (EditorDispatchDeadlineExceededException exception)
            {
                await SendErrorAsync(current, command.requestId, "timeout", "deadline_exceeded", exception.Message, cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (TestRunCompilingException exception)
            {
                await SendErrorAsync(current, command.requestId, "compile_reload", "editor_compiling", exception.Message, cancellationToken);
            }
            catch (TestRunPlayModeException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "edit_mode_required", exception.Message, cancellationToken);
            }
            catch (TestRunInProgressException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_state", "test_run_in_progress", exception.Message, cancellationToken);
            }
            catch (TestRunMutationConflictException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "mutation_id_conflict", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "test_run_start_failed", exception.Message, cancellationToken);
            }
        }

        private static async Task HandleTestRunGetAsync(
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
                    "test.run.get requires risk='read'.",
                    cancellationToken);
                return;
            }

            var dto = JsonUtility.FromJson<TestRunGetBridgeCommandDto>(rawJson);
            var mutationId = dto != null && dto.arguments != null ? dto.arguments.mutationId : null;

            try
            {
                var result = await EditorMainThreadDispatcher.InvokeAsync(
                    () => TestRunnerControl.Get(mutationId));
                var response = new BridgeTestRunResultDto
                {
                    protocolVersion = BridgeProtocol.Version,
                    requestId = command.requestId,
                    ok = true,
                    result = result,
                    warnings = Array.Empty<string>(),
                    dirtyState = "unknown",
                    compileState = EditorApplication.isCompiling ? "compiling" : "idle",
                };
                await SendJsonAsync(current, JsonUtility.ToJson(response), cancellationToken);
            }
            catch (ArgumentException exception)
            {
                await SendErrorAsync(current, command.requestId, "validation", "invalid_arguments", exception.Message, cancellationToken);
            }
            catch (TestRunUnavailableException exception)
            {
                await SendErrorAsync(current, command.requestId, "stale_target", "test_run_unavailable", exception.Message, cancellationToken);
            }
            catch (Exception exception)
            {
                await SendErrorAsync(current, command.requestId, "unity_api", "test_run_read_failed", exception.Message, cancellationToken);
            }
        }

        [Serializable]
        private sealed class TestRunStartBridgeCommandDto
        {
            public TestRunStartArgumentsDto arguments;
        }

        [Serializable]
        private sealed class TestRunStartArgumentsDto
        {
            public string assemblyName;
            public string[] testNames;
            public string mutationId;
        }

        [Serializable]
        private sealed class TestRunGetBridgeCommandDto
        {
            public TestRunGetArgumentsDto arguments;
        }

        [Serializable]
        private sealed class TestRunGetArgumentsDto
        {
            public string mutationId;
        }

        [Serializable]
        private sealed class BridgeTestRunResultDto
        {
            public string protocolVersion;
            public string requestId;
            public bool ok;
            public TestRunPayload result;
            public string[] warnings;
            public string dirtyState;
            public string compileState;
        }
    }
}
