using System;
using System.IO;
using System.Text;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Tests.Editor
{
    public sealed class ScriptReplaceCommandTests
    {
        [Test]
        public void ValidateArguments_RejectsPackageScriptWrites()
        {
            var exception = Assert.Throws<ArgumentException>(() =>
                ScriptReplaceCommand.ValidateArguments(
                    "Packages/com.example/Test.cs",
                    new string('a', 32),
                    new string('b', 64),
                    "public class Test {}\n",
                    "script-replace-package"));

            StringAssert.Contains("Assets/*.cs", exception.Message);
        }

        [Test]
        public void ValidateArguments_RejectsMalformedIdentityAndOversizedContent()
        {
            Assert.Throws<ArgumentException>(() =>
                ScriptReplaceCommand.ValidateArguments(
                    "Assets/Test.cs",
                    "not-a-guid",
                    new string('b', 64),
                    "public class Test {}\n",
                    "script-replace-guid"));

            Assert.Throws<ArgumentException>(() =>
                ScriptReplaceCommand.ValidateArguments(
                    "Assets/Test.cs",
                    new string('a', 32),
                    "bad-sha",
                    "public class Test {}\n",
                    "script-replace-sha"));

            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ScriptReplaceCommand.ValidateArguments(
                    "Assets/Test.cs",
                    new string('a', 32),
                    new string('b', 64),
                    new string('x', ScriptReplaceCommand.MaximumReplacementChars + 1),
                    "script-replace-content"));
        }

        [Test]
        public void IntentFingerprint_IsStableForSameIntent_AndChangesWithReplacement()
        {
            const string path = "Assets/Test.cs";
            var guid = new string('a', 32);
            var before = new string('b', 64);

            var first = ScriptReplaceCommand.BuildIntentFingerprintForVerification(
                path,
                guid,
                before,
                "public class Test {}\n");
            var same = ScriptReplaceCommand.BuildIntentFingerprintForVerification(
                path,
                guid,
                before,
                "public class Test {}\n");
            var changed = ScriptReplaceCommand.BuildIntentFingerprintForVerification(
                path,
                guid,
                before,
                "public class Test { public int Value; }\n");

            Assert.AreEqual(first, same);
            Assert.AreNotEqual(first, changed);
        }

        [Test]
        public void AtomicReplaceHelper_ReplacesExistingFileWithExactBytes()
        {
            var directory = Path.Combine(
                Path.GetTempPath(),
                "UnityAiBridge_ScriptReplace_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "Verify.cs");

            try
            {
                File.WriteAllText(path, "before\n", new UTF8Encoding(false));
                var replacement = new UTF8Encoding(false).GetBytes("after\n");

                ScriptReplaceCommand.ReplaceFileAtomicallyForVerification(
                    path,
                    replacement,
                    "atomic-helper-test");

                CollectionAssert.AreEqual(replacement, File.ReadAllBytes(path));
                Assert.AreEqual("after\n", File.ReadAllText(path, new UTF8Encoding(false)));
            }
            finally
            {
                if (Directory.Exists(directory))
                {
                    Directory.Delete(directory, true);
                }
            }
        }
    }
}
