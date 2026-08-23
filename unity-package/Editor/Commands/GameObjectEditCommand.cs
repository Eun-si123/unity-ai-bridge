using System;
using System.Globalization;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class GameObjectSnapshotPayload
    {
        public string globalObjectId;
        public int instanceId;
        public string name;
        public bool activeSelf;
        public bool activeInHierarchy;
        public int childCount;
        public string sceneName;
        public string scenePath;
        public string hierarchyPath;
        public int siblingIndex;
        public bool sceneIsDirty;
        public string stateEpoch;
        public long stateRevision;
    }

    [Serializable]
    internal sealed class GameObjectUpdatePayload
    {
        public string mutationId;
        public bool replayed;
        public bool changed;
        public string requestedGlobalObjectId;
        public string requestedName;
        public bool requestedActiveSelf;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public GameObjectSnapshotPayload gameObject;
    }

    [Serializable]
    internal sealed class GameObjectDeletePayload
    {
        public string mutationId;
        public bool replayed;
        public bool deleted;
        public string requestedGlobalObjectId;
        public string deletedName;
        public string deletedSceneName;
        public string deletedScenePath;
        public string deletedHierarchyPath;
        public int deletedChildCount;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
    }

    internal sealed class GameObjectEditTargetUnavailableException : InvalidOperationException
    {
        public GameObjectEditTargetUnavailableException(string message) : base(message) { }
    }

    internal sealed class GameObjectEditMutationConflictException : InvalidOperationException
    {
        public GameObjectEditMutationConflictException(string message) : base(message) { }
    }

    internal sealed class GameObjectEditIncompleteException : InvalidOperationException
    {
        public GameObjectEditIncompleteException(string message) : base(message) { }
    }

    internal sealed class GameObjectEditReplayStaleException : InvalidOperationException
    {
        public GameObjectEditReplayStaleException(string message) : base(message) { }
    }

    internal sealed class GameObjectEditReadbackException : InvalidOperationException
    {
        public GameObjectEditReadbackException(string message) : base(message) { }
    }

    internal sealed class GameObjectEditCompilingException : InvalidOperationException
    {
        public GameObjectEditCompilingException(string message) : base(message) { }
    }

    internal static class GameObjectSnapshotCommand
    {
        public static GameObjectSnapshotPayload Execute(string globalObjectId)
        {
            var gameObject = ResolveGameObject(globalObjectId, out var canonicalGlobalObjectId);
            return Capture(gameObject, canonicalGlobalObjectId);
        }

        internal static GameObject ResolveGameObject(
            string globalObjectId,
            out string canonicalGlobalObjectId)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            GlobalObjectId.TryParse(globalObjectId, out var parsed);
            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
            var gameObject = resolved as GameObject;
            if (gameObject == null)
            {
                throw new GameObjectEditTargetUnavailableException(
                    resolved == null
                        ? "The requested GameObject target no longer exists or its scene is unavailable."
                        : "GameObject edit operations require a GameObject GlobalObjectId target.");
            }

            canonicalGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject).ToString();
            return gameObject;
        }

        internal static GameObjectSnapshotPayload Capture(
            GameObject gameObject,
            string canonicalGlobalObjectId)
        {
            if (gameObject == null)
            {
                throw new ArgumentNullException(nameof(gameObject));
            }

            var scene = gameObject.scene;
            var state = EditorStateRevision.Capture();
            return new GameObjectSnapshotPayload
            {
                globalObjectId = canonicalGlobalObjectId,
                instanceId = gameObject.GetInstanceID(),
                name = gameObject.name ?? string.Empty,
                activeSelf = gameObject.activeSelf,
                activeInHierarchy = gameObject.activeInHierarchy,
                childCount = gameObject.transform.childCount,
                sceneName = scene.IsValid() ? scene.name ?? string.Empty : string.Empty,
                scenePath = scene.IsValid() ? scene.path ?? string.Empty : string.Empty,
                hierarchyPath = BuildHierarchyPath(gameObject.transform),
                siblingIndex = gameObject.transform.GetSiblingIndex(),
                sceneIsDirty = scene.IsValid() && scene.isDirty,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
            };
        }

        private static string BuildHierarchyPath(Transform transform)
        {
            var path = transform.name;
            var current = transform.parent;
            while (current != null)
            {
                path = current.name + "/" + path;
                current = current.parent;
            }

            return path;
        }
    }

    internal static class GameObjectUpdateCommand
    {
        public const int MaximumNameLength = 128;
        public const int MaximumMutationIdLength = 128;

        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.GameObjectUpdate.";
        private const string UndoGroupName = "Unity AI Bridge: Update GameObject";

        public static void ValidateArguments(
            string globalObjectId,
            string name,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new ArgumentException("name must contain at least one non-whitespace character.", nameof(name));
            }
            if (name.Length > MaximumNameLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(name),
                    $"name must be at most {MaximumNameLength} characters.");
            }

            ValidateMutationId(mutationId);
            RequireStateExpectation(expectedStateEpoch, expectedStateRevision, "gameObject.update");
        }

        public static GameObjectUpdatePayload Execute(
            string globalObjectId,
            string name,
            bool activeSelf,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                globalObjectId,
                name,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new GameObjectEditCompilingException(
                    "Unity is compiling; gameObject.update was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<GameObjectUpdatePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached gameObject.update mutation result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    globalObjectId,
                    name,
                    activeSelf,
                    expectedStateEpoch,
                    expectedStateRevision);

                GameObjectSnapshotPayload replayReadback;
                try
                {
                    replayReadback = GameObjectSnapshotCommand.Execute(cached.gameObject.globalObjectId);
                }
                catch (GameObjectEditTargetUnavailableException exception)
                {
                    throw new GameObjectEditReplayStaleException(
                        "The cached gameObject.update target is no longer available. " + exception.Message);
                }

                if (!SnapshotMatchesRequested(replayReadback, name, activeSelf))
                {
                    throw new GameObjectEditReplayStaleException(
                        "The cached gameObject.update target no longer has the completed name/active state. " +
                        "The same mutationId will not reapply it automatically.");
                }

                cached.gameObject = replayReadback;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<UpdateMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "gameObject.update",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        globalObjectId,
                        name,
                        activeSelf,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(context, globalObjectId, name, activeSelf),
                    (_, state) => VerifyMutation(state, name, activeSelf),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new GameObjectEditCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new GameObjectEditMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new GameObjectEditIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new GameObjectEditReadbackException(exception.Message);
            }

            if (!execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException(
                    "gameObject.update transaction returned an inconsistent successful verification outcome.");
            }

            var stateAfter = EditorStateRevision.Capture();
            var readback = execution.value.readback;
            readback.stateEpoch = stateAfter.epoch;
            readback.stateRevision = stateAfter.revision;
            readback.sceneIsDirty = execution.value.gameObject.scene.IsValid() &&
                execution.value.gameObject.scene.isDirty;

            var result = new GameObjectUpdatePayload
            {
                mutationId = mutationId,
                replayed = false,
                changed = execution.outcome.changed,
                requestedGlobalObjectId = globalObjectId,
                requestedName = name,
                requestedActiveSelf = activeSelf,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                gameObject = readback,
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string globalObjectId,
            string name,
            bool activeSelf,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return string.Join(
                "|",
                "target:" + globalObjectId,
                "name:" + name.Length.ToString(CultureInfo.InvariantCulture) + ":" + name,
                "active:" + (activeSelf ? "1" : "0"),
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        internal static bool SnapshotMatchesRequested(
            GameObjectSnapshotPayload snapshot,
            string name,
            bool activeSelf)
        {
            return snapshot != null &&
                string.Equals(snapshot.name, name, StringComparison.Ordinal) &&
                snapshot.activeSelf == activeSelf;
        }

        private static UpdateMutationState Mutate(
            EditorMutationContext context,
            string requestedGlobalObjectId,
            string name,
            bool activeSelf)
        {
            var gameObject = GameObjectSnapshotCommand.ResolveGameObject(
                requestedGlobalObjectId,
                out var canonicalGlobalObjectId);
            RequireActiveSceneTarget(gameObject, context.activeScene, "gameObject.update");

            var original = GameObjectSnapshotCommand.Capture(gameObject, canonicalGlobalObjectId);
            var changed = !string.Equals(gameObject.name, name, StringComparison.Ordinal) ||
                gameObject.activeSelf != activeSelf;

            if (changed)
            {
                Undo.RecordObject(gameObject, context.undoGroupName);
                context.MarkUndoRecorded();
                gameObject.name = name;
                gameObject.SetActive(activeSelf);
                EditorSceneManager.MarkSceneDirty(context.activeScene);
            }

            return new UpdateMutationState
            {
                gameObject = gameObject,
                globalObjectId = canonicalGlobalObjectId,
                original = original,
                readback = null,
            };
        }

        private static bool VerifyMutation(
            UpdateMutationState state,
            string name,
            bool activeSelf)
        {
            if (state == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            try
            {
                state.readback = GameObjectSnapshotCommand.Execute(state.globalObjectId);
            }
            catch (GameObjectEditTargetUnavailableException)
            {
                return false;
            }

            return state.readback != null &&
                string.Equals(state.readback.globalObjectId, state.globalObjectId, StringComparison.Ordinal) &&
                SnapshotMatchesRequested(state.readback, name, activeSelf);
        }

        private static bool VerifyRollback(UpdateMutationState state)
        {
            if (state == null || state.original == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            GameObjectSnapshotPayload readback;
            try
            {
                readback = GameObjectSnapshotCommand.Execute(state.globalObjectId);
            }
            catch (GameObjectEditTargetUnavailableException)
            {
                return false;
            }

            return string.Equals(readback.name, state.original.name, StringComparison.Ordinal) &&
                readback.activeSelf == state.original.activeSelf &&
                string.Equals(readback.scenePath, state.original.scenePath, StringComparison.Ordinal) &&
                string.Equals(readback.hierarchyPath, state.original.hierarchyPath, StringComparison.Ordinal);
        }

        private static void EnsureSameIntent(
            GameObjectUpdatePayload cached,
            string globalObjectId,
            string name,
            bool activeSelf,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.requestedGlobalObjectId, globalObjectId, StringComparison.Ordinal) ||
                !string.Equals(cached.requestedName, name, StringComparison.Ordinal) ||
                cached.requestedActiveSelf != activeSelf ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new GameObjectEditMutationConflictException(
                    "mutationId was already used for gameObject.update with different target, values, or state preconditions.");
            }
        }

        private sealed class UpdateMutationState
        {
            public GameObject gameObject;
            public string globalObjectId;
            public GameObjectSnapshotPayload original;
            public GameObjectSnapshotPayload readback;
        }

        internal static void ValidateMutationId(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId))
            {
                throw new ArgumentException("mutationId is required for write deduplication.", nameof(mutationId));
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

        internal static void RequireStateExpectation(
            string expectedStateEpoch,
            long expectedStateRevision,
            string operation)
        {
            if (string.IsNullOrWhiteSpace(expectedStateEpoch) || expectedStateRevision <= 0)
            {
                throw new ArgumentException(
                    $"{operation} requires expectedStateEpoch and a positive expectedStateRevision from a recent Unity observation.");
            }
            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
        }

        internal static void RequireActiveSceneTarget(
            GameObject gameObject,
            Scene activeScene,
            string operation)
        {
            if (gameObject == null || gameObject.scene != activeScene)
            {
                throw new GameObjectEditTargetUnavailableException(
                    $"{operation} currently requires the target GameObject to belong to the active scene.");
            }
        }
    }

    internal static class GameObjectDeleteCommand
    {
        public const int MaximumMutationIdLength = 128;

        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.GameObjectDelete.";
        private const string UndoGroupName = "Unity AI Bridge: Delete GameObject";

        public static void ValidateArguments(
            string globalObjectId,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            GameObjectUpdateCommand.ValidateMutationId(mutationId);
            GameObjectUpdateCommand.RequireStateExpectation(
                expectedStateEpoch,
                expectedStateRevision,
                "gameObject.delete");
        }

        public static GameObjectDeletePayload Execute(
            string globalObjectId,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                globalObjectId,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new GameObjectEditCompilingException(
                    "Unity is compiling; gameObject.delete was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<GameObjectDeletePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached gameObject.delete mutation result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    globalObjectId,
                    expectedStateEpoch,
                    expectedStateRevision);

                var activeScene = SceneManager.GetActiveScene();
                if (!activeScene.IsValid() || !activeScene.isLoaded ||
                    !string.Equals(activeScene.path ?? string.Empty, cached.deletedScenePath, StringComparison.Ordinal))
                {
                    throw new GameObjectEditReplayStaleException(
                        "The active scene no longer matches the scene in which the cached gameObject.delete completed.");
                }

                var readback = ObjectResolverCommand.Execute(cached.requestedGlobalObjectId);
                if (readback.found)
                {
                    throw new GameObjectEditReplayStaleException(
                        "The cached gameObject.delete target exists again, for example after Undo. " +
                        "The same mutationId will not delete it a second time automatically.");
                }

                var currentState = EditorStateRevision.Capture();
                cached.stateEpoch = currentState.epoch;
                cached.stateRevision = currentState.revision;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<DeleteMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "gameObject.delete",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        globalObjectId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(context, globalObjectId),
                    (_, state) => VerifyMutation(state),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new GameObjectEditCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new GameObjectEditMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new GameObjectEditIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new GameObjectEditReadbackException(exception.Message);
            }

            if (!execution.outcome.changed || !execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException(
                    "gameObject.delete transaction returned an inconsistent successful verification outcome.");
            }

            var stateAfter = EditorStateRevision.Capture();
            var original = execution.value.original;
            var result = new GameObjectDeletePayload
            {
                mutationId = mutationId,
                replayed = false,
                deleted = true,
                requestedGlobalObjectId = globalObjectId,
                deletedName = original.name,
                deletedSceneName = original.sceneName,
                deletedScenePath = original.scenePath,
                deletedHierarchyPath = original.hierarchyPath,
                deletedChildCount = original.childCount,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = stateAfter.epoch,
                stateRevision = stateAfter.revision,
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string globalObjectId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return string.Join(
                "|",
                "target:" + globalObjectId,
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        private static DeleteMutationState Mutate(
            EditorMutationContext context,
            string requestedGlobalObjectId)
        {
            var gameObject = GameObjectSnapshotCommand.ResolveGameObject(
                requestedGlobalObjectId,
                out var canonicalGlobalObjectId);
            GameObjectUpdateCommand.RequireActiveSceneTarget(
                gameObject,
                context.activeScene,
                "gameObject.delete");

            var original = GameObjectSnapshotCommand.Capture(gameObject, canonicalGlobalObjectId);
            Undo.DestroyObjectImmediate(gameObject);
            context.MarkUndoRecorded();
            EditorSceneManager.MarkSceneDirty(context.activeScene);

            return new DeleteMutationState
            {
                globalObjectId = canonicalGlobalObjectId,
                original = original,
            };
        }

        private static bool VerifyMutation(DeleteMutationState state)
        {
            if (state == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            var readback = ObjectResolverCommand.Execute(state.globalObjectId);
            return !readback.found;
        }

        private static bool VerifyRollback(DeleteMutationState state)
        {
            if (state == null || state.original == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            GameObjectSnapshotPayload readback;
            try
            {
                readback = GameObjectSnapshotCommand.Execute(state.globalObjectId);
            }
            catch (GameObjectEditTargetUnavailableException)
            {
                return false;
            }

            return string.Equals(readback.globalObjectId, state.original.globalObjectId, StringComparison.Ordinal) &&
                string.Equals(readback.name, state.original.name, StringComparison.Ordinal) &&
                readback.activeSelf == state.original.activeSelf &&
                readback.childCount == state.original.childCount &&
                string.Equals(readback.scenePath, state.original.scenePath, StringComparison.Ordinal) &&
                string.Equals(readback.hierarchyPath, state.original.hierarchyPath, StringComparison.Ordinal) &&
                readback.siblingIndex == state.original.siblingIndex;
        }

        private static void EnsureSameIntent(
            GameObjectDeletePayload cached,
            string globalObjectId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.requestedGlobalObjectId, globalObjectId, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new GameObjectEditMutationConflictException(
                    "mutationId was already used for gameObject.delete with different target or state preconditions.");
            }
        }

        private sealed class DeleteMutationState
        {
            public string globalObjectId;
            public GameObjectSnapshotPayload original;
        }
    }
}
