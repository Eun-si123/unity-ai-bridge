using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class PrefabAssetCreateCommandTests
    {
        private const string SourceGlobalObjectId =
            "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-1-0";
        private const string DestinationPath = "Assets/PrefabAssetCreateTest.prefab";

        [Test]
        public void ValidateDestinationPath_AcceptsNewPrefabPathUnderAssetsRoot()
        {
            Assert.DoesNotThrow(() =>
                PrefabAssetCreateCommand.ValidateDestinationPath(DestinationPath));
        }

        [Test]
        public void ValidateDestinationPath_RejectsPackageDestination()
        {
            Assert.Throws<ArgumentException>(() =>
                PrefabAssetCreateCommand.ValidateDestinationPath(
                    "Packages/com.example/Test.prefab"));
        }

        [Test]
        public void ValidateDestinationPath_RejectsNonPrefabAndTraversal()
        {
            Assert.Throws<ArgumentException>(() =>
                PrefabAssetCreateCommand.ValidateDestinationPath("Assets/Test.asset"));
            Assert.Throws<ArgumentException>(() =>
                PrefabAssetCreateCommand.ValidateDestinationPath("Assets/../Test.prefab"));
        }

        [Test]
        public void ValidateArguments_AcceptsExplicitSourcePathAndState()
        {
            Assert.DoesNotThrow(() => PrefabAssetCreateCommand.ValidateArguments(
                SourceGlobalObjectId,
                DestinationPath,
                "prefab-create-test-1",
                "epoch-1",
                7));
        }

        [Test]
        public void ValidateArguments_RejectsInvalidMutationIdAndMissingState()
        {
            Assert.Throws<ArgumentException>(() => PrefabAssetCreateCommand.ValidateArguments(
                SourceGlobalObjectId,
                DestinationPath,
                "bad mutation id",
                "epoch-1",
                7));
            Assert.Throws<ArgumentException>(() => PrefabAssetCreateCommand.ValidateArguments(
                SourceGlobalObjectId,
                DestinationPath,
                "prefab-create-test-2",
                string.Empty,
                0));
        }

        [Test]
        public void IntentFingerprint_IncludesSourcePathAndStateIdentity()
        {
            var first = PrefabAssetCreateCommand.BuildIntentFingerprint(
                SourceGlobalObjectId,
                DestinationPath,
                "epoch-a",
                11);
            var changedSource = PrefabAssetCreateCommand.BuildIntentFingerprint(
                "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-2-0",
                DestinationPath,
                "epoch-a",
                11);
            var changedPath = PrefabAssetCreateCommand.BuildIntentFingerprint(
                SourceGlobalObjectId,
                "Assets/PrefabAssetCreateOther.prefab",
                "epoch-a",
                11);
            var changedState = PrefabAssetCreateCommand.BuildIntentFingerprint(
                SourceGlobalObjectId,
                DestinationPath,
                "epoch-a",
                12);

            Assert.That(first, Is.Not.EqualTo(changedSource));
            Assert.That(first, Is.Not.EqualTo(changedPath));
            Assert.That(first, Is.Not.EqualTo(changedState));
        }
    }
}
