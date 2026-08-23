using System;
using System.IO;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class SceneSavePayload
    {
        public string mutationId;
        public bool replayed;
        public bool saved;
        public bool alreadyClean;
        public string sceneName;
        public string scenePath;
        public bool wasDirty;
        public bool isDirty;
        public string expectedScenePath;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
    }

    internal sealed class SceneSaveCompilingException : InvalidOperationException
    {
        public SceneSaveCompilingException(string message) : base(message) { }
    }

    internal sealed class SceneSavePlayModeException : InvalidOperationException
    {
        public SceneSavePlayModeException(string message) : base(message) { }
    }

    internal sealed class SceneSaveUnavailableException : InvalidOperationException
    {
        public SceneSaveUnavailableException(string message) : base(message) { }
    }

    internal sealed class SceneSaveSceneMismatchException : InvalidOperationException
    {
        public SceneSaveSceneMismatchException(string message) : base(message) { }
    }

    internal sealed class SceneSaveMutationConflictException : InvalidOperationException
    {
        public SceneSaveMutationConflictException(string message) : base(message) { }
    }

    internal sealed class SceneSaveIncompleteException : InvalidOperationException
    {
        public SceneSaveIncompleteException(string message) : base(message) { }
    }

    internal sealed class SceneSaveFailedException : InvalidOperationException
    {
        public SceneSaveFailedException(string message) : base(message) { }
    }

    internal sealed class SceneSaveVerificationException : InvalidOperationException
    {
        public SceneSaveVerificationException(string message) : base(message) { }
    }

    internal sealed class SceneSaveReplayStaleException : InvalidOperationException
    {
        public SceneSaveReplayStaleException(string message) : base(message) { }
    }

    internal static class SceneSaveCommand
    {
        public const int MaximumScenePathLength = 512;
        public const int MaximumMutationIdLength = 128;

        private const string Operation = "scene.save";
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.SceneSave.";

        public static void ValidateArguments(
            string expectedScenePath,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (string.IsNullOrWhiteSpace(expectedScenePath))
            {
                throw new ArgumentException("expectedScenePath is required.", nameof(expectedScenePath));
            }

            if (expectedScenePath.Length > MaximumScenePathLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(expectedScenePath),
                    $"expectedScenePath must be at most {MaximumScenePathLength} characters.");
            }

            ValidateMutationId(mutationId);

            if (string.IsNullOrWhiteSpace(expectedStateEpoch) || expectedStateRevision <= 0)
            {
                throw new ArgumentException(
                    "expectedStateEpoch and a positive expectedStateRevision are required for scene.save.");
            }

            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
        }

        public static SceneSavePayload Execute(
            string expectedScenePath,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                expectedScenePath,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new SceneSaveCompilingException(
                    "Unity is compiling; scene.save was not executed.");
            }

            if (EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                throw new SceneSavePlayModeException(
                    "scene.save is disabled while Unity is in or transitioning to Play Mode.");
            }

            var scene = SceneManager.GetActiveScene();
            EnsureSceneAvailable(scene);
            EnsureExpectedScene(scene, expectedScenePath);

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<SceneSavePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached scene.save result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    expectedScenePath,
                    expectedStateEpoch,
                    expectedStateRevision);
                EnsureReplayStillMatches(scene, cached);

                var replayState = EditorStateRevision.Capture();
                cached.replayed = true;
                cached.isDirty = scene.isDirty;
                cached.stateEpoch = replayState.epoch;
                cached.stateRevision = replayState.revision;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorStateRevision.RequireCurrent(expectedStateEpoch, expectedStateRevision);
            var stateBefore = EditorStateRevision.Capture();
            EditorMutationLifecycleRecord lifecycle;
            try
            {
                lifecycle = EditorMutationLifecycle.Begin(
                    Operation,
                    mutationId,
                    BuildIntentFingerprint(
                        expectedScenePath,
                        expectedStateEpoch,
                        expectedStateRevision),
                    stateBefore);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new SceneSaveMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new SceneSaveIncompleteException(exception.Message);
            }

            var wasDirty = scene.isDirty;
            if (!wasDirty)
            {
                var cleanState = EditorStateRevision.Capture();
                var cleanResult = BuildResult(
                    mutationId,
                    false,
                    false,
                    true,
                    scene,
                    false,
                    false,
                    expectedScenePath,
                    expectedStateEpoch,
                    expectedStateRevision,
                    cleanState);
                EditorMutationLifecycle.MarkCompleted(lifecycle, cleanState);
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cleanResult));
                return cleanResult;
            }

            var saved = EditorSceneManager.SaveScene(scene, scene.path, false);
            if (!saved)
            {
                // Keep the lifecycle in 'started'. A failed/ambiguous disk commit must not be
                // blindly retried under the same mutationId.
                throw new SceneSaveFailedException(
                    $"Unity did not confirm saving scene '{scene.path}'. Refresh native state before deciding whether to retry with a new mutationId.");
            }

            VerifySavedScene(scene, expectedScenePath);

            var stateAfter = EditorStateRevision.Advance();
            var result = BuildResult(
                mutationId,
                false,
                true,
                false,
                scene,
                true,
                scene.isDirty,
                expectedScenePath,
                expectedStateEpoch,
                expectedStateRevision,
                stateAfter);

            EditorMutationLifecycle.MarkCompleted(lifecycle, stateAfter);

            // Persist the operation-specific replay payload only after the common lifecycle
            // records completion. A reload in this narrow gap fails closed on retry.
            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string expectedScenePath,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            var path = expectedScenePath ?? string.Empty;
            var epoch = expectedStateEpoch ?? string.Empty;
            return $"scene:{path.Length}:{path}|epoch:{epoch.Length}:{epoch}|revision:{expectedStateRevision}";
        }

        private static SceneSavePayload BuildResult(
            string mutationId,
            bool replayed,
            bool saved,
            bool alreadyClean,
            Scene scene,
            bool wasDirty,
            bool isDirty,
            string expectedScenePath,
            string expectedStateEpoch,
            long expectedStateRevision,
            EditorStateRevisionSnapshot state)
        {
            return new SceneSavePayload
            {
                mutationId = mutationId,
                replayed = replayed,
                saved = saved,
                alreadyClean = alreadyClean,
                sceneName = scene.name,
                scenePath = scene.path ?? string.Empty,
                wasDirty = wasDirty,
                isDirty = isDirty,
                expectedScenePath = expectedScenePath,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
            };
        }

        private static void EnsureSceneAvailable(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new SceneSaveUnavailableException(
                    "The active Unity scene is not valid and loaded; scene.save was not executed.");
            }

            if (string.IsNullOrEmpty(scene.path))
            {
                throw new SceneSaveUnavailableException(
                    "The active Unity scene has never been saved and has no asset path. scene.save will not open an interactive Save As dialog; save the scene once in Unity first.");
            }
        }

        private static void EnsureExpectedScene(Scene scene, string expectedScenePath)
        {
            if (!string.Equals(scene.path, expectedScenePath, StringComparison.Ordinal))
            {
                throw new SceneSaveSceneMismatchException(
                    $"Active scene path changed. expected='{expectedScenePath}', current='{scene.path}'. Refresh Unity state before saving.");
            }
        }

        private static void EnsureSameIntent(
            SceneSavePayload cached,
            string expectedScenePath,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.expectedScenePath, expectedScenePath, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new SceneSaveMutationConflictException(
                    "mutationId was already used for scene.save with a different scene or state precondition.");
            }
        }

        private static void EnsureReplayStillMatches(Scene scene, SceneSavePayload cached)
        {
            if (!string.Equals(scene.path, cached.scenePath, StringComparison.Ordinal))
            {
                throw new SceneSaveReplayStaleException(
                    "The active scene no longer matches the completed scene.save result. The same mutationId will not save again automatically.");
            }

            var currentState = EditorStateRevision.Capture();
            if (!string.Equals(currentState.epoch, cached.stateEpoch, StringComparison.Ordinal) ||
                currentState.revision != cached.stateRevision ||
                scene.isDirty)
            {
                throw new SceneSaveReplayStaleException(
                    "Unity state changed after the completed scene.save result. The same mutationId will not write the scene again automatically; refresh state and use a new mutationId only for a new explicit save intent.");
            }
        }

        private static void VerifySavedScene(Scene scene, string expectedScenePath)
        {
            if (!scene.IsValid() || !scene.isLoaded ||
                !string.Equals(scene.path, expectedScenePath, StringComparison.Ordinal))
            {
                throw new SceneSaveVerificationException(
                    "Unity reported scene save success, but the active scene identity/path no longer matches the requested scene.");
            }

            if (scene.isDirty)
            {
                throw new SceneSaveVerificationException(
                    "Unity reported scene save success, but the scene is still marked dirty.");
            }

            var projectRoot = Directory.GetParent(Application.dataPath);
            if (projectRoot == null)
            {
                throw new SceneSaveVerificationException(
                    "Could not resolve the Unity project root while verifying the saved scene file.");
            }

            var absolutePath = Path.Combine(projectRoot.FullName, scene.path);
            if (!File.Exists(absolutePath))
            {
                throw new SceneSaveVerificationException(
                    $"Unity reported scene save success, but the scene file was not found at '{scene.path}'.");
            }
        }

        private static void ValidateMutationId(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                throw new ArgumentException("mutationId is required for save retry safety.", nameof(mutationId));
            }

            if (mutationId.Length > MaximumMutationIdLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(mutationId),
                    $"mutationId must be at most {MaximumMutationIdLength} characters.");
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
