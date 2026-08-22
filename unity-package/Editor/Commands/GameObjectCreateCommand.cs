using System;
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
    }

    internal sealed class GameObjectCreateMutationConflictException : InvalidOperationException
    {
        public GameObjectCreateMutationConflictException(string message)
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
            ValidateName(name);
            ValidateMutationId(mutationId);
        }

        public static GameObjectCreatePayload Execute(string name, string mutationId)
        {
            ValidateArguments(name, mutationId);

            if (EditorApplication.isCompiling)
            {
                throw new GameObjectCreateCompilingException(
                    "Unity is compiling; gameObject.create was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<GameObjectCreatePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached mutation result is invalid.");
                }

                if (!string.Equals(cached.name, name, StringComparison.Ordinal))
                {
                    throw new GameObjectCreateMutationConflictException(
                        "mutationId was already used for gameObject.create with different arguments.");
                }

                cached.replayed = true;
                return cached;
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException("The active Unity scene is not valid and loaded.");
            }

            var gameObject = new GameObject(name);
            if (gameObject.scene != scene)
            {
                SceneManager.MoveGameObjectToScene(gameObject, scene);
            }

            Undo.RegisterCreatedObjectUndo(gameObject, UndoGroupName);
            EditorSceneManager.MarkSceneDirty(scene);

            var objects = new UnityEngine.Object[] { gameObject };
            var globalObjectIds = new GlobalObjectId[1];
            GlobalObjectId.GetGlobalObjectIdsSlow(objects, globalObjectIds);

            var result = new GameObjectCreatePayload
            {
                mutationId = mutationId,
                replayed = false,
                globalObjectId = globalObjectIds[0].ToString(),
                instanceId = gameObject.GetInstanceID(),
                name = gameObject.name,
                hierarchyPath = gameObject.name,
                sceneName = scene.name,
                scenePath = scene.path ?? string.Empty,
                siblingIndex = gameObject.transform.GetSiblingIndex(),
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
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
    }
}
