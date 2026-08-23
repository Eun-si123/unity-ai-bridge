using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class TransformCommandTests
    {
        [Test]
        public void ValidateArguments_RequiresStatePrecondition()
        {
            var id = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";
            var zero = Vector(0f, 0f, 0f);
            var one = Vector(1f, 1f, 1f);

            Assert.Throws<ArgumentException>(() =>
                TransformSetCommand.ValidateArguments(
                    id,
                    zero,
                    zero,
                    one,
                    "transform-test",
                    string.Empty,
                    0));
        }

        [Test]
        public void ValidateArguments_RejectsNonFiniteValuesBeforeMutation()
        {
            var id = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";
            var state = EditorStateRevision.Capture();

            Assert.Throws<ArgumentException>(() =>
                TransformSetCommand.ValidateArguments(
                    id,
                    Vector(float.NaN, 0f, 0f),
                    Vector(0f, 0f, 0f),
                    Vector(1f, 1f, 1f),
                    "transform-test",
                    state.epoch,
                    state.revision));
        }

        [Test]
        public void BuildIntentFingerprint_ChangesWhenTransformIntentChanges()
        {
            var id = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";
            var first = TransformSetCommand.BuildIntentFingerprint(
                id,
                Vector(1f, 2f, 3f),
                Vector(10f, 20f, 30f),
                Vector(1f, 1f, 1f),
                "epoch",
                7);
            var second = TransformSetCommand.BuildIntentFingerprint(
                id,
                Vector(1f, 2f, 4f),
                Vector(10f, 20f, 30f),
                Vector(1f, 1f, 1f),
                "epoch",
                7);

            Assert.That(first, Is.Not.EqualTo(second));
        }

        [Test]
        public void SnapshotMatchesRequested_TreatsEquivalentEulerRotationAsEqual()
        {
            var snapshot = new TransformSnapshotPayload
            {
                localPosition = Vector(1f, 2f, 3f),
                localRotation = new TransformQuaternionPayload
                {
                    x = 0f,
                    y = 0f,
                    z = 0f,
                    w = 1f,
                },
                localScale = Vector(1f, 2f, 3f),
            };

            Assert.That(
                TransformSetCommand.SnapshotMatchesRequested(
                    snapshot,
                    Vector(1f, 2f, 3f),
                    Vector(0f, 360f, 0f),
                    Vector(1f, 2f, 3f)),
                Is.True);
        }

        private static TransformVector3Payload Vector(float x, float y, float z)
        {
            return new TransformVector3Payload { x = x, y = y, z = z };
        }
    }
}
