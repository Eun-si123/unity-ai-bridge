using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class GameObjectEditCommandTests
    {
        private const string IdA = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";
        private const string IdB = "GlobalObjectId_V1-2-00000000000000000000000000000000-2-0";

        [Test]
        public void UpdateValidateArguments_RequiresStatePrecondition()
        {
            Assert.Throws<ArgumentException>(() =>
                GameObjectUpdateCommand.ValidateArguments(
                    IdA,
                    "Renamed",
                    "gameobject-update-test",
                    string.Empty,
                    0));
        }

        [Test]
        public void UpdateValidateArguments_RejectsWhitespaceName()
        {
            var state = EditorStateRevision.Capture();
            Assert.Throws<ArgumentException>(() =>
                GameObjectUpdateCommand.ValidateArguments(
                    IdA,
                    "   ",
                    "gameobject-update-test",
                    state.epoch,
                    state.revision));
        }

        [Test]
        public void UpdateIntentFingerprint_ChangesWhenActiveStateChanges()
        {
            var first = GameObjectUpdateCommand.BuildIntentFingerprint(
                IdA,
                "Renamed",
                true,
                "epoch",
                7);
            var second = GameObjectUpdateCommand.BuildIntentFingerprint(
                IdA,
                "Renamed",
                false,
                "epoch",
                7);

            Assert.That(first, Is.Not.EqualTo(second));
        }

        [Test]
        public void UpdateSnapshotMatchesRequested_RequiresNameAndActiveState()
        {
            var snapshot = new GameObjectSnapshotPayload
            {
                name = "Renamed",
                activeSelf = false,
            };

            Assert.That(
                GameObjectUpdateCommand.SnapshotMatchesRequested(snapshot, "Renamed", false),
                Is.True);
            Assert.That(
                GameObjectUpdateCommand.SnapshotMatchesRequested(snapshot, "Renamed", true),
                Is.False);
            Assert.That(
                GameObjectUpdateCommand.SnapshotMatchesRequested(snapshot, "Other", false),
                Is.False);
        }

        [Test]
        public void DeleteValidateArguments_RequiresStatePrecondition()
        {
            Assert.Throws<ArgumentException>(() =>
                GameObjectDeleteCommand.ValidateArguments(
                    IdA,
                    "gameobject-delete-test",
                    string.Empty,
                    0));
        }

        [Test]
        public void DeleteIntentFingerprint_ChangesWithTargetOrRevision()
        {
            var baseline = GameObjectDeleteCommand.BuildIntentFingerprint(IdA, "epoch", 7);
            var otherTarget = GameObjectDeleteCommand.BuildIntentFingerprint(IdB, "epoch", 7);
            var otherRevision = GameObjectDeleteCommand.BuildIntentFingerprint(IdA, "epoch", 8);

            Assert.That(baseline, Is.Not.EqualTo(otherTarget));
            Assert.That(baseline, Is.Not.EqualTo(otherRevision));
        }
    }
}
