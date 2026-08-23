using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class EditorStateRevisionTests
    {
        [Test]
        public void RequireCurrent_AcceptsCurrentSnapshot()
        {
            var current = EditorStateRevision.Capture();

            Assert.DoesNotThrow(() =>
                EditorStateRevision.RequireCurrent(current.epoch, current.revision));
        }

        [Test]
        public void RequireCurrent_RejectsDifferentEpoch()
        {
            var current = EditorStateRevision.Capture();
            var differentEpoch = current.epoch + "-stale";

            var exception = Assert.Throws<EditorStateStaleException>(() =>
                EditorStateRevision.RequireCurrent(differentEpoch, current.revision));

            Assert.That(exception, Is.Not.Null);
            Assert.That(exception.Current.epoch, Is.EqualTo(current.epoch));
            Assert.That(exception.Current.revision, Is.EqualTo(current.revision));
            StringAssert.Contains("State epoch mismatch", exception.Message);
        }

        [Test]
        public void RequireCurrent_RejectsDifferentRevision()
        {
            var current = EditorStateRevision.Capture();
            var staleRevision = current.revision == long.MaxValue
                ? current.revision - 1
                : current.revision + 1;

            var exception = Assert.Throws<EditorStateStaleException>(() =>
                EditorStateRevision.RequireCurrent(current.epoch, staleRevision));

            Assert.That(exception, Is.Not.Null);
            Assert.That(exception.Current.epoch, Is.EqualTo(current.epoch));
            Assert.That(exception.Current.revision, Is.EqualTo(current.revision));
            StringAssert.Contains("State revision mismatch", exception.Message);
        }

        [Test]
        public void ValidateExpectation_RequiresEpochAndRevisionTogether()
        {
            Assert.Throws<ArgumentException>(() =>
                EditorStateRevision.ValidateExpectation("epoch-only", 0));
            Assert.Throws<ArgumentException>(() =>
                EditorStateRevision.ValidateExpectation(string.Empty, 1));
        }
    }
}
