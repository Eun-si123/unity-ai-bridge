using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using UnityEditor;

namespace UnityAiBridge.Editor.Dispatch
{
    internal sealed class EditorDispatchDeadlineExceededException : TimeoutException
    {
        public EditorDispatchDeadlineExceededException(
            string operation,
            long deadlineUnixMs,
            long observedUnixMs)
            : base(
                $"Command deadline elapsed before '{operation}' reached the Unity main-thread execution boundary. " +
                $"deadlineUnixMs={deadlineUnixMs}, observedUnixMs={observedUnixMs}.")
        {
            Operation = operation;
            DeadlineUnixMs = deadlineUnixMs;
            ObservedUnixMs = observedUnixMs;
        }

        public string Operation { get; }
        public long DeadlineUnixMs { get; }
        public long ObservedUnixMs { get; }
    }

    [InitializeOnLoad]
    internal static class EditorMainThreadDispatcher
    {
        private static readonly ConcurrentQueue<Action> Queue = new ConcurrentQueue<Action>();

        static EditorMainThreadDispatcher()
        {
            EditorApplication.update += Drain;
        }

        public static Task<T> InvokeAsync<T>(Func<T> action)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }

            var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            Queue.Enqueue(() =>
            {
                try
                {
                    completion.SetResult(action());
                }
                catch (Exception exception)
                {
                    completion.SetException(exception);
                }
            });
            return completion.Task;
        }

        public static Task<T> InvokeAsync<T>(
            Func<T> action,
            long deadlineUnixMs,
            string operation)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }
            if (string.IsNullOrWhiteSpace(operation))
            {
                throw new ArgumentException("operation is required.", nameof(operation));
            }

            return InvokeAsync(() =>
            {
                RequireDeadlineCurrent(deadlineUnixMs, operation);
                return action();
            });
        }

        public static void Post(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }

            Queue.Enqueue(action);
        }

        internal static void RequireDeadline(
            long deadlineUnixMs,
            string operation,
            long observedUnixMs)
        {
            if (string.IsNullOrWhiteSpace(operation))
            {
                throw new ArgumentException("operation is required.", nameof(operation));
            }

            if (deadlineUnixMs <= 0)
            {
                return;
            }

            if (observedUnixMs > deadlineUnixMs)
            {
                throw new EditorDispatchDeadlineExceededException(
                    operation,
                    deadlineUnixMs,
                    observedUnixMs);
            }
        }

        private static void RequireDeadlineCurrent(long deadlineUnixMs, string operation)
        {
            RequireDeadline(
                deadlineUnixMs,
                operation,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }

        private static void Drain()
        {
            while (Queue.TryDequeue(out var action))
            {
                action();
            }
        }
    }
}
