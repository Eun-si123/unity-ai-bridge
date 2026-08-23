using NUnit.Framework;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class EditorMutationTransactionTests
    {
        private const string Operation = "test.mutation.verification";
        private const string UndoGroupName = "Unity AI Bridge Test Mutation";

        private TestState state;

        [SetUp]
        public void SetUp()
        {
            state = ScriptableObject.CreateInstance<TestState>();
            state.value = 0;
        }

        [TearDown]
        public void TearDown()
        {
            if (state != null)
            {
                Object.DestroyImmediate(state);
                state = null;
            }
        }

        [Test]
        public void SuccessfulMutationReportsChangedAndVerifiedOutcome()
        {
            try
            {
                var execution = EditorMutationTransaction.ExecuteWithOutcome(
                    Operation,
                    UndoGroupName,
                    string.Empty,
                    0,
                    string.Empty,
                    string.Empty,
                    context =>
                    {
                        Undo.RecordObject(state, UndoGroupName);
                        context.MarkUndoRecorded();
                        state.value = 1;
                        return state;
                    },
                    (_, value) => value.value == 1,
                    null);

                Assert.That(execution.value, Is.SameAs(state));
                Assert.That(state.value, Is.EqualTo(1));
                Assert.That(execution.outcome, Is.Not.Null);
                Assert.That(execution.outcome.changed, Is.True);
                Assert.That(execution.outcome.verified, Is.True);
                Assert.That(execution.outcome.rolledBack, Is.False);
                Assert.That(execution.outcome.rollbackVerified, Is.False);
                Assert.That(execution.outcome.stateBefore, Is.Not.Null);
                Assert.That(execution.outcome.stateAfter, Is.Not.Null);
            }
            finally
            {
                Undo.RevertAllInCurrentGroup();
            }
        }

        [Test]
        public void VerificationFailureRollsBackAndReportsRollbackVerified()
        {
            var rollbackVerifierCalled = false;

            var exception = Assert.Throws<EditorMutationVerificationException>(() =>
                EditorMutationTransaction.ExecuteWithOutcome(
                    Operation,
                    UndoGroupName,
                    string.Empty,
                    0,
                    string.Empty,
                    string.Empty,
                    context =>
                    {
                        Undo.RecordObject(state, UndoGroupName);
                        context.MarkUndoRecorded();
                        state.value = 1;
                        return state;
                    },
                    (_, __) => false,
                    (_, value) =>
                    {
                        rollbackVerifierCalled = true;
                        return value.value == 0;
                    }));

            Assert.That(exception, Is.Not.Null);
            Assert.That(rollbackVerifierCalled, Is.True);
            Assert.That(state.value, Is.EqualTo(0));
            Assert.That(exception.Outcome, Is.Not.Null);
            Assert.That(exception.Outcome.changed, Is.True);
            Assert.That(exception.Outcome.verified, Is.False);
            Assert.That(exception.Outcome.rolledBack, Is.True);
            Assert.That(exception.Outcome.rollbackVerified, Is.True);
            Assert.That(exception.Outcome.stateAfter, Is.Not.Null);
        }

        [Test]
        public void FailedRollbackVerificationRaisesDedicatedException()
        {
            var exception = Assert.Throws<EditorMutationRollbackVerificationException>(() =>
                EditorMutationTransaction.ExecuteWithOutcome(
                    Operation,
                    UndoGroupName,
                    string.Empty,
                    0,
                    string.Empty,
                    string.Empty,
                    context =>
                    {
                        Undo.RecordObject(state, UndoGroupName);
                        context.MarkUndoRecorded();
                        state.value = 1;
                        return state;
                    },
                    (_, __) => false,
                    (_, __) => false));

            Assert.That(exception, Is.Not.Null);
            Assert.That(state.value, Is.EqualTo(0));
            Assert.That(exception.Outcome, Is.Not.Null);
            Assert.That(exception.Outcome.changed, Is.True);
            Assert.That(exception.Outcome.verified, Is.False);
            Assert.That(exception.Outcome.rolledBack, Is.True);
            Assert.That(exception.Outcome.rollbackVerified, Is.False);
            Assert.That(exception.Outcome.stateAfter, Is.Not.Null);
        }

        private sealed class TestState : ScriptableObject
        {
            public int value;
        }
    }
}
