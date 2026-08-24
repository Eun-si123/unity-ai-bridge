using System;
using System.Text;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class ScriptReadCommandTests
    {
        private const string PackageScriptPath =
            "Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs";

        [Test]
        public void ValidateProjectScriptPath_AcceptsAssetsAndPackagesScripts()
        {
            Assert.DoesNotThrow(() => ScriptReadCommand.ValidateProjectScriptPath("Assets/Scripts/Player.cs"));
            Assert.DoesNotThrow(() => ScriptReadCommand.ValidateProjectScriptPath(PackageScriptPath));
        }

        [Test]
        public void ValidateProjectScriptPath_RejectsTraversalBackslashesAndNonScripts()
        {
            Assert.Throws<ArgumentException>(() =>
                ScriptReadCommand.ValidateProjectScriptPath("Assets/../ProjectSettings/ProjectSettings.asset"));
            Assert.Throws<ArgumentException>(() =>
                ScriptReadCommand.ValidateProjectScriptPath("Assets\\Scripts\\Player.cs"));
            Assert.Throws<ArgumentException>(() =>
                ScriptReadCommand.ValidateProjectScriptPath("Assets/Scripts/Player.txt"));
            Assert.Throws<ArgumentException>(() =>
                ScriptReadCommand.ValidateProjectScriptPath("ProjectSettings/EditorBuildSettings.cs"));
        }

        [Test]
        public void Execute_ReadsPackageScriptWithStableChunkIdentity()
        {
            const int chunkSize = 37;
            var first = ScriptReadCommand.Execute(PackageScriptPath, 0, chunkSize);

            Assert.That(first.guid, Is.Not.Empty);
            Assert.That(first.path, Is.EqualTo(PackageScriptPath));
            Assert.That(first.sourceKind, Is.EqualTo("Packages"));
            Assert.That(first.packageName, Is.EqualTo("com.eunsung.unity-ai-bridge"));
            Assert.That(first.dependencyHash, Is.Not.Empty);
            Assert.That(first.contentSha256, Does.Match("^[0-9a-f]{64}$"));
            Assert.That(first.encoding, Is.EqualTo("utf-8"));
            Assert.That(first.byteLength, Is.GreaterThan(0));
            Assert.That(first.utf16CharCount, Is.GreaterThan(0));
            Assert.That(first.lineCount, Is.GreaterThan(0));
            Assert.That(first.offset, Is.Zero);
            Assert.That(first.returnedCharCount, Is.EqualTo(first.content.Length));
            Assert.That(first.nextOffset, Is.EqualTo(first.returnedCharCount));

            var reconstructed = new StringBuilder(first.utf16CharCount);
            var current = first;
            while (true)
            {
                reconstructed.Append(current.content);
                Assert.That(current.guid, Is.EqualTo(first.guid));
                Assert.That(current.path, Is.EqualTo(first.path));
                Assert.That(current.dependencyHash, Is.EqualTo(first.dependencyHash));
                Assert.That(current.contentSha256, Is.EqualTo(first.contentSha256));
                Assert.That(current.utf16CharCount, Is.EqualTo(first.utf16CharCount));
                Assert.That(current.byteLength, Is.EqualTo(first.byteLength));

                if (!current.truncated)
                {
                    break;
                }

                var next = ScriptReadCommand.Execute(PackageScriptPath, current.nextOffset, chunkSize);
                Assert.That(next.offset, Is.EqualTo(current.nextOffset));
                Assert.That(next.nextOffset, Is.GreaterThan(next.offset));
                current = next;
            }

            Assert.That(reconstructed.Length, Is.EqualTo(first.utf16CharCount));
            Assert.That(reconstructed.ToString(), Does.Contain("BridgeProtocol"));
            Assert.That(reconstructed.ToString(), Does.Contain("PackageVersion"));
        }

        [Test]
        public void Execute_RejectsOffsetPastEnd()
        {
            var full = ScriptReadCommand.Execute(
                PackageScriptPath,
                0,
                ScriptReadCommand.MaximumMaxChars);

            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ScriptReadCommand.Execute(
                    PackageScriptPath,
                    full.utf16CharCount + 1,
                    10));
        }
    }
}
