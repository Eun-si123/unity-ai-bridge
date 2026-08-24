using System;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class PlayModeSnapshotPayload
    {
        public string mode;
        public bool isPlaying;
        public bool isPaused;
        public bool isPlayingOrWillChangePlaymode;
        public bool enterPlayModeOptionsEnabled;
        public bool disableDomainReload;
        public bool disableSceneReload;
    }

    [Serializable]
    internal sealed class PlayModeSetPayload
    {
        public string mutationId;
        public bool replayed;
        public bool reconciled;
        public bool changed;
        public bool transitionRequested;
        public string targetMode;
        public string expectedCurrentMode;
        public long requestedUnixMs;
        public PlayModeSnapshotPayload before;
        public PlayModeSnapshotPayload afterRequest;
    }

    [Serializable]
    internal sealed class PlayModeMutationJournal
    {
        public string mutationId;
        public string targetMode;
        public string expectedCurrentMode;
        public string status;
        public bool changed;
        public long requestedUnixMs;
    }

    internal sealed class PlayModeCompilingException : InvalidOperationException
    {
        public PlayModeCompilingException(string message) : base(message) { }
    }

    internal sealed class PlayModeStateMismatchException : InvalidOperationException
    {
        public PlayModeStateMismatchException(string message) : base(message) { }
    }

    internal sealed class PlayModeTransitionInProgressException : InvalidOperationException
    {
        public PlayModeTransitionInProgressException(string message) : base(message) { }
    }

    internal sealed class PlayModeMutationConflictException : InvalidOperationException
    {
        public PlayModeMutationConflictException(string message) : base(message) { }
    }

    internal sealed class PlayModeIncompleteException : InvalidOperationException
    {
        public PlayModeIncompleteException(string message) : base(message) { }
    }

    internal sealed class PlayModeReplayStaleException : InvalidOperationException
    {
        public PlayModeReplayStaleException(string message) : base(message) { }
    }

    internal static class PlayModeCommand
    {
        public const int MaximumMutationIdLength = 128;

        private const string RequestedStatus = "requested";
        private const string CompletedStatus = "completed";
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.PlayMode.v1.";

        public static void ValidateArguments(
            string targetMode,
            string expectedCurrentMode,
            string mutationId)
        {
            ValidateStableMode(targetMode, nameof(targetMode));
            ValidateStableMode(expectedCurrentMode, nameof(expectedCurrentMode));
            ValidateMutationId(mutationId);
        }

        public static PlayModeSetPayload Execute(
            string targetMode,
            string expectedCurrentMode,
            string mutationId)
        {
            ValidateArguments(targetMode, expectedCurrentMode, mutationId);

            var sessionKey = SessionKeyPrefix + mutationId;
            var existing = ReadJournal(sessionKey);
            if (existing != null)
            {
                EnsureSameIntent(existing, targetMode, expectedCurrentMode);
                return ReplayOrReconcile(existing, sessionKey);
            }

            if (EditorApplication.isCompiling)
            {
                throw new PlayModeCompilingException(
                    "Unity is compiling; a new Play Mode transition was not started.");
            }

            var before = CaptureSnapshot();
            if (!IsStableMode(before.mode))
            {
                throw new PlayModeTransitionInProgressException(
                    $"Unity is already transitioning through '{before.mode}'. Wait for a stable 'edit' or 'play' state before starting another transition.");
            }
            if (!string.Equals(before.mode, expectedCurrentMode, StringComparison.Ordinal))
            {
                throw new PlayModeStateMismatchException(
                    $"Play Mode precondition mismatch. expectedCurrentMode={expectedCurrentMode}, current={before.mode}. Refresh editor.status before retrying.");
            }

            var changed = !string.Equals(targetMode, before.mode, StringComparison.Ordinal);
            var requestedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var journal = new PlayModeMutationJournal
            {
                mutationId = mutationId,
                targetMode = targetMode,
                expectedCurrentMode = expectedCurrentMode,
                status = changed ? RequestedStatus : CompletedStatus,
                changed = changed,
                requestedUnixMs = requestedUnixMs,
            };
            WriteJournal(sessionKey, journal);

            if (!changed)
            {
                return BuildPayload(journal, false, false, false, before, CaptureSnapshot());
            }

            // Journal before requesting the transition. Enter/Exit Play Mode is asynchronous
            // and can trigger domain reload depending on the user's Editor settings. A lost
            // response must reconcile this same mutationId instead of blindly requesting the
            // transition a second time.
            if (string.Equals(targetMode, "play", StringComparison.Ordinal))
            {
                EditorApplication.EnterPlaymode();
            }
            else
            {
                EditorApplication.ExitPlaymode();
            }

            return BuildPayload(journal, false, false, true, before, CaptureSnapshot());
        }

        public static PlayModeSnapshotPayload CaptureSnapshot()
        {
            var isPlaying = EditorApplication.isPlaying;
            var isPlayingOrWillChange = EditorApplication.isPlayingOrWillChangePlaymode;
            var optionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
            var options = EditorSettings.enterPlayModeOptions;

            return new PlayModeSnapshotPayload
            {
                mode = ClassifyMode(isPlaying, isPlayingOrWillChange),
                isPlaying = isPlaying,
                isPaused = EditorApplication.isPaused,
                isPlayingOrWillChangePlaymode = isPlayingOrWillChange,
                enterPlayModeOptionsEnabled = optionsEnabled,
                disableDomainReload = optionsEnabled &&
                    (options & EnterPlayModeOptions.DisableDomainReload) != 0,
                disableSceneReload = optionsEnabled &&
                    (options & EnterPlayModeOptions.DisableSceneReload) != 0,
            };
        }

        internal static string ClassifyModeForVerification(
            bool isPlaying,
            bool isPlayingOrWillChangePlaymode)
        {
            return ClassifyMode(isPlaying, isPlayingOrWillChangePlaymode);
        }

        internal static string BuildIntentFingerprintForVerification(
            string targetMode,
            string expectedCurrentMode)
        {
            ValidateStableMode(targetMode, nameof(targetMode));
            ValidateStableMode(expectedCurrentMode, nameof(expectedCurrentMode));
            return BuildIntentFingerprint(targetMode, expectedCurrentMode);
        }

        internal static void ClearForVerification(string mutationId)
        {
            if (!string.IsNullOrWhiteSpace(mutationId))
            {
                SessionState.EraseString(SessionKeyPrefix + mutationId);
            }
        }

        private static PlayModeSetPayload ReplayOrReconcile(
            PlayModeMutationJournal journal,
            string sessionKey)
        {
            var current = CaptureSnapshot();
            var target = journal.targetMode;

            if (string.Equals(journal.status, CompletedStatus, StringComparison.Ordinal))
            {
                if (!string.Equals(current.mode, target, StringComparison.Ordinal))
                {
                    throw new PlayModeReplayStaleException(
                        $"The completed Play Mode mutation no longer matches native state. target={target}, current={current.mode}. The same mutationId will not request another transition automatically.");
                }

                return BuildPayload(journal, true, false, false, current, current);
            }

            if (!string.Equals(journal.status, RequestedStatus, StringComparison.Ordinal))
            {
                throw new PlayModeIncompleteException(
                    $"Play Mode mutation journal has unsupported status '{journal.status}'.");
            }

            if (string.Equals(current.mode, target, StringComparison.Ordinal))
            {
                journal.status = CompletedStatus;
                WriteJournal(sessionKey, journal);
                return BuildPayload(journal, true, true, false, current, current);
            }

            if (IsTransitionToward(current.mode, target))
            {
                return BuildPayload(journal, true, false, false, current, current);
            }

            if (string.Equals(current.mode, journal.expectedCurrentMode, StringComparison.Ordinal))
            {
                throw new PlayModeIncompleteException(
                    "A previous delivery recorded the Play Mode transition intent but native state is still at the original stable mode. Unity AI Bridge will not guess that repeating Enter/Exit Play Mode is safe. Re-read editor.status and use a new mutationId only for a genuinely new transition intent.");
            }

            throw new PlayModeReplayStaleException(
                $"The requested Play Mode transition now observes unexpected native state '{current.mode}'. The same mutationId will not issue another transition automatically.");
        }

        private static PlayModeSetPayload BuildPayload(
            PlayModeMutationJournal journal,
            bool replayed,
            bool reconciled,
            bool transitionRequested,
            PlayModeSnapshotPayload before,
            PlayModeSnapshotPayload afterRequest)
        {
            return new PlayModeSetPayload
            {
                mutationId = journal.mutationId,
                replayed = replayed,
                reconciled = reconciled,
                changed = journal.changed,
                transitionRequested = transitionRequested,
                targetMode = journal.targetMode,
                expectedCurrentMode = journal.expectedCurrentMode,
                requestedUnixMs = journal.requestedUnixMs,
                before = before,
                afterRequest = afterRequest,
            };
        }

        private static void EnsureSameIntent(
            PlayModeMutationJournal journal,
            string targetMode,
            string expectedCurrentMode)
        {
            var requested = BuildIntentFingerprint(targetMode, expectedCurrentMode);
            var existing = BuildIntentFingerprint(journal.targetMode, journal.expectedCurrentMode);
            if (!string.Equals(requested, existing, StringComparison.Ordinal))
            {
                throw new PlayModeMutationConflictException(
                    "mutationId was already used for a different Play Mode target/precondition.");
            }
        }

        private static string BuildIntentFingerprint(string targetMode, string expectedCurrentMode)
        {
            return targetMode + "\n" + expectedCurrentMode;
        }

        private static string ClassifyMode(bool isPlaying, bool isPlayingOrWillChangePlaymode)
        {
            if (isPlaying)
            {
                return isPlayingOrWillChangePlaymode ? "play" : "exiting_play";
            }

            return isPlayingOrWillChangePlaymode ? "entering_play" : "edit";
        }

        private static bool IsStableMode(string mode)
        {
            return string.Equals(mode, "edit", StringComparison.Ordinal) ||
                   string.Equals(mode, "play", StringComparison.Ordinal);
        }

        private static bool IsTransitionToward(string mode, string targetMode)
        {
            return (string.Equals(targetMode, "play", StringComparison.Ordinal) &&
                    string.Equals(mode, "entering_play", StringComparison.Ordinal)) ||
                   (string.Equals(targetMode, "edit", StringComparison.Ordinal) &&
                    string.Equals(mode, "exiting_play", StringComparison.Ordinal));
        }

        private static void ValidateStableMode(string value, string paramName)
        {
            if (!IsStableMode(value))
            {
                throw new ArgumentException("Mode must be exactly 'edit' or 'play'.", paramName);
            }
        }

        private static void ValidateMutationId(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                throw new ArgumentException("mutationId is required.", nameof(mutationId));
            }
            if (mutationId.Length > MaximumMutationIdLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(mutationId),
                    $"mutationId must be at most {MaximumMutationIdLength} characters.");
            }
            for (var i = 0; i < mutationId.Length; i++)
            {
                var c = mutationId[i];
                if (!(char.IsLetterOrDigit(c) || c == '-' || c == '_' || c == '.' || c == ':'))
                {
                    throw new ArgumentException(
                        "mutationId may contain only letters, digits, '-', '_', '.', and ':'.",
                        nameof(mutationId));
                }
            }
        }

        private static PlayModeMutationJournal ReadJournal(string sessionKey)
        {
            var json = SessionState.GetString(sessionKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<PlayModeMutationJournal>(json);
            }
            catch (Exception exception)
            {
                throw new PlayModeIncompleteException(
                    $"Could not read the existing Play Mode mutation journal: {exception.Message}");
            }
        }

        private static void WriteJournal(string sessionKey, PlayModeMutationJournal journal)
        {
            SessionState.SetString(sessionKey, JsonUtility.ToJson(journal));
        }
    }
}
