using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using UnityEditor;

namespace UnityAiBridge.Editor.Dispatch
{
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

        public static void Post(Action action)
        {
            Queue.Enqueue(action);
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
