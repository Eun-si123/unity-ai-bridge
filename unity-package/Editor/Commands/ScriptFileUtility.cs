using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    internal sealed class ScriptFileSnapshot
    {
        public string guid;
        public string path;
        public string sourceKind;
        public string packageName;
        public string dependencyHash;
        public string absolutePath;
        public byte[] bytes;
        public string text;
        public bool hasUtf8Bom;
        public string contentSha256;
    }

    internal static class ScriptFileUtility
    {
        public const long MaximumSourceBytes = 4L * 1024L * 1024L;

        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

        public static ScriptFileSnapshot ReadSnapshot(string path, bool allowPackages)
        {
            ScriptReadCommand.ValidateProjectScriptPath(path);
            if (!allowPackages && !path.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new ArgumentException("This Script mutation accepts only existing Assets/*.cs files.", nameof(path));
            }

            var guid = AssetDatabase.AssetPathToGUID(path);
            if (string.IsNullOrEmpty(guid))
            {
                throw new ScriptUnavailableException(
                    "The requested script is not a registered Unity asset or no longer exists.");
            }

            var canonicalPath = AssetDatabase.GUIDToAssetPath(guid);
            ScriptReadCommand.ValidateProjectScriptPath(canonicalPath);
            if (!allowPackages && !canonicalPath.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new ArgumentException("This Script mutation accepts only existing Assets/*.cs files.", nameof(path));
            }

            var monoScript = AssetDatabase.LoadAssetAtPath<MonoScript>(canonicalPath);
            if (monoScript == null)
            {
                throw new ScriptUnavailableException(
                    "The requested .cs asset is not available as a Unity MonoScript.");
            }

            var absolutePath = ResolveAbsolutePath(canonicalPath, out var sourceKind, out var packageName);
            if (!File.Exists(absolutePath))
            {
                throw new ScriptUnavailableException(
                    "Unity knows the script asset, but its source file is unavailable on disk.");
            }

            var fileInfo = new FileInfo(absolutePath);
            if (fileInfo.Length > MaximumSourceBytes)
            {
                throw new ScriptReadLimitException(
                    $"Script source exceeds the {MaximumSourceBytes}-byte safety bound. " +
                    $"Observed {fileInfo.Length} bytes for '{canonicalPath}'.");
            }

            var bytes = File.ReadAllBytes(absolutePath);
            var hasUtf8Bom = HasUtf8Bom(bytes);
            var text = DecodeStrictUtf8(bytes, hasUtf8Bom);

            return new ScriptFileSnapshot
            {
                guid = guid,
                path = canonicalPath,
                sourceKind = sourceKind,
                packageName = packageName,
                dependencyHash = AssetDatabase.GetAssetDependencyHash(canonicalPath).ToString(),
                absolutePath = absolutePath,
                bytes = bytes,
                text = text,
                hasUtf8Bom = hasUtf8Bom,
                contentSha256 = ComputeSha256(bytes),
            };
        }

        public static byte[] EncodeStrictUtf8(string text, bool includeBom)
        {
            text = text ?? string.Empty;
            byte[] body;
            try
            {
                body = StrictUtf8.GetBytes(text);
            }
            catch (EncoderFallbackException exception)
            {
                throw new ScriptEncodingUnsupportedException(
                    "Script content contains an invalid UTF-16 sequence that cannot be encoded as strict UTF-8. " +
                    exception.Message);
            }

            if (!includeBom)
            {
                return body;
            }

            var result = new byte[body.Length + 3];
            result[0] = 0xEF;
            result[1] = 0xBB;
            result[2] = 0xBF;
            Buffer.BlockCopy(body, 0, result, 3, body.Length);
            return result;
        }

        public static string ComputeSha256(byte[] bytes)
        {
            using (var sha256 = SHA256.Create())
            {
                var hash = sha256.ComputeHash(bytes ?? Array.Empty<byte>());
                var builder = new StringBuilder(hash.Length * 2);
                for (var index = 0; index < hash.Length; index++)
                {
                    builder.Append(hash[index].ToString("x2"));
                }
                return builder.ToString();
            }
        }

        public static int CountLines(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return 0;
            }

            var count = 1;
            for (var index = 0; index < text.Length; index++)
            {
                if (text[index] == '\n')
                {
                    count++;
                }
            }
            return count;
        }

        private static string DecodeStrictUtf8(byte[] bytes, bool hasUtf8Bom)
        {
            var textStart = hasUtf8Bom ? 3 : 0;
            try
            {
                return StrictUtf8.GetString(bytes, textStart, bytes.Length - textStart);
            }
            catch (DecoderFallbackException exception)
            {
                throw new ScriptEncodingUnsupportedException(
                    "Script workflows currently support UTF-8 source files only. " + exception.Message);
            }
        }

        private static bool HasUtf8Bom(byte[] bytes)
        {
            return bytes != null && bytes.Length >= 3 &&
                bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        }

        private static string ResolveAbsolutePath(
            string canonicalPath,
            out string sourceKind,
            out string packageName)
        {
            if (canonicalPath.StartsWith("Assets/", StringComparison.Ordinal))
            {
                var projectRoot = Directory.GetParent(Application.dataPath);
                if (projectRoot == null)
                {
                    throw new ScriptUnavailableException("Could not resolve the Unity project root.");
                }

                sourceKind = "Assets";
                packageName = string.Empty;
                return Path.GetFullPath(Path.Combine(
                    projectRoot.FullName,
                    canonicalPath.Replace('/', Path.DirectorySeparatorChar)));
            }

            var package = UnityEditor.PackageManager.PackageInfo.FindForAssetPath(canonicalPath);
            if (package == null || string.IsNullOrEmpty(package.name) || string.IsNullOrEmpty(package.resolvedPath))
            {
                throw new ScriptUnavailableException(
                    "Could not resolve the package containing the requested script.");
            }

            var packagePrefix = "Packages/" + package.name;
            if (!canonicalPath.StartsWith(packagePrefix + "/", StringComparison.Ordinal))
            {
                throw new ScriptUnavailableException(
                    "The requested script path does not match its resolved Unity package identity.");
            }

            sourceKind = "Packages";
            packageName = package.name;
            var relative = canonicalPath.Substring(packagePrefix.Length + 1)
                .Replace('/', Path.DirectorySeparatorChar);
            return Path.GetFullPath(Path.Combine(package.resolvedPath, relative));
        }
    }
}
