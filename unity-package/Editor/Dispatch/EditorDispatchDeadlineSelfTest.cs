using System;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Dispatch
{
    internal static class EditorDispatchDeadlineSelfTest
    {
        private const int BlockerDelayMs = 75;
        private const int DeadlineBudgetMs = 10;

        [MenuItem("Tools/Unity AI Bridge/Verify Execution Deadline Safety")]
        private static async void Run()
        {
            var guardedActionExecuted = false;
            var deadlineUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + DeadlineBudgetMs;

            var blocker = EditorMainThreadDispatcher.InvokeAsync(() =>
            {
                Thread.Sleep(BlockerDelayMs);
                return true;
            });

            var guarded = EditorMainThreadDispatcher.InvokeAsync(
                () =>
                {
                    guardedActionExecuted = true;
                    return true;
                },
                deadlineUnixMs,
                "verify.execution.deadline");

            try
            {
                await blocker;

                try
                {
                    await guarded;
                    Debug.LogError(
                        "[Unity AI Bridge] Execution deadline self-test FAILED: " +
                        "the expired queued action completed instead of being rejected.");
                    return;
                }
                catch (EditorDispatchDeadlineExceededException exception)
                {
                    if (guardedActionExecuted)
                    {
                        Debug.LogError(
                            "[Unity AI Bridge] Execution deadline self-test FAILED: " +
                            "the guarded action body ran before deadline rejection.");
                        return;
                    }

                    Debug.Log(
                        "[Unity AI Bridge] Execution deadline safety PASS: " +
                        $"expiredBeforeExecution=true, actionExecuted={guardedActionExecuted}, " +
                        $"operation={exception.Operation}, deadlineUnixMs={exception.DeadlineUnixMs}, " +
                        $"observedUnixMs={exception.ObservedUnixMs}");
                }
            }
            catch (Exception exception)
            {
                Debug.LogError(
                    "[Unity AI Bridge] Execution deadline self-test FAILED: " + exception);
            }
        }
    }
}
