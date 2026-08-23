using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class PrefabCommandTests
    {
        private const string PrefabPath =
            "Packages/com.eunsung.unity-ai-bridge/Tests/Editor/Fixtures/PrefabWorkflowFixture.prefab";

        [Test]
        public void InspectValidateArguments_AcceptsDocumentedBounds()
        {
            Assert.DoesNotThrow(() => PrefabInspectCommand.ValidateArguments(PrefabPath, 0, 1));
            Assert.DoesNotThrow(() => PrefabInspectCommand.ValidateArguments(
                PrefabPath,
                PrefabInspectCommand.MaximumMaxDepth,
                PrefabInspectCommand.MaximumMaxNodes));
        }

        [Test]
        public void InspectValidateArguments_RejectsOutOfRangeLimits()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                PrefabInspectCommand.ValidateArguments(PrefabPath, -1, 10));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                PrefabInspectCommand.ValidateArguments(PrefabPath, 1, 0));
        }

        [Test]
        public void InstantiateValidateArguments_AcceptsExplicitAssetAndScenePreconditions()
        {
            Assert.DoesNotThrow(() => PrefabInstantiateCommand.ValidateArguments(
                PrefabPath,
                "0123456789abcdef0123456789abcdef",
                "prefab-test-1",
                "epoch-1",
                7));
        }

        [Test]
        public void InstantiateValidateArguments_RequiresDependencyHashAndSceneState()
        {
            Assert.Throws<ArgumentException>(() => PrefabInstantiateCommand.ValidateArguments(
                PrefabPath,
                string.Empty,
                "prefab-test-2",
                "epoch-1",
                7));
            Assert.Throws<ArgumentException>(() => PrefabInstantiateCommand.ValidateArguments(
                PrefabPath,
                "0123456789abcdef0123456789abcdef",
                "prefab-test-2",
                string.Empty,
                0));
        }

        [Test]
        public void InstantiateValidateArguments_RejectsInvalidMutationId()
        {
            Assert.Throws<ArgumentException>(() => PrefabInstantiateCommand.ValidateArguments(
                PrefabPath,
                "0123456789abcdef0123456789abcdef",
                "bad mutation id",
                "epoch-1",
                7));
        }

        [Test]
        public void InstantiateIntentFingerprint_IncludesPrefabHashAndStateIdentity()
        {
            var first = PrefabInstantiateCommand.BuildIntentFingerprint(
                PrefabPath,
                "hash-a",
                "epoch-a",
                11);
            var changedHash = PrefabInstantiateCommand.BuildIntentFingerprint(
                PrefabPath,
                "hash-b",
                "epoch-a",
                11);
            var changedState = PrefabInstantiateCommand.BuildIntentFingerprint(
                PrefabPath,
                "hash-a",
                "epoch-a",
                12);

            Assert.That(first, Is.Not.EqualTo(changedHash));
            Assert.That(first, Is.Not.EqualTo(changedState));
        }
    }
}
