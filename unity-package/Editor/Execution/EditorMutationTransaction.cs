using System;
using UnityEditor;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Execution
{
    internal sealed class EditorMutationPreflightException : InvalidOperationException
    {
        public EditorMutationPreflightException(string message)
            : base(message)
        {
        }
    }

    internal sealed class EditorMutationBusyException : InvalidOperationException
    {
        public EditorMutationBusyException(string message)
            : base(message)
        {
        }
    }

    internal sealed class EditorMutationVerificationException : InvalidOperationException
    {
        public EditorMutationVerificationException(string message)
            : base(message)
        {
        }
    }

    internal sealed class EditorMutationRollbackException : InvalidOperationException
    {
        public EditorMutationRollbackException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }

    internal sealed class EditorMutationContext
    {
        public string operation;
        public string undoGroupName;
        public int undoGroup;
        public Scene activeScene;
        public bool undoRecorded;

        public void MarkUndoRecorded()
        {
            undoRecorded = true;
        }
    }

    internal static class EditorMutationTransaction
    {
        private static bool isExecuting;

        public static T Execute<T>(
            string operation,
            string undoGroupName,
            Func<EditorMutationContext, T> mutate,
            Func<EditorMutationContext, T, bool> verify)
        {
            if (string.IsNullOrWhiteSpace(operation))
            {
                throw new ArgumentException("operation is required.", nameof(operation));
            }

            if (string.IsNullOrWhiteSpace(undoGroupName))
            {
                throw new ArgumentException("undoGroupName is required.", nameof(undoGroupName));
            }

            if (mutate == null)
            {
                throw new ArgumentNullException(nameof(mutate));
            }

            if (verify == null)
            {
                throw new ArgumentNullException(nameof(verify));
            }

            if (isExecuting)
            {
                throw new EditorMutationBusyException(
                    $"Another Unity AI Bridge mutation is already executing; '{operation}' was not started.");
            }

            var context = RunPreflight(operation, undoGroupName);

            Undo.IncrementCurrentGroup();
            context.undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName(undoGroupName);

            isExecuting = true;
            try
            {
                var result = mutate(context);
                if (!verify(context, result))
                {
                    throw new EditorMutationVerificationException(
                        $"{operation} changed Unity state, but native verification did not confirm the requested result.");
                }

                Undo.CollapseUndoOperations(context.undoGroup);
                return result;
            }
            catch (Exception primaryException)
            {
                if (context.undoRecorded)
                {
                    try
                    {
                        Undo.RevertAllInCurrentGroup();
                    }
                    catch (Exception rollbackException)
                    {
                        throw new EditorMutationRollbackException(
                            $"{operation} failed and its Undo transaction could not be reverted cleanly.",
                            new AggregateException(primaryException, rollbackException));
                    }
                }

                throw;
            }
            finally
            {
                isExecuting = false;
            }
        }

        private static EditorMutationContext RunPreflight(string operation, string undoGroupName)
        {
            if (EditorApplication.isCompiling)
            {
                throw new EditorMutationPreflightException(
                    $"Unity is compiling; {operation} was not executed.");
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new EditorMutationPreflightException(
                    $"The active Unity scene is not valid and loaded; {operation} was not executed.");
            }

            return new EditorMutationContext
            {
                operation = operation,
                undoGroupName = undoGroupName,
                undoGroup = -1,
                activeScene = scene,
                undoRecorded = false,
            };
        }
    }
}
