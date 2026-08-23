using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class EditorMutationLifecycleTests
    {
        private string mutationId;

        [SetUp]
        public void SetUp()
        {
            mutationId = "editmode-" + Guid.NewGuid().ToString("N");
        }

        [TearDown]
        public void TearDown()
        {
            EditorMutationLifecycle.ClearForVerification(mutationId);
        }

        [Test]
        public void Begin_PersistsStartedRecord()
        {
            var state = EditorStateRevision.Capture();

            var record = EditorMutationLifecycle.Begin(
                "gameObject.create",
                mutationId,
                "intent-a",
                state);
            var persisted = EditorMutationLifecycle.Read(mutationId);

            Assert.That(record.status, Is.EqualTo(EditorMutationLifecycle.StartedStatus));
            Assert.That(persisted, Is.Not.Null);
            Assert.That(persisted.operation, Is.EqualTo("gameObject.create"));
            Assert.That(persisted.mutationId, Is.EqualTo(mutationId));
            Assert.That(persisted.intentFingerprint, Is.EqualTo("intent-a"));
            Assert.That(persisted.status, Is.EqualTo(EditorMutationLifecycle.StartedStatus));
            Assert.That(persisted.startedStateEpoch, Is.EqualTo(state.epoch));
            Assert.That(persisted.startedStateRevision, Is.EqualTo(state.revision));
        }

        [Test]
        public void Begin_SameStartedIntentFailsClosed()
        {
            var state = EditorStateRevision.Capture();
            EditorMutationLifecycle.Begin(
                "gameObject.create",
                mutationId,
                "intent-a",
                state);

            var exception = Assert.Throws<EditorMutationIncompleteException>(() =>
                EditorMutationLifecycle.Begin(
                    "gameObject.create",
                    mutationId,
                    "intent-a",
                    state));

            Assert.That(exception, Is.Not.Null);
            StringAssert.Contains("started but did not record a terminal outcome", exception.Message);
        }

        [Test]
        public void Begin_SameMutationIdDifferentIntentIsConflict()
        {
            var state = EditorStateRevision.Capture();
            EditorMutationLifecycle.Begin(
                "gameObject.create",
                mutationId,
                "intent-a",
                state);

            var exception = Assert.Throws<EditorMutationLifecycleConflictException>(() =>
                EditorMutationLifecycle.Begin(
                    "gameObject.create",
                    mutationId,
                    "intent-b",
                    state));

            Assert.That(exception, Is.Not.Null);
            StringAssert.Contains("different operation or mutation intent", exception.Message);
        }

        [Test]
        public void CompletedLifecycleAlsoPreventsBlindReexecutionWithoutReplayPayload()
        {
            var stateBefore = EditorStateRevision.Capture();
            var record = EditorMutationLifecycle.Begin(
                "gameObject.create",
                mutationId,
                "intent-a",
                stateBefore);
            var stateAfter = EditorStateRevision.Capture();
            EditorMutationLifecycle.MarkCompleted(record, stateAfter);

            var persisted = EditorMutationLifecycle.Read(mutationId);
            Assert.That(persisted.status, Is.EqualTo(EditorMutationLifecycle.CompletedStatus));

            var exception = Assert.Throws<EditorMutationIncompleteException>(() =>
                EditorMutationLifecycle.Begin(
                    "gameObject.create",
                    mutationId,
                    "intent-a",
                    stateAfter));

            Assert.That(exception, Is.Not.Null);
            StringAssert.Contains("terminal lifecycle status 'completed'", exception.Message);
        }
    }
}
