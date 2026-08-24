using NUnit.Framework;
using UnityEditor.PackageManager;
using UnityAiBridge.Editor.Testing;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class ProjectManifestTestablesTests
    {
        [Test]
        public void EnsurePackageTestable_AddsMissingTopLevelProperty()
        {
            const string input = "{\n  \"dependencies\": {\n    \"com.example.other\": \"1.0.0\"\n  }\n}\n";

            var output = ProjectManifestTestables.EnsurePackageTestable(
                input,
                PackageTestBootstrap.PackageName,
                out var changed);

            Assert.That(changed, Is.True);
            StringAssert.Contains("\"testables\"", output);
            StringAssert.Contains("\"com.eunsung.unity-ai-bridge\"", output);
            StringAssert.Contains("\"com.example.other\": \"1.0.0\"", output);
        }

        [Test]
        public void EnsurePackageTestable_AppendsWithoutRemovingExistingEntries()
        {
            const string input = "{\n  \"dependencies\": {},\n  \"testables\": [\"com.example.one\", \"com.example.two\"]\n}";

            var output = ProjectManifestTestables.EnsurePackageTestable(
                input,
                PackageTestBootstrap.PackageName,
                out var changed);

            Assert.That(changed, Is.True);
            StringAssert.Contains("\"com.example.one\"", output);
            StringAssert.Contains("\"com.example.two\"", output);
            StringAssert.Contains("\"com.eunsung.unity-ai-bridge\"", output);
        }

        [Test]
        public void EnsurePackageTestable_IsNoOpWhenAlreadyPresent()
        {
            const string input = "{\n  \"dependencies\": {},\n  \"testables\": [\n    \"com.eunsung.unity-ai-bridge\"\n  ]\n}\n";

            var output = ProjectManifestTestables.EnsurePackageTestable(
                input,
                PackageTestBootstrap.PackageName,
                out var changed);

            Assert.That(changed, Is.False);
            Assert.That(output, Is.EqualTo(input));
        }

        [Test]
        public void EnsurePackageTestable_AllowsWhitespaceAfterArrayBeforeNextProperty()
        {
            const string input = "{\n  \"testables\": [\"com.example.one\"]   ,\n  \"dependencies\": {}\n}\n";

            var output = ProjectManifestTestables.EnsurePackageTestable(
                input,
                PackageTestBootstrap.PackageName,
                out var changed);

            Assert.That(changed, Is.True);
            StringAssert.Contains("\"com.example.one\"", output);
            StringAssert.Contains("\"com.eunsung.unity-ai-bridge\"", output);
            StringAssert.Contains("   ,\n  \"dependencies\": {}", output);
        }

        [Test]
        public void EnsurePackageTestable_AllowsEmptyArrayWithTrailingNewline()
        {
            const string input = "{\n  \"dependencies\": {},\n  \"testables\": [\n  ]\n}\n";

            var output = ProjectManifestTestables.EnsurePackageTestable(
                input,
                PackageTestBootstrap.PackageName,
                out var changed);

            Assert.That(changed, Is.True);
            StringAssert.Contains("\"com.eunsung.unity-ai-bridge\"", output);
        }

        [Test]
        public void EnsurePackageTestable_RejectsNonArrayTestablesInsteadOfRewritingBlindly()
        {
            const string input = "{\n  \"dependencies\": {},\n  \"testables\": \"com.example.invalid\"\n}";

            Assert.Throws<System.FormatException>(() =>
                ProjectManifestTestables.EnsurePackageTestable(
                    input,
                    PackageTestBootstrap.PackageName,
                    out _));
        }

        [TestCase(PackageSource.Local, true)]
        [TestCase(PackageSource.LocalTarball, true)]
        [TestCase(PackageSource.Git, true)]
        [TestCase(PackageSource.Embedded, false)]
        [TestCase(PackageSource.Registry, false)]
        [TestCase(PackageSource.BuiltIn, false)]
        [TestCase(PackageSource.Unknown, false)]
        public void ShouldAutoEnable_IsLimitedToDevelopmentStyleInstallSources(
            PackageSource source,
            bool expected)
        {
            Assert.That(PackageTestBootstrap.ShouldAutoEnable(source), Is.EqualTo(expected));
        }
    }
}
