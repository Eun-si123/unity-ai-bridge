using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class AssetCommandTests
    {
        [Test]
        public void SearchValidateArguments_AcceptsAssetsFolderAndBounds()
        {
            Assert.DoesNotThrow(() =>
                AssetSearchCommand.ValidateArguments(
                    "t:Scene",
                    new[] { "Assets" },
                    AssetSearchCommand.MaximumMaxResults));
        }

        [Test]
        public void SearchValidateArguments_RejectsTooManyResults()
        {
            Assert.Throws<System.ArgumentOutOfRangeException>(() =>
                AssetSearchCommand.ValidateArguments(
                    "t:Scene",
                    new[] { "Assets" },
                    AssetSearchCommand.MaximumMaxResults + 1));
        }

        [Test]
        public void ProjectPathValidation_RejectsParentTraversal()
        {
            Assert.Throws<System.ArgumentException>(() =>
                AssetSearchCommand.ValidateProjectPath(
                    "Assets/../ProjectSettings/ProjectSettings.asset",
                    "path"));
        }

        [Test]
        public void ProjectPathValidation_RejectsOutsideAssetsAndPackages()
        {
            Assert.Throws<System.ArgumentException>(() =>
                AssetSearchCommand.ValidateProjectPath(
                    "ProjectSettings/ProjectSettings.asset",
                    "path"));
        }

        [Test]
        public void InspectValidateArguments_AcceptsDocumentedDependencyBounds()
        {
            Assert.DoesNotThrow(() =>
                AssetInspectCommand.ValidateArguments(
                    "Assets/Scenes/SampleScene.unity",
                    AssetInspectCommand.MaximumMaxDependencies));
        }
    }
}
