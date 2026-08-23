using System;
using UnityEditor;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Execution
{
    internal enum EditorMutationPreflightFailure
    {
        Compiling,
        ActiveSceneUnavailable,
    }

    internal sealed class EditorMutationPreflightException : InvalidOperationException
    {
        public EditorMutationPreflightException(EditorMutationPreflightFailure failure, string message)
            : base(message)
        {
            Failure = failure;
        }

        public EditorMutationPreflightFailure Failure { get; }
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
        public EditorStateRevisionSnapshot stateBefore;
        public EditorStateRevisionSnapshot stateAfter;

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
            return Execute(
                operation,
                undoGroupName,
                string.Empty,
                0,
                mutate,
                verify);
        }

        public static T Execute<T>(
            string operation,
            string undoGroupName,
            string expectedStateEpoch,
            long expectedStateRevision,
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

            var context = RunPreflight(
                operation,
                undoGroupName,
                expectedStateEpoch,
                expectedStateRevision);

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
                context.stateAfter = EditorStateRevision.Advance();
                return result;
            }
            catch (Exception primaryException)
            {
                if (context.undoRecorded)
                {
                    try
                    {
                        Undo.RevertAllInCurrentGroup();
                        context.stateAfter = EditorStateRevision.Advance();
                    }
                    catch (Exception rollbackException)
                    {
                        EditorStateRevision.Advance();
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

        private static EditorMutationContext RunPreflight(
            string operation,
            string undoGroupName,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (EditorApplication.isCompiling)
            {
                throw new EditorMutationPreflightException(
                    EditorMutationPreflightFailure.Compiling,
                    $"Unity is compiling; {operation} was not executed.");
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new EditorMutationPreflightException(
                    EditorMutationPreflightFailure.ActiveSceneUnavailable,
                    $"The active Unity scene is not valid and loaded; {operation} was not executed.");
            }

            EditorStateRevision.RequireCurrent(expectedStateEpoch, expectedStateRevision);

            return new EditorMutationContext
            {
                operation = operation,
                undoGroupName = undoGroupName,
                undoGroup = -1,
                activeScene = scene,
                undoRecorded = false,
                stateBefore = EditorStateRevision.Capture(),
                stateAfter = null,
            };
        }
    }
}
