using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class PrefabPropertyApplyCommandTests
    {
        private const string ComponentId =
            "GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-2044531345-0";
        private const string PrefabPath = "Assets/Prefabs/ApplyTarget.prefab";
        private const string Hash = "0123456789abcdef0123456789abcdef";

        [Test]
        public void ValidateArguments_AcceptsBoundedSinglePropertyIntent()
        {
            Assert.DoesNotThrow(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                "m_IsTrigger",
                PrefabPath,
                Hash,
                "prefab-property-apply-1",
                "epoch-1",
                7));
        }

        [Test]
        public void ValidateArguments_RejectsPackageOrNonPrefabDestination()
        {
            Assert.Throws<ArgumentException>(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                "m_IsTrigger",
                "Packages/com.example/Test.prefab",
                Hash,
                "prefab-property-apply-2",
                "epoch-1",
                7));
            Assert.Throws<ArgumentException>(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                "m_IsTrigger",
                "Assets/Prefabs/Test.asset",
                Hash,
                "prefab-property-apply-2b",
                "epoch-1",
                7));
        }

        [Test]
        public void ValidateArguments_RequiresPropertyHashAndState()
        {
            Assert.Throws<ArgumentException>(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                string.Empty,
                PrefabPath,
                Hash,
                "prefab-property-apply-3",
                "epoch-1",
                7));
            Assert.Throws<ArgumentException>(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                "m_IsTrigger",
                PrefabPath,
                string.Empty,
                "prefab-property-apply-3b",
                "epoch-1",
                7));
            Assert.Throws<ArgumentException>(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                "m_IsTrigger",
                PrefabPath,
                Hash,
                "prefab-property-apply-3c",
                string.Empty,
                0));
        }

        [Test]
        public void ValidateArguments_RejectsInvalidMutationId()
        {
            Assert.Throws<ArgumentException>(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentId,
                "m_IsTrigger",
                PrefabPath,
                Hash,
                "bad mutation id",
                "epoch-1",
                7));
        }

        [Test]
        public void IntentFingerprint_ChangesWithPropertyOrAssetHash()
        {
            var first = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentId, "m_IsTrigger", PrefabPath, "hash-a", "epoch-a", 11);
            var changedProperty = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentId, "m_Size", PrefabPath, "hash-a", "epoch-a", 11);
            var changedHash = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentId, "m_IsTrigger", PrefabPath, "hash-b", "epoch-a", 11);

            Assert.That(first, Is.Not.EqualTo(changedProperty));
            Assert.That(first, Is.Not.EqualTo(changedHash));
        }

        [Test]
        public void IntentFingerprint_ChangesWithSceneStateOrComponentIdentity()
        {
            var first = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentId, "m_IsTrigger", PrefabPath, Hash, "epoch-a", 11);
            var changedState = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentId, "m_IsTrigger", PrefabPath, Hash, "epoch-a", 12);
            var changedComponent = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                "GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-2044531346-0",
                "m_IsTrigger", PrefabPath, Hash, "epoch-a", 11);

            Assert.That(first, Is.Not.EqualTo(changedState));
            Assert.That(first, Is.Not.EqualTo(changedComponent));
        }
    }
}
