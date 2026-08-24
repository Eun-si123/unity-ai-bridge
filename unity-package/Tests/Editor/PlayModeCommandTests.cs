using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Tests.Editor
{
    public sealed class PlayModeCommandTests
    {
        [Test]
        public void ValidateArguments_AcceptsStableModes_AndRejectsTransitionsOrBadMutationIds()
        {
            Assert.DoesNotThrow(() =>
                PlayModeCommand.ValidateArguments("play", "edit", "play-mode-valid"));
            Assert.DoesNotThrow(() =>
                PlayModeCommand.ValidateArguments("edit", "play", "play-mode-valid-2"));

            Assert.Throws<ArgumentException>(() =>
                PlayModeCommand.ValidateArguments("entering_play", "edit", "play-mode-invalid"));
            Assert.Throws<ArgumentException>(() =>
                PlayModeCommand.ValidateArguments("play", "exiting_play", "play-mode-invalid-2"));
            Assert.Throws<ArgumentException>(() =>
                PlayModeCommand.ValidateArguments("play", "edit", "bad mutation id"));
        }

        [Test]
        public void ClassifyMode_DistinguishesStableAndTransitionStates()
        {
            Assert.AreEqual(
                "edit",
                PlayModeCommand.ClassifyModeForVerification(false, false));
            Assert.AreEqual(
                "entering_play",
                PlayModeCommand.ClassifyModeForVerification(false, true));
            Assert.AreEqual(
                "play",
                PlayModeCommand.ClassifyModeForVerification(true, true));
            Assert.AreEqual(
                "exiting_play",
                PlayModeCommand.ClassifyModeForVerification(true, false));
        }

        [Test]
        public void IntentFingerprint_IsStableForSameIntent_AndChangesWithTargetOrPrecondition()
        {
            var first = PlayModeCommand.BuildIntentFingerprintForVerification("play", "edit");
            var same = PlayModeCommand.BuildIntentFingerprintForVerification("play", "edit");
            var targetChanged = PlayModeCommand.BuildIntentFingerprintForVerification("edit", "play");
            var preconditionChanged = PlayModeCommand.BuildIntentFingerprintForVerification("play", "play");

            Assert.AreEqual(first, same);
            Assert.AreNotEqual(first, targetChanged);
            Assert.AreNotEqual(first, preconditionChanged);
        }

        [Test]
        public void Execute_NoOpEditTransition_ReplaysWithoutRequestingPlayMode()
        {
            const string mutationId = "play-mode-noop-edit-test";
            PlayModeCommand.ClearForVerification(mutationId);

            try
            {
                var before = PlayModeCommand.CaptureSnapshot();
                if (before.mode != "edit")
                {
                    Assert.Ignore($"This non-transition test requires stable Edit Mode; observed {before.mode}.");
                }

                var first = PlayModeCommand.Execute("edit", "edit", mutationId);
                Assert.IsFalse(first.changed);
                Assert.IsFalse(first.transitionRequested);
                Assert.IsFalse(first.replayed);
                Assert.AreEqual("edit", first.afterRequest.mode);

                var replay = PlayModeCommand.Execute("edit", "edit", mutationId);
                Assert.IsTrue(replay.replayed);
                Assert.IsFalse(replay.changed);
                Assert.IsFalse(replay.transitionRequested);
                Assert.AreEqual("edit", replay.afterRequest.mode);
            }
            finally
            {
                PlayModeCommand.ClearForVerification(mutationId);
            }
        }
    }
}
