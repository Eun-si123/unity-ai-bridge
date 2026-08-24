using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class ScriptReadPayload
    {
        public string guid;
        public string path;
        public string sourceKind;
        public string packageName;
        public string dependencyHash;
        public string contentSha256;
        public string encoding;
        public bool hasUtf8Bom;
        public long byteLength;
        public int utf16CharCount;
        public int lineCount;
        public int offset;
        public int maxChars;
        public int returnedCharCount;
        public int nextOffset;
        public bool truncated;
        public string content;
    }

    internal sealed class ScriptUnavailableException : InvalidOperationException
    {
        public ScriptUnavailableException(string message) : base(message) { }
    }

    internal sealed class ScriptEncodingUnsupportedException : InvalidOperationException
    {
        public ScriptEncodingUnsupportedException(string message) : base(message) { }
    }

    internal static class ScriptReadCommand
    {
        public const int DefaultMaxChars = 20000;
        public const int MaximumMaxChars = 100000;
        public const int MaximumPathLength = 512;

        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

        public static void ValidateArguments(string path, int offset, int maxChars)
        {
            ValidateProjectScriptPath(path);
            if (offset < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(offset), "offset must be zero or greater.");
            }
            if (maxChars < 1 || maxChars > MaximumMaxChars)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxChars),
                    $"maxChars must be in the range 1..{MaximumMaxChars}.");
            }
        }

        public static ScriptReadPayload Execute(string path, int offset, int maxChars)
        {
            ValidateArguments(path, offset, maxChars);

            var guid = AssetDatabase.AssetPathToGUID(path);
            if (string.IsNullOrEmpty(guid))
            {
                throw new ScriptUnavailableException(
                    "The requested script is not a registered Unity asset or no longer exists.");
            }

            var canonicalPath = AssetDatabase.GUIDToAssetPath(guid);
            ValidateProjectScriptPath(canonicalPath);

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

            var bytes = File.ReadAllBytes(absolutePath);
            var hasUtf8Bom = HasUtf8Bom(bytes);
            var textStart = hasUtf8Bom ? 3 : 0;
            string text;
            try
            {
                text = StrictUtf8.GetString(bytes, textStart, bytes.Length - textStart);
            }
            catch (DecoderFallbackException exception)
            {
                throw new ScriptEncodingUnsupportedException(
                    "script.read currently supports UTF-8 source files only. " + exception.Message);
            }

            if (offset > text.Length)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(offset),
                    $"offset {offset} exceeds the script UTF-16 length {text.Length}.");
            }
            if (offset > 0 && offset < text.Length &&
                char.IsHighSurrogate(text[offset - 1]) && char.IsLowSurrogate(text[offset]))
            {
                throw new ArgumentException(
                    "offset must not split a UTF-16 surrogate pair.",
                    nameof(offset));
            }

            var end = Math.Min(text.Length, checked(offset + Math.Min(maxChars, text.Length - offset)));
            if (end > offset && end < text.Length &&
                char.IsHighSurrogate(text[end - 1]) && char.IsLowSurrogate(text[end]))
            {
                end--;
            }

            var content = text.Substring(offset, end - offset);
            return new ScriptReadPayload
            {
                guid = guid,
                path = canonicalPath,
                sourceKind = sourceKind,
                packageName = packageName,
                dependencyHash = AssetDatabase.GetAssetDependencyHash(canonicalPath).ToString(),
                contentSha256 = ComputeSha256(bytes),
                encoding = "utf-8",
                hasUtf8Bom = hasUtf8Bom,
                byteLength = bytes.LongLength,
                utf16CharCount = text.Length,
                lineCount = CountLines(text),
                offset = offset,
                maxChars = maxChars,
                returnedCharCount = content.Length,
                nextOffset = end,
                truncated = end < text.Length,
                content = content,
            };
        }

        internal static void ValidateProjectScriptPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("path is required.", nameof(path));
            }
            if (path.Length > MaximumPathLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(path),
                    $"path must be at most {MaximumPathLength} characters.");
            }
            if (path.IndexOf('\\') >= 0)
            {
                throw new ArgumentException(
                    "path must use Unity project-relative forward slashes.",
                    nameof(path));
            }
            if (!path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("script.read requires an exact .cs asset path.", nameof(path));
            }
            if (!path.StartsWith("Assets/", StringComparison.Ordinal) &&
                !path.StartsWith("Packages/", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "script.read paths must be under Assets or Packages.",
                    nameof(path));
            }

            var segments = path.Split('/');
            for (var index = 0; index < segments.Length; index++)
            {
                if (string.IsNullOrEmpty(segments[index]) ||
                    string.Equals(segments[index], ".", StringComparison.Ordinal) ||
                    string.Equals(segments[index], "..", StringComparison.Ordinal))
                {
                    throw new ArgumentException(
                        "path must not contain empty, '.' or '..' segments.",
                        nameof(path));
                }
            }
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
                var combined = Path.Combine(
                    projectRoot.FullName,
                    canonicalPath.Replace('/', Path.DirectorySeparatorChar));
                return Path.GetFullPath(combined);
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

        private static bool HasUtf8Bom(byte[] bytes)
        {
            return bytes != null && bytes.Length >= 3 &&
                bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        }

        private static string ComputeSha256(byte[] bytes)
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

        private static int CountLines(string text)
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
    }
}
