using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class ScriptReplacePayload
    {
        public string mutationId;
        public bool replayed;
        public bool reconciled;
        public bool changed;
        public string path;
        public string guid;
        public string expectedGuid;
        public string expectedContentSha256;
        public string contentSha256Before;
        public string contentSha256After;
        public bool hasUtf8Bom;
        public long byteLengthBefore;
        public long byteLengthAfter;
        public int utf16CharCountAfter;
        public int lineCountAfter;
        public long baselineCompilationSequence;
        public long writeCompletedUnixMs;
        public bool importRequested;
        public long importRequestedUnixMs;
    }

    [Serializable]
    internal sealed class ScriptReplaceJournal
    {
        public string mutationId;
        public string path;
        public string expectedGuid;
        public string expectedContentSha256;
        public string replacementTextSha256;
        public string intendedContentSha256;
        public string status;
        public bool changed;
        public bool hasUtf8Bom;
        public long byteLengthBefore;
        public long byteLengthAfter;
        public int utf16CharCountAfter;
        public int lineCountAfter;
        public long baselineCompilationSequence;
        public long writeCompletedUnixMs;
        public bool importRequested;
        public long importRequestedUnixMs;
    }

    internal sealed class ScriptReplaceCompilingException : InvalidOperationException
    {
        public ScriptReplaceCompilingException(string message) : base(message) { }
    }

    internal sealed class ScriptReplacePlayModeException : InvalidOperationException
    {
        public ScriptReplacePlayModeException(string message) : base(message) { }
    }

    internal sealed class ScriptReplaceNotEditableException : InvalidOperationException
    {
        public ScriptReplaceNotEditableException(string message) : base(message) { }
    }

    internal sealed class ScriptReplaceStaleContentException : InvalidOperationException
    {
        public ScriptReplaceStaleContentException(string message) : base(message) { }
    }

    internal sealed class ScriptReplaceIdentityChangedException : InvalidOperationException
    {
        public ScriptReplaceIdentityChangedException(string message) : base(message) { }
    }

    internal sealed class ScriptReplaceMutationConflictException : InvalidOperationException
    {
        public ScriptReplaceMutationConflictException(string message) : base(message) { }
    }

    internal sealed class ScriptReplaceIncompleteException : InvalidOperationException
    {
        public ScriptReplaceIncompleteException(string message) : base(message) { }
    }

    internal sealed class ScriptReplaceAtomicWriteException : InvalidOperationException
    {
        public ScriptReplaceAtomicWriteException(string message, Exception innerException = null)
            : base(message, innerException) { }
    }

    internal sealed class ScriptReplaceVerificationException : InvalidOperationException
    {
        public ScriptReplaceVerificationException(string message) : base(message) { }
    }

    internal static class ScriptReplaceCommand
    {
        public const int MaximumReplacementChars = 128000;
        public const int MaximumReplacementUtf8Bytes = 512 * 1024;
        public const int MaximumMutationIdLength = 128;

        private const string PreparedStatus = "prepared";
        private const string WrittenStatus = "written";
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.ScriptReplace.v1.";

        public static void ValidateArguments(
            string path,
            string expectedGuid,
            string expectedContentSha256,
            string content,
            string mutationId)
        {
            ScriptReadCommand.ValidateProjectScriptPath(path);
            if (!path.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "script.replace accepts only existing Assets/*.cs files; Packages remain read-only.",
                    nameof(path));
            }
            ValidateHex(expectedGuid, 32, nameof(expectedGuid));
            ValidateHex(expectedContentSha256, 64, nameof(expectedContentSha256));
            if (content == null)
            {
                throw new ArgumentNullException(nameof(content), "content is required; use an empty string to request an empty file.");
            }
            if (content.Length > MaximumReplacementChars)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(content),
                    $"content must be at most {MaximumReplacementChars} UTF-16 code units in the first script.replace slice.");
            }
            ValidateMutationId(mutationId);
        }

        public static ScriptReplacePayload Execute(
            string path,
            string expectedGuid,
            string expectedContentSha256,
            string content,
            string mutationId)
        {
            ValidateArguments(path, expectedGuid, expectedContentSha256, content, mutationId);

            if (EditorApplication.isCompiling)
            {
                throw new ScriptReplaceCompilingException(
                    "Unity is already compiling; script.replace was not started.");
            }
            if (EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                throw new ScriptReplacePlayModeException(
                    "script.replace is disabled while Unity is in or transitioning to Play Mode.");
            }

            var replacementBodyBytes = ScriptFileUtility.EncodeStrictUtf8(content, false);
            if (replacementBodyBytes.Length > MaximumReplacementUtf8Bytes)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(content),
                    $"UTF-8 replacement body must be at most {MaximumReplacementUtf8Bytes} bytes in the first script.replace slice.");
            }
            var replacementTextSha256 = ScriptFileUtility.ComputeSha256(replacementBodyBytes);

            var sessionKey = SessionKeyPrefix + mutationId;
            var existing = ReadJournal(sessionKey);
            if (existing != null)
            {
                EnsureSameIntent(
                    existing,
                    path,
                    expectedGuid,
                    expectedContentSha256,
                    replacementTextSha256);
                return ReplayOrReconcile(existing, sessionKey, content);
            }

            var snapshot = ScriptFileUtility.ReadSnapshot(path, false);
            RequireCanonicalIdentity(snapshot, path, expectedGuid);
            if (!string.Equals(snapshot.contentSha256, expectedContentSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new ScriptReplaceStaleContentException(
                    $"script.replace stale content: expected raw SHA-256 '{expectedContentSha256}', " +
                    $"but current '{snapshot.path}' is '{snapshot.contentSha256}'. Re-read before editing.");
            }

            if (!AssetDatabase.IsOpenForEdit(snapshot.path, out var editReason))
            {
                throw new ScriptReplaceNotEditableException(
                    string.IsNullOrWhiteSpace(editReason)
                        ? $"Unity reports '{snapshot.path}' is not open for editing."
                        : $"Unity reports '{snapshot.path}' is not open for editing: {editReason}");
            }
            var attributes = File.GetAttributes(snapshot.absolutePath);
            if ((attributes & FileAttributes.ReadOnly) != 0)
            {
                throw new ScriptReplaceNotEditableException(
                    $"The source file '{snapshot.path}' has the filesystem read-only attribute.");
            }

            var replacementBytes = ScriptFileUtility.EncodeStrictUtf8(content, snapshot.hasUtf8Bom);
            if (replacementBytes.Length > MaximumReplacementUtf8Bytes + 3)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(content),
                    "Encoded replacement exceeds the first script.replace byte bound after preserving the UTF-8 BOM.");
            }
            var intendedContentSha256 = ScriptFileUtility.ComputeSha256(replacementBytes);
            var diagnostics = DiagnosticsCommand.Execute(1, "error");
            var baselineSequence = diagnostics.latestCompilation != null
                ? diagnostics.latestCompilation.sequence
                : 0;

            var journal = new ScriptReplaceJournal
            {
                mutationId = mutationId,
                path = snapshot.path,
                expectedGuid = expectedGuid.ToLowerInvariant(),
                expectedContentSha256 = expectedContentSha256.ToLowerInvariant(),
                replacementTextSha256 = replacementTextSha256,
                intendedContentSha256 = intendedContentSha256,
                status = PreparedStatus,
                changed = !string.Equals(snapshot.contentSha256, intendedContentSha256, StringComparison.Ordinal),
                hasUtf8Bom = snapshot.hasUtf8Bom,
                byteLengthBefore = snapshot.bytes.LongLength,
                byteLengthAfter = replacementBytes.LongLength,
                utf16CharCountAfter = content.Length,
                lineCountAfter = ScriptFileUtility.CountLines(content),
                baselineCompilationSequence = baselineSequence,
                writeCompletedUnixMs = 0,
                importRequested = false,
                importRequestedUnixMs = 0,
            };
            WriteJournal(sessionKey, journal);

            if (!journal.changed)
            {
                journal.status = WrittenStatus;
                journal.writeCompletedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                WriteJournal(sessionKey, journal);
                return BuildPayload(journal, false, false);
            }

            ReplaceFileAtomically(snapshot.absolutePath, replacementBytes, mutationId);

            var afterWrite = ScriptFileUtility.ReadSnapshot(snapshot.path, false);
            RequireCanonicalIdentity(afterWrite, snapshot.path, expectedGuid);
            if (!string.Equals(afterWrite.contentSha256, intendedContentSha256, StringComparison.Ordinal))
            {
                throw new ScriptReplaceVerificationException(
                    $"script.replace wrote the target but exact raw SHA verification failed. " +
                    $"Expected '{intendedContentSha256}', observed '{afterWrite.contentSha256}'. " +
                    "Do not retry with a new mutationId until the file is re-read.");
            }

            journal.status = WrittenStatus;
            journal.writeCompletedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            journal.importRequested = true;
            journal.importRequestedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            WriteJournal(sessionKey, journal);

            // Do not force synchronous import here. A C# import can compile and reload the
            // current Editor domain. The journal is terminal for byte persistence before
            // the import begins so a reconnect can reconcile without another source write.
            AssetDatabase.ImportAsset(snapshot.path, ImportAssetOptions.ForceUpdate);

            return BuildPayload(journal, false, false);
        }

        internal static string BuildIntentFingerprintForVerification(
            string path,
            string expectedGuid,
            string expectedContentSha256,
            string content)
        {
            var body = ScriptFileUtility.EncodeStrictUtf8(content ?? string.Empty, false);
            return BuildIntentFingerprint(
                path,
                expectedGuid,
                expectedContentSha256,
                ScriptFileUtility.ComputeSha256(body));
        }

        internal static void ClearForVerification(string mutationId)
        {
            if (!string.IsNullOrWhiteSpace(mutationId))
            {
                SessionState.EraseString(SessionKeyPrefix + mutationId);
            }
        }

        internal static void ReplaceFileAtomicallyForVerification(
            string absolutePath,
            byte[] replacementBytes,
            string mutationId)
        {
            ReplaceFileAtomically(absolutePath, replacementBytes, mutationId);
        }

        private static ScriptReplacePayload ReplayOrReconcile(
            ScriptReplaceJournal journal,
            string sessionKey,
            string content)
        {
            var snapshot = ScriptFileUtility.ReadSnapshot(journal.path, false);
            RequireCanonicalIdentity(snapshot, journal.path, journal.expectedGuid);

            if (string.Equals(journal.status, WrittenStatus, StringComparison.Ordinal))
            {
                if (!string.Equals(snapshot.contentSha256, journal.intendedContentSha256, StringComparison.Ordinal))
                {
                    throw new ScriptReplaceStaleContentException(
                        "The completed script.replace target no longer matches its recorded new SHA. " +
                        "The same mutationId will not write the file again automatically.");
                }
                return BuildPayload(journal, true, false);
            }

            if (!string.Equals(journal.status, PreparedStatus, StringComparison.Ordinal))
            {
                throw new ScriptReplaceIncompleteException(
                    $"script.replace mutation journal has unsupported status '{journal.status}'.");
            }

            var currentRaw = ScriptFileUtility.EncodeStrictUtf8(content, journal.hasUtf8Bom);
            var recomputedIntended = ScriptFileUtility.ComputeSha256(currentRaw);
            if (!string.Equals(recomputedIntended, journal.intendedContentSha256, StringComparison.Ordinal))
            {
                throw new ScriptReplaceMutationConflictException(
                    "The replacement content no longer matches the prepared mutation intent.");
            }

            if (string.Equals(snapshot.contentSha256, journal.intendedContentSha256, StringComparison.Ordinal))
            {
                journal.status = WrittenStatus;
                if (journal.writeCompletedUnixMs <= 0)
                {
                    journal.writeCompletedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                }
                WriteJournal(sessionKey, journal);
                return BuildPayload(journal, true, true);
            }

            if (string.Equals(snapshot.contentSha256, journal.expectedContentSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new ScriptReplaceIncompleteException(
                    "A previous delivery prepared this mutationId but terminal byte persistence was not recorded. " +
                    "The original bytes are still present, but script.replace will not guess that re-execution is safe. " +
                    "Re-read native state and choose a new mutationId if a new write is intended.");
            }

            throw new ScriptReplaceStaleContentException(
                "A previous prepared script.replace now observes neither the original SHA nor the intended new SHA. " +
                "The outcome is ambiguous/stale and no automatic rewrite will occur.");
        }

        private static ScriptReplacePayload BuildPayload(
            ScriptReplaceJournal journal,
            bool replayed,
            bool reconciled)
        {
            return new ScriptReplacePayload
            {
                mutationId = journal.mutationId,
                replayed = replayed,
                reconciled = reconciled,
                changed = journal.changed,
                path = journal.path,
                guid = journal.expectedGuid,
                expectedGuid = journal.expectedGuid,
                expectedContentSha256 = journal.expectedContentSha256,
                contentSha256Before = journal.expectedContentSha256,
                contentSha256After = journal.intendedContentSha256,
                hasUtf8Bom = journal.hasUtf8Bom,
                byteLengthBefore = journal.byteLengthBefore,
                byteLengthAfter = journal.byteLengthAfter,
                utf16CharCountAfter = journal.utf16CharCountAfter,
                lineCountAfter = journal.lineCountAfter,
                baselineCompilationSequence = journal.baselineCompilationSequence,
                writeCompletedUnixMs = journal.writeCompletedUnixMs,
                importRequested = journal.importRequested,
                importRequestedUnixMs = journal.importRequestedUnixMs,
            };
        }

        private static void RequireCanonicalIdentity(
            ScriptFileSnapshot snapshot,
            string requestedPath,
            string expectedGuid)
        {
            if (!string.Equals(snapshot.path, requestedPath, StringComparison.Ordinal))
            {
                throw new ScriptReplaceIdentityChangedException(
                    $"Script path canonicalized from '{requestedPath}' to '{snapshot.path}'. " +
                    "Use the exact canonical path returned by script.read.");
            }
            if (!string.Equals(snapshot.guid, expectedGuid, StringComparison.OrdinalIgnoreCase))
            {
                throw new ScriptReplaceIdentityChangedException(
                    $"Script GUID changed: expected '{expectedGuid}', observed '{snapshot.guid}'. Re-read before editing.");
            }
        }

        private static void EnsureSameIntent(
            ScriptReplaceJournal journal,
            string path,
            string expectedGuid,
            string expectedContentSha256,
            string replacementTextSha256)
        {
            var expectedFingerprint = BuildIntentFingerprint(
                path,
                expectedGuid,
                expectedContentSha256,
                replacementTextSha256);
            var journalFingerprint = BuildIntentFingerprint(
                journal.path,
                journal.expectedGuid,
                journal.expectedContentSha256,
                journal.replacementTextSha256);
            if (!string.Equals(expectedFingerprint, journalFingerprint, StringComparison.Ordinal))
            {
                throw new ScriptReplaceMutationConflictException(
                    "mutationId was already used for script.replace with a different path/GUID/content precondition or replacement text.");
            }
        }

        private static string BuildIntentFingerprint(
            string path,
            string expectedGuid,
            string expectedContentSha256,
            string replacementTextSha256)
        {
            return $"path:{path?.Length ?? 0}:{path}|guid:{expectedGuid?.ToLowerInvariant()}|" +
                   $"before:{expectedContentSha256?.ToLowerInvariant()}|text:{replacementTextSha256?.ToLowerInvariant()}";
        }

        private static ScriptReplaceJournal ReadJournal(string sessionKey)
        {
            var json = SessionState.GetString(sessionKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            var journal = JsonUtility.FromJson<ScriptReplaceJournal>(json);
            if (journal == null || string.IsNullOrEmpty(journal.mutationId))
            {
                throw new InvalidOperationException("The stored script.replace mutation journal is invalid.");
            }
            return journal;
        }

        private static void WriteJournal(string sessionKey, ScriptReplaceJournal journal)
        {
            SessionState.SetString(sessionKey, JsonUtility.ToJson(journal));
        }

        private static void ReplaceFileAtomically(
            string absolutePath,
            byte[] replacementBytes,
            string mutationId)
        {
            if (string.IsNullOrWhiteSpace(absolutePath) || !File.Exists(absolutePath))
            {
                throw new ScriptReplaceAtomicWriteException("The target source file is unavailable for atomic replacement.");
            }

            var directory = Path.GetDirectoryName(absolutePath);
            if (string.IsNullOrEmpty(directory))
            {
                throw new ScriptReplaceAtomicWriteException("Could not resolve the target source directory.");
            }

            var safeMutation = mutationId.Replace(':', '_');
            var tempPath = Path.Combine(
                directory,
                "." + Path.GetFileName(absolutePath) + ".unityaibridge-" + safeMutation + ".tmp");
            if (File.Exists(tempPath))
            {
                throw new ScriptReplaceAtomicWriteException(
                    $"A stale script.replace temporary file already exists at '{tempPath}'. Remove/reconcile it before retrying.");
            }

            try
            {
                using (var stream = new FileStream(
                    tempPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                {
                    stream.Write(replacementBytes, 0, replacementBytes.Length);
                    stream.Flush(true);
                }

                File.Replace(tempPath, absolutePath, null);
            }
            catch (Exception exception)
            {
                throw new ScriptReplaceAtomicWriteException(
                    "Atomic source-file replacement failed. The mutation journal remains prepared so the same mutationId will not blindly retry.",
                    exception);
            }
            finally
            {
                if (File.Exists(tempPath))
                {
                    try
                    {
                        File.Delete(tempPath);
                    }
                    catch
                    {
                        // The original exception/result is more important. A leftover sibling
                        // temp file is detected explicitly before any future write attempt.
                    }
                }
            }
        }

        private static void ValidateHex(string value, int length, string parameterName)
        {
            if (string.IsNullOrEmpty(value) || value.Length != length)
            {
                throw new ArgumentException(
                    $"{parameterName} must be exactly {length} hexadecimal characters.",
                    parameterName);
            }
            for (var index = 0; index < value.Length; index++)
            {
                var c = value[index];
                var isHex =
                    (c >= '0' && c <= '9') ||
                    (c >= 'a' && c <= 'f') ||
                    (c >= 'A' && c <= 'F');
                if (!isHex)
                {
                    throw new ArgumentException(
                        $"{parameterName} must contain hexadecimal characters only.",
                        parameterName);
                }
            }
        }

        private static void ValidateMutationId(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId) || mutationId.Length > MaximumMutationIdLength)
            {
                throw new ArgumentException(
                    $"mutationId must be 1..{MaximumMutationIdLength} characters.",
                    nameof(mutationId));
            }
            for (var index = 0; index < mutationId.Length; index++)
            {
                var value = mutationId[index];
                var allowed =
                    (value >= 'a' && value <= 'z') ||
                    (value >= 'A' && value <= 'Z') ||
                    (value >= '0' && value <= '9') ||
                    value == '-' || value == '_' || value == '.' || value == ':';
                if (!allowed)
                {
                    throw new ArgumentException(
                        "mutationId may contain only letters, digits, '-', '_', '.', and ':'.",
                        nameof(mutationId));
                }
            }
        }
    }
}
