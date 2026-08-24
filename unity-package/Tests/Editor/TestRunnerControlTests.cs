using System;
using System.Linq;
using NUnit.Framework;
using UnityAiBridge.Editor.Testing;

namespace UnityAiBridge.Tests.Editor
{
    public sealed class TestRunnerControlTests
    {
        [Test]
        public void IntentFingerprint_RejectsMissingOrDllAssemblyNames()
        {
            Assert.Throws<ArgumentException>(() =>
                TestRunnerControl.BuildIntentFingerprintForVerification(
                    string.Empty,
                    Array.Empty<string>()));

            Assert.Throws<ArgumentException>(() =>
                TestRunnerControl.BuildIntentFingerprintForVerification(
                    "EunSung.UnityAiBridge.Editor.Tests.dll",
                    Array.Empty<string>()));
        }

        [Test]
        public void IntentFingerprint_RejectsOversizedTestSelection()
        {
            var tooMany = Enumerable.Range(0, TestRunnerControl.MaximumTestNames + 1)
                .Select(index => "Example.Tests.Case" + index)
                .ToArray();

            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestRunnerControl.BuildIntentFingerprintForVerification(
                    "EunSung.UnityAiBridge.Editor.Tests",
                    tooMany));

            Assert.Throws<ArgumentOutOfRangeException>(() =>
                TestRunnerControl.BuildIntentFingerprintForVerification(
                    "EunSung.UnityAiBridge.Editor.Tests",
                    new[] { new string('x', TestRunnerControl.MaximumTestNameLength + 1) }));
        }

        [Test]
        public void IntentFingerprint_NormalizesOrderAndDuplicates_AndChangesWithSelection()
        {
            const string assemblyName = "EunSung.UnityAiBridge.Editor.Tests";
            var first = TestRunnerControl.BuildIntentFingerprintForVerification(
                assemblyName,
                new[] { "Example.Tests.B", "Example.Tests.A", "Example.Tests.A" });
            var same = TestRunnerControl.BuildIntentFingerprintForVerification(
                assemblyName,
                new[] { "Example.Tests.A", "Example.Tests.B" });
            var changedName = TestRunnerControl.BuildIntentFingerprintForVerification(
                assemblyName,
                new[] { "Example.Tests.A", "Example.Tests.C" });
            var changedAssembly = TestRunnerControl.BuildIntentFingerprintForVerification(
                "Another.Editor.Tests",
                new[] { "Example.Tests.A", "Example.Tests.B" });

            Assert.AreEqual(first, same);
            Assert.AreNotEqual(first, changedName);
            Assert.AreNotEqual(first, changedAssembly);
        }

        [Test]
        public void CompletedCaseCount_UsesTerminalOutcomeTotals_NotLoadedTreeSize()
        {
            Assert.AreEqual(
                1,
                TestRunnerControl.CountCompletedTestCasesForVerification(1, 0, 0, 0));
            Assert.AreEqual(
                10,
                TestRunnerControl.CountCompletedTestCasesForVerification(6, 2, 1, 1));
            Assert.AreEqual(
                2,
                TestRunnerControl.CountCompletedTestCasesForVerification(-5, 1, 1, 0));
        }

        [Test]
        public void Get_RejectsMalformedOrUnknownMutationIdsWithoutStartingTests()
        {
            Assert.Throws<ArgumentException>(() => TestRunnerControl.Get("bad mutation id"));

            const string mutationId = "test-run-missing-verification";
            TestRunnerControl.ClearForVerification(mutationId);
            Assert.Throws<TestRunUnavailableException>(() => TestRunnerControl.Get(mutationId));
        }
    }
}
