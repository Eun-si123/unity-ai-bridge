using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class MutationStatusCommandTests
    {
        private string mutationId;

        [SetUp]
        public void SetUp()
        {
            mutationId = "mutation-status-" + Guid.NewGuid().ToString("N");
        }

        [TearDown]
        public void TearDown()
        {
            EditorMutationLifecycle.ClearForVerification(mutationId);
        }

        [Test]
        public void Execute_UnknownMutationReturnsUnknownWithoutSafeRetryClaim()
        {
            var result = MutationStatusCommand.Execute(mutationId);

            Assert.That(result.found, Is.False);
            Assert.That(result.status, Is.EqualTo("not_found"));
            Assert.That(result.terminal, Is.False);
            Assert.That(result.safeToBlindRetry, Is.False);
            Assert.That(result.intentIdentityRecorded, Is.False);
            Assert.That(result.recommendedAction, Is.EqualTo("reobserve_native_state"));
            Assert.That(result.sessionScope, Is.EqualTo("current_editor_session"));
            Assert.That(result.coverage, Is.EqualTo("editor_mutation_transaction_v1"));
        }

        [Test]
        public void Execute_StartedMutationRequiresReconciliationAndDoesNotExposeIntent()
        {
            var state = EditorStateRevision.Capture();
            EditorMutationLifecycle.Begin(
                "transform.set",
                mutationId,
                "target:secret-object|position:1,2,3",
                state);

            var result = MutationStatusCommand.Execute(mutationId);

            Assert.That(result.found, Is.True);
            Assert.That(result.operation, Is.EqualTo("transform.set"));
            Assert.That(result.status, Is.EqualTo(EditorMutationLifecycle.StartedStatus));
            Assert.That(result.terminal, Is.False);
            Assert.That(result.intentIdentityRecorded, Is.True);
            Assert.That(result.safeToBlindRetry, Is.False);
            Assert.That(
                result.recommendedAction,
                Is.EqualTo("reconcile_native_state_before_retry"));
        }

        [Test]
        public void Execute_CompletedMutationReportsTerminalSameIdDisposition()
        {
            var stateBefore = EditorStateRevision.Capture();
            var record = EditorMutationLifecycle.Begin(
                "gameObject.update",
                mutationId,
                "intent-a",
                stateBefore);
            var stateAfter = EditorStateRevision.Capture();
            EditorMutationLifecycle.MarkCompleted(record, stateAfter);

            var result = MutationStatusCommand.Execute(mutationId);

            Assert.That(result.found, Is.True);
            Assert.That(result.status, Is.EqualTo(EditorMutationLifecycle.CompletedStatus));
            Assert.That(result.terminal, Is.True);
            Assert.That(result.finishedUnixMs, Is.GreaterThan(0));
            Assert.That(result.safeToBlindRetry, Is.False);
            Assert.That(
                result.recommendedAction,
                Is.EqualTo("operation_specific_same_id_replay_or_reobserve"));
        }

        [Test]
        public void Execute_RollbackFailureRequiresManualReconciliation()
        {
            var stateBefore = EditorStateRevision.Capture();
            var record = EditorMutationLifecycle.Begin(
                "component.property.set",
                mutationId,
                "intent-a",
                stateBefore);
            var stateAfter = EditorStateRevision.Capture();
            EditorMutationLifecycle.MarkRollbackFailed(record, stateAfter);

            var result = MutationStatusCommand.Execute(mutationId);

            Assert.That(result.status, Is.EqualTo(EditorMutationLifecycle.RollbackFailedStatus));
            Assert.That(result.terminal, Is.True);
            Assert.That(result.failureKind, Is.EqualTo("rollback_failed"));
            Assert.That(result.safeToBlindRetry, Is.False);
            Assert.That(result.recommendedAction, Is.EqualTo("manual_reconciliation_required"));
        }

        [Test]
        public void ValidateArguments_RejectsUnsupportedMutationIdCharacters()
        {
            var exception = Assert.Throws<ArgumentException>(() =>
                MutationStatusCommand.ValidateArguments("bad mutation/id"));

            Assert.That(exception, Is.Not.Null);
            StringAssert.Contains("mutationId", exception.Message);
        }
    }
}
