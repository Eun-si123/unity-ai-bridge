using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Testing;

namespace UnityAiBridge.Tests.Editor
{
    public sealed class TestDiscoveryControlTests
    {
        [Test]
        public void AssemblyName_AllowsOmittedOrExactNameAndRejectsDllOrWhitespace()
        {
            Assert.AreEqual(string.Empty, TestDiscoveryControl.NormalizeAssemblyForVerification(null));
            Assert.AreEqual(
                "EunSung.UnityAiBridge.Editor.Tests",
                TestDiscoveryControl.NormalizeAssemblyForVerification(
                    "EunSung.UnityAiBridge.Editor.Tests"));

            Assert.Throws<ArgumentException>(() =>
                TestDiscoveryControl.NormalizeAssemblyForVerification("   "));
            Assert.Throws<ArgumentException>(() =>
                TestDiscoveryControl.NormalizeAssemblyForVerification("Example.Tests.dll"));
        }

        [Test]
        public void NameContains_IsOptionalButRejectsWhitespaceOrOversizedValues()
        {
            Assert.AreEqual(string.Empty, TestDiscoveryControl.NormalizeContainsForVerification(null));
            Assert.AreEqual(
                "PlayModeVerifier",
                TestDiscoveryControl.NormalizeContainsForVerification("PlayModeVerifier"));

            Assert.Throws<ArgumentException>(() =>
                TestDiscoveryControl.NormalizeContainsForVerification("   "));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestDiscoveryControl.NormalizeContainsForVerification(
                    new string('x', TestDiscoveryControl.MaximumNameContainsLength + 1)));
        }

        [Test]
        public void Offset_UsesExplicitIntRange()
        {
            Assert.AreEqual(0, TestDiscoveryControl.ValidateOffsetForVerification(0));
            Assert.AreEqual(int.MaxValue, TestDiscoveryControl.ValidateOffsetForVerification(int.MaxValue));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestDiscoveryControl.ValidateOffsetForVerification(-1));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestDiscoveryControl.ValidateOffsetForVerification((long)int.MaxValue + 1));
        }

        [Test]
        public void MaxResults_IsBoundedToTwoHundred()
        {
            Assert.AreEqual(1, TestDiscoveryControl.ValidateMaxResultsForVerification(1));
            Assert.AreEqual(
                TestDiscoveryControl.MaximumResults,
                TestDiscoveryControl.ValidateMaxResultsForVerification(TestDiscoveryControl.MaximumResults));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestDiscoveryControl.ValidateMaxResultsForVerification(0));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestDiscoveryControl.ValidateMaxResultsForVerification(TestDiscoveryControl.MaximumResults + 1));
        }

        [Test]
        public void NextOffset_RemainsMonotonicForEmptyPagePastEnd()
        {
            Assert.AreEqual(2, TestDiscoveryControl.ComputeNextOffsetForVerification(0, 2));
            Assert.AreEqual(500, TestDiscoveryControl.ComputeNextOffsetForVerification(500, 0));
        }
    }
}
