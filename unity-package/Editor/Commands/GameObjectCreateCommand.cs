using System;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class GameObjectCreatePayload
    {
        public string mutationId;
        public bool replayed;
        public string globalObjectId;
        public int instanceId;
        public string name;
        public string hierarchyPath;
        public string sceneName;
        public string scenePath;
        public int siblingIndex;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
    }

    internal sealed class GameObjectCreateMutationConflictException : InvalidOperationException
    {
        public GameObjectCreateMutationConflictException(string message)
            : base(message)
        {
        }
    }

    internal sealed class GameObjectCreateReplayStaleException : InvalidOperationException
    {
        public GameObjectCreateReplayStaleException(string message)
            : base(message)
        {
        }
    }

    internal sealed class GameObjectCreateReadbackException : InvalidOperationException
    {
        public GameObjectCreateReadbackException(string message)
            : base(message)
        {
        }
    }

    internal sealed class GameObjectCreateCompilingException : InvalidOperationException
    {
        public GameObjectCreateCompilingException(string message)
            : base(message)
        {
        }
    }

    internal static class GameObjectCreateCommand
    {
        public const int MaximumNameLength = 128;
        public const int MaximumMutationIdLength = 128;

        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.GameObjectCreate.";
        private const string UndoGroupName = "Unity AI Bridge: Create GameObject";

        public static void ValidateArguments(string name, string mutationId)
        {
            ValidateArguments(name, mutationId, string.Empty, 0);
        }

        public static void ValidateArguments(
            string name,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateName(name);
            ValidateMutationId(mutationId);
            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
        }

        public static GameObjectCreatePayload Execute(string name, string mutationId)
        {
            return Execute(name, mutationId, string.Empty, 0);
        }

        public static GameObjectCreatePayload Execute(
            string name,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(name, mutationId, expectedStateEpoch, expectedStateRevision);

            // Preserve the Phase 1 fail-closed behavior for replay checks while compilation is active.
            if (EditorApplication.isCompiling)
            {
                throw new GameObjectCreateCompilingException(
                    "Unity is compiling; gameObject.create was not executed.");
            }

            var normalizedExpectedEpoch = expectedStateEpoch ?? string.Empty;
            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<GameObjectCreatePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached mutation result is invalid.");
                }

                if (!string.Equals(cached.name, name, StringComparison.Ordinal) ||
                    !string.Equals(
                        cached.expectedStateEpoch ?? string.Empty,
                        normalizedExpectedEpoch,
                        StringComparison.Ordinal) ||
                    cached.expectedStateRevision != expectedStateRevision)
                {
                    throw new GameObjectCreateMutationConflictException(
                        "mutationId was already used for gameObject.create with different arguments or state preconditions.");
                }

                var replayReadback = ObjectResolverCommand.Execute(cached.globalObjectId);
                EnsureReplayStillMatches(cached, replayReadback);
                RefreshFromReadback(cached, replayReadback);
                var replayState = EditorStateRevision.Capture();
                cached.stateEpoch = replayState.epoch;
                cached.stateRevision = replayState.revision;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            CreateMutationState mutationState;
            try
            {
                mutationState = EditorMutationTransaction.Execute(
                    "gameObject.create",
                    UndoGroupName,
                    normalizedExpectedEpoch,
                    expectedStateRevision,
                    context => CreateNativeObject(context, name),
                    (context, state) => VerifyNativeObject(context, state, name));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new GameObjectCreateCompilingException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new GameObjectCreateReadbackException(exception.Message);
            }

            var readback = mutationState.readback;
            var stateAfter = EditorStateRevision.Capture();
            var result = new GameObjectCreatePayload
            {
                mutationId = mutationId,
                replayed = false,
                globalObjectId = readback.canonicalGlobalObjectId,
                instanceId = readback.instanceId,
                name = readback.name,
                hierarchyPath = readback.hierarchyPath,
                sceneName = readback.sceneName,
                scenePath = readback.scenePath,
                siblingIndex = readback.siblingIndex,
                expectedStateEpoch = normalizedExpectedEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = stateAfter.epoch,
                stateRevision = stateAfter.revision,
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        private static CreateMutationState CreateNativeObject(
            EditorMutationContext context,
            string name)
        {
            var scene = context.activeScene;
            var gameObject = new GameObject(name);
            if (gameObject.scene != scene)
            {
                SceneManager.MoveGameObjectToScene(gameObject, scene);
            }

            Undo.RegisterCreatedObjectUndo(gameObject, context.undoGroupName);
            context.MarkUndoRecorded();
            EditorSceneManager.MarkSceneDirty(scene);

            var objects = new UnityEngine.Object[] { gameObject };
            var globalObjectIds = new GlobalObjectId[1];
            GlobalObjectId.GetGlobalObjectIdsSlow(objects, globalObjectIds);

            return new CreateMutationState
            {
                globalObjectId = globalObjectIds[0].ToString(),
                readback = null,
            };
        }

        private static bool VerifyNativeObject(
            EditorMutationContext context,
            CreateMutationState state,
            string requestedName)
        {
            var readback = ObjectResolverCommand.Execute(state.globalObjectId);
            state.readback = readback;

            return readback.found &&
                readback.isGameObject &&
                string.Equals(
                    readback.canonicalGlobalObjectId,
                    state.globalObjectId,
                    StringComparison.Ordinal) &&
                string.Equals(readback.name, requestedName, StringComparison.Ordinal) &&
                string.Equals(readback.sceneName, context.activeScene.name, StringComparison.Ordinal) &&
                string.Equals(
                    readback.scenePath,
                    context.activeScene.path ?? string.Empty,
                    StringComparison.Ordinal);
        }

        private static void EnsureReplayStillMatches(
            GameObjectCreatePayload cached,
            ObjectResolvePayload readback)
        {
            if (!readback.found)
            {
                throw new GameObjectCreateReplayStaleException(
                    "The cached gameObject.create target no longer exists. The same mutationId will not create a replacement automatically.");
            }

            if (!readback.isGameObject ||
                !string.Equals(readback.canonicalGlobalObjectId, cached.globalObjectId, StringComparison.Ordinal) ||
                !string.Equals(readback.name, cached.name, StringComparison.Ordinal) ||
                !string.Equals(readback.sceneName, cached.sceneName, StringComparison.Ordinal) ||
                !string.Equals(readback.scenePath, cached.scenePath, StringComparison.Ordinal))
            {
                throw new GameObjectCreateReplayStaleException(
                    "The cached gameObject.create target resolved, but its native Unity identity no longer matches the completed mutation result.");
            }
        }

        private static void RefreshFromReadback(
            GameObjectCreatePayload payload,
            ObjectResolvePayload readback)
        {
            payload.globalObjectId = readback.canonicalGlobalObjectId;
            payload.instanceId = readback.instanceId;
            payload.name = readback.name;
            payload.hierarchyPath = readback.hierarchyPath;
            payload.sceneName = readback.sceneName;
            payload.scenePath = readback.scenePath;
            payload.siblingIndex = readback.siblingIndex;
        }

        private static void ValidateName(string name)
        {
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
        }

        private static void ValidateMutationId(string mutationId)
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

        private sealed class CreateMutationState
        {
            public string globalObjectId;
            public ObjectResolvePayload readback;
        }
    }
}
