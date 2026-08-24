using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Testing;

namespace UnityAiBridge.Tests.Editor
{
    public sealed class PlayModeTestRunnerControlTests
    {
        [Test]
        public void IntentFingerprint_IsModeSpecificAndOrderStable()
        {
            const string assemblyName = "EunSung.UnityAiBridge.PlayMode.Tests";
            var playFirst = PlayModeTestRunnerControl.BuildIntentFingerprintForVerification(
                assemblyName,
                new[] { "Example.Tests.B", "Example.Tests.A", "Example.Tests.A" });
            var playSame = PlayModeTestRunnerControl.BuildIntentFingerprintForVerification(
                assemblyName,
                new[] { "Example.Tests.A", "Example.Tests.B" });
            var edit = TestRunnerControl.BuildIntentFingerprintForVerification(
                assemblyName,
                new[] { "Example.Tests.A", "Example.Tests.B" });

            Assert.AreEqual(playFirst, playSame);
            Assert.AreNotEqual(edit, playFirst);
        }

        [Test]
        public void IntentFingerprint_UsesSameBoundsAsEditModeControl()
        {
            Assert.Throws<ArgumentException>(() =>
                PlayModeTestRunnerControl.BuildIntentFingerprintForVerification(
                    string.Empty,
                    Array.Empty<string>()));
            Assert.Throws<ArgumentException>(() =>
                PlayModeTestRunnerControl.BuildIntentFingerprintForVerification(
                    "EunSung.UnityAiBridge.PlayMode.Tests.dll",
                    Array.Empty<string>()));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                PlayModeTestRunnerControl.BuildIntentFingerprintForVerification(
                    "EunSung.UnityAiBridge.PlayMode.Tests",
                    new[] { new string('x', TestRunnerControl.MaximumTestNameLength + 1) }));
        }
    }
}
