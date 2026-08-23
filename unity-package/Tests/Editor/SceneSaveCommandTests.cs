using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class SceneSaveCommandTests
    {
        [Test]
        public void ValidateArgumentsRequiresExplicitSceneAndStatePrecondition()
        {
            var state = EditorStateRevision.Capture();

            Assert.DoesNotThrow(() => SceneSaveCommand.ValidateArguments(
                "Assets/Scenes/SampleScene.unity",
                "editmode-save-valid",
                state.epoch,
                state.revision));

            Assert.Throws<ArgumentException>(() => SceneSaveCommand.ValidateArguments(
                string.Empty,
                "editmode-save-valid",
                state.epoch,
                state.revision));

            Assert.Throws<ArgumentException>(() => SceneSaveCommand.ValidateArguments(
                "Assets/Scenes/SampleScene.unity",
                "editmode-save-valid",
                string.Empty,
                0));
        }

        [Test]
        public void IntentFingerprintIncludesSceneAndStateIdentity()
        {
            const string path = "Assets/Scenes/SampleScene.unity";
            const string epoch = "epoch-a";

            var first = SceneSaveCommand.BuildIntentFingerprint(path, epoch, 10);
            var same = SceneSaveCommand.BuildIntentFingerprint(path, epoch, 10);
            var otherPath = SceneSaveCommand.BuildIntentFingerprint(
                "Assets/Scenes/Other.unity",
                epoch,
                10);
            var otherRevision = SceneSaveCommand.BuildIntentFingerprint(path, epoch, 11);

            Assert.That(same, Is.EqualTo(first));
            Assert.That(otherPath, Is.Not.EqualTo(first));
            Assert.That(otherRevision, Is.Not.EqualTo(first));
        }
    }
}
