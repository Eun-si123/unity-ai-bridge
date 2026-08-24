using System;

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

    internal sealed class ScriptReadLimitException : InvalidOperationException
    {
        public ScriptReadLimitException(string message) : base(message) { }
    }

    internal static class ScriptReadCommand
    {
        public const int DefaultMaxChars = 20000;
        public const int MaximumMaxChars = 100000;
        public const int MaximumPathLength = 512;
        public const long MaximumSourceBytes = ScriptFileUtility.MaximumSourceBytes;

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
            var snapshot = ScriptFileUtility.ReadSnapshot(path, true);
            var text = snapshot.text;

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
                guid = snapshot.guid,
                path = snapshot.path,
                sourceKind = snapshot.sourceKind,
                packageName = snapshot.packageName,
                dependencyHash = snapshot.dependencyHash,
                contentSha256 = snapshot.contentSha256,
                encoding = "utf-8",
                hasUtf8Bom = snapshot.hasUtf8Bom,
                byteLength = snapshot.bytes.LongLength,
                utf16CharCount = text.Length,
                lineCount = ScriptFileUtility.CountLines(text),
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
                throw new ArgumentException("Script workflows require an exact .cs asset path.", nameof(path));
            }
            if (!path.StartsWith("Assets/", StringComparison.Ordinal) &&
                !path.StartsWith("Packages/", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Script paths must be under Assets or Packages.",
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
    }
}
