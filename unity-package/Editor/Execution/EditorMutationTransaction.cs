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

    internal sealed class EditorMutationOutcome
    {
        public bool changed;
        public bool verified;
        public bool rolledBack;
        public bool rollbackVerified;
        public bool sceneWasDirtyBefore;
        public bool sceneIsDirtyAfter;
        public bool dirtyStateChanged;
        public bool rollbackDirtyResidue;
        public EditorStateRevisionSnapshot stateBefore;
        public EditorStateRevisionSnapshot stateAfter;
    }

    internal sealed class EditorMutationExecution<T>
    {
        public T value;
        public EditorMutationOutcome outcome;
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
        public EditorMutationVerificationException(string message, EditorMutationOutcome outcome)
            : base(message)
        {
            Outcome = outcome;
        }

        public EditorMutationOutcome Outcome { get; }
    }

    internal sealed class EditorMutationRollbackVerificationException : InvalidOperationException
    {
        public EditorMutationRollbackVerificationException(
            string message,
            Exception innerException,
            EditorMutationOutcome outcome)
            : base(message, innerException)
        {
            Outcome = outcome;
        }

        public EditorMutationOutcome Outcome { get; }
    }

    internal sealed class EditorMutationRollbackException : InvalidOperationException
    {
        public EditorMutationRollbackException(
            string message,
            Exception innerException,
            EditorMutationOutcome outcome)
            : base(message, innerException)
        {
            Outcome = outcome;
        }

        public EditorMutationOutcome Outcome { get; }
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
        public EditorMutationLifecycleRecord lifecycle;
        public EditorMutationOutcome outcome;

        public void MarkUndoRecorded()
        {
            undoRecorded = true;
            if (outcome != null)
            {
                outcome.changed = true;
            }
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
            return ExecuteWithOutcome(
                operation,
                undoGroupName,
                string.Empty,
                0,
                string.Empty,
                string.Empty,
                mutate,
                verify,
                null).value;
        }

        public static T Execute<T>(
            string operation,
            string undoGroupName,
            string expectedStateEpoch,
            long expectedStateRevision,
            Func<EditorMutationContext, T> mutate,
            Func<EditorMutationContext, T, bool> verify)
        {
            return ExecuteWithOutcome(
                operation,
                undoGroupName,
                expectedStateEpoch,
                expectedStateRevision,
                string.Empty,
                string.Empty,
                mutate,
                verify,
                null).value;
        }

        public static T Execute<T>(
            string operation,
            string undoGroupName,
            string expectedStateEpoch,
            long expectedStateRevision,
            string mutationId,
            string intentFingerprint,
            Func<EditorMutationContext, T> mutate,
            Func<EditorMutationContext, T, bool> verify)
        {
            return ExecuteWithOutcome(
                operation,
                undoGroupName,
                expectedStateEpoch,
                expectedStateRevision,
                mutationId,
                intentFingerprint,
                mutate,
                verify,
                null).value;
        }

        public static EditorMutationExecution<T> ExecuteWithOutcome<T>(
            string operation,
            string undoGroupName,
            string expectedStateEpoch,
            long expectedStateRevision,
            string mutationId,
            string intentFingerprint,
            Func<EditorMutationContext, T> mutate,
            Func<EditorMutationContext, T, bool> verify,
            Func<EditorMutationContext, T, bool> verifyRollback)
        {
            ValidateArguments(
                operation,
                undoGroupName,
                mutationId,
                intentFingerprint,
                mutate,
                verify);

            var lifecycleEnabled = !string.IsNullOrWhiteSpace(mutationId);
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

            if (lifecycleEnabled)
            {
                context.lifecycle = EditorMutationLifecycle.Begin(
                    operation,
                    mutationId,
                    intentFingerprint,
                    context.stateBefore);
            }

            Undo.IncrementCurrentGroup();
            context.undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName(undoGroupName);

            var result = default(T);
            var hasResult = false;

            isExecuting = true;
            try
            {
                result = mutate(context);
                hasResult = true;

                if (!verify(context, result))
                {
                    throw new EditorMutationVerificationException(
                        $"{operation} changed Unity state, but native verification did not confirm the requested result.",
                        context.outcome);
                }

                context.outcome.verified = true;
                Undo.CollapseUndoOperations(context.undoGroup);
                context.stateAfter = EditorStateRevision.Advance();
                context.outcome.stateAfter = context.stateAfter;
                CaptureDirtyStateAfter(context);
                EditorMutationLifecycle.MarkCompleted(context.lifecycle, context.stateAfter);

                return new EditorMutationExecution<T>
                {
                    value = result,
                    outcome = context.outcome,
                };
            }
            catch (Exception primaryException)
            {
                if (context.undoRecorded)
                {
                    try
                    {
                        Undo.RevertAllInCurrentGroup();
                        context.outcome.rolledBack = true;
                        context.stateAfter = EditorStateRevision.Advance();
                        context.outcome.stateAfter = context.stateAfter;
                        CaptureDirtyStateAfter(context);
                    }
                    catch (Exception rollbackException)
                    {
                        context.stateAfter = EditorStateRevision.Advance();
                        context.outcome.stateAfter = context.stateAfter;
                        CaptureDirtyStateAfter(context);
                        try
                        {
                            EditorMutationLifecycle.MarkRollbackFailed(context.lifecycle, context.stateAfter);
                        }
                        catch
                        {
                            // The rollback failure remains the primary safety signal.
                        }

                        throw new EditorMutationRollbackException(
                            $"{operation} failed and its Undo transaction could not be reverted cleanly.",
                            new AggregateException(primaryException, rollbackException),
                            context.outcome);
                    }

                    if (verifyRollback != null && hasResult)
                    {
                        try
                        {
                            if (!verifyRollback(context, result))
                            {
                                EditorMutationLifecycle.MarkRollbackVerificationFailed(
                                    context.lifecycle,
                                    context.stateAfter);
                                throw new EditorMutationRollbackVerificationException(
                                    $"{operation} was reverted through Unity Undo, but native rollback verification did not confirm the expected post-rollback state.",
                                    primaryException,
                                    context.outcome);
                            }

                            context.outcome.rollbackVerified = true;
                            EditorMutationLifecycle.MarkFailedRolledBack(context.lifecycle, context.stateAfter);
                        }
                        catch (EditorMutationRollbackVerificationException)
                        {
                            throw;
                        }
                        catch (Exception rollbackVerificationException)
                        {
                            try
                            {
                                EditorMutationLifecycle.MarkRollbackVerificationFailed(
                                    context.lifecycle,
                                    context.stateAfter);
                            }
                            catch
                            {
                                // The rollback verification failure remains the primary safety signal.
                            }

                            throw new EditorMutationRollbackVerificationException(
                                $"{operation} was reverted through Unity Undo, but rollback verification raised an exception.",
                                new AggregateException(primaryException, rollbackVerificationException),
                                context.outcome);
                        }
                    }
                    else
                    {
                        EditorMutationLifecycle.MarkFailedRolledBack(context.lifecycle, context.stateAfter);
                    }
                }
                else
                {
                    context.stateAfter = EditorStateRevision.Capture();
                    context.outcome.stateAfter = context.stateAfter;
                    CaptureDirtyStateAfter(context);
                    EditorMutationLifecycle.MarkFailedNoMutation(context.lifecycle, context.stateAfter);
                }

                throw;
            }
            finally
            {
                isExecuting = false;
            }
        }

        internal static void ApplyDirtyStateAfter(
            EditorMutationOutcome outcome,
            bool sceneIsDirtyAfter)
        {
            if (outcome == null)
            {
                throw new ArgumentNullException(nameof(outcome));
            }

            outcome.sceneIsDirtyAfter = sceneIsDirtyAfter;
            outcome.dirtyStateChanged =
                outcome.sceneWasDirtyBefore != outcome.sceneIsDirtyAfter;
            outcome.rollbackDirtyResidue =
                outcome.rolledBack &&
                !outcome.sceneWasDirtyBefore &&
                outcome.sceneIsDirtyAfter;
        }

        private static void ValidateArguments<T>(
            string operation,
            string undoGroupName,
            string mutationId,
            string intentFingerprint,
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

            var lifecycleEnabled = !string.IsNullOrWhiteSpace(mutationId);
            if (lifecycleEnabled != !string.IsNullOrEmpty(intentFingerprint))
            {
                throw new ArgumentException(
                    "mutationId and intentFingerprint must either both be supplied or both be omitted.");
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
            var stateBefore = EditorStateRevision.Capture();
            var sceneWasDirtyBefore = scene.isDirty;
            var outcome = new EditorMutationOutcome
            {
                changed = false,
                verified = false,
                rolledBack = false,
                rollbackVerified = false,
                sceneWasDirtyBefore = sceneWasDirtyBefore,
                sceneIsDirtyAfter = sceneWasDirtyBefore,
                dirtyStateChanged = false,
                rollbackDirtyResidue = false,
                stateBefore = stateBefore,
                stateAfter = null,
            };

            return new EditorMutationContext
            {
                operation = operation,
                undoGroupName = undoGroupName,
                undoGroup = -1,
                activeScene = scene,
                undoRecorded = false,
                stateBefore = stateBefore,
                stateAfter = null,
                lifecycle = null,
                outcome = outcome,
            };
        }

        private static void CaptureDirtyStateAfter(EditorMutationContext context)
        {
            var sceneIsDirtyAfter =
                context.activeScene.IsValid() && context.activeScene.isLoaded
                    ? context.activeScene.isDirty
                    : context.outcome.sceneWasDirtyBefore;
            ApplyDirtyStateAfter(context.outcome, sceneIsDirtyAfter);
        }
    }
}
