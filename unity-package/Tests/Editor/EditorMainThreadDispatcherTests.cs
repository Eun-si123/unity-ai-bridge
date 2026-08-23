using NUnit.Framework;
using UnityAiBridge.Editor.Dispatch;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class EditorMainThreadDispatcherTests
    {
        [Test]
        public void RequireDeadline_AllowsMissingDeadline()
        {
            Assert.DoesNotThrow(() =>
                EditorMainThreadDispatcher.RequireDeadline(
                    0,
                    "test.operation",
                    100));
        }

        [Test]
        public void RequireDeadline_AllowsExecutionAtDeadline()
        {
            Assert.DoesNotThrow(() =>
                EditorMainThreadDispatcher.RequireDeadline(
                    100,
                    "test.operation",
                    100));
        }

        [Test]
        public void RequireDeadline_RejectsExecutionAfterDeadline()
        {
            var exception = Assert.Throws<EditorDispatchDeadlineExceededException>(() =>
                EditorMainThreadDispatcher.RequireDeadline(
                    100,
                    "gameObject.create",
                    101));

            Assert.That(exception, Is.Not.Null);
            Assert.That(exception.Operation, Is.EqualTo("gameObject.create"));
            Assert.That(exception.DeadlineUnixMs, Is.EqualTo(100));
            Assert.That(exception.ObservedUnixMs, Is.EqualTo(101));
        }
    }
}
