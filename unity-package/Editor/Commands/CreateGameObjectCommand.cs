using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class CreateGameObjectPayload
    {
        public string globalObjectId;
        public int instanceId;
        public string name;
        public string sceneName;
        public string scenePath;
        public int siblingIndex;
        public bool activeSelf;
        public bool activeInHierarchy;
        public bool sceneDirty;
        public bool created;
        public bool deduplicated;
        public string undoGroupName;
    }

    internal sealed class CreateGameObjectIdempotencyConflictException : Exception
    {
        public CreateGameObjectIdempotencyConflictException(string message) : base(message)
        {
        }
    }

    internal sealed class CreateGameObjectStaleTargetException : Exception
    {
        public CreateGameObjectStaleTargetException(string message) : base(message)
        {
        }
    }

    internal static class CreateGameObjectCommand
    {
        public const int MaximumNameLength = 128;
        public const int MinimumIdempotencyKeyLength = 8;
        public const int MaximumIdempotencyKeyLength = 128;
        public const string UndoGroupName = "Unity AI Bridge: Create GameObject";

        private const string SessionStatePrefix = "UnityAiBridge.CreateGameObject.";

        [Serializable]
        private sealed class IdempotencyRecord
        {
            public string requestedName;
            public string globalObjectId;
            public string scenePath;
        }

        public static CreateGameObjectPayload Execute(string requestedName, string idempotencyKey)
        {
            ValidateName(requestedName);
            ValidateIdempotencyKey(idempotencyKey);

            var cacheKey = SessionStatePrefix + idempotencyKey;
            var cachedJson = SessionState.GetString(cacheKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                return ResolveCachedResult(cachedJson, requestedName);
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException("The active Unity scene is not valid and loaded.");
            }

            // Consume the mutation key before changing Unity state. If Unity reloads or throws
            // after the object is created but before target identity is recorded, a retry must
            // fail closed instead of blindly creating a duplicate.
            var startedRecord = new IdempotencyRecord
            {
                requestedName = requestedName,
                globalObjectId = string.Empty,
                scenePath = scene.path ?? string.Empty,
            };
            SessionState.SetString(cacheKey, JsonUtility.ToJson(startedRecord));

            Undo.IncrementCurrentGroup();
            var undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName(UndoGroupName);

            var gameObject = new GameObject(requestedName);
            if (gameObject.scene.handle != scene.handle)
            {
                SceneManager.MoveGameObjectToScene(gameObject, scene);
            }

            Undo.RegisterCreatedObjectUndo(gameObject, UndoGroupName);
            if (!EditorSceneManager.MarkSceneDirty(scene))
            {
                throw new InvalidOperationException("Unity did not mark the active scene dirty after GameObject creation.");
            }

            var globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject);
            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(globalObjectId);
            if (!ReferenceEquals(resolved, gameObject))
            {
                throw new InvalidOperationException(
                    "Created GameObject could not be verified through GlobalObjectId readback.");
            }

            var completedRecord = new IdempotencyRecord
            {
                requestedName = requestedName,
                globalObjectId = globalObjectId.ToString(),
                scenePath = scene.path ?? string.Empty,
            };
            SessionState.SetString(cacheKey, JsonUtility.ToJson(completedRecord));
            Undo.CollapseUndoOperations(undoGroup);

            return BuildPayload(gameObject, created: true, deduplicated: false);
        }

        private static CreateGameObjectPayload ResolveCachedResult(
            string cachedJson,
            string requestedName)
        {
            IdempotencyRecord record;
            try
            {
                record = JsonUtility.FromJson<IdempotencyRecord>(cachedJson);
            }
            catch (Exception exception)
            {
                throw new CreateGameObjectStaleTargetException(
                    $"Stored idempotency state is unreadable: {exception.Message}");
            }

            if (record == null)
            {
                throw new CreateGameObjectStaleTargetException(
                    "Stored idempotency state is missing.");
            }

            if (!string.Equals(record.requestedName, requestedName, StringComparison.Ordinal))
            {
                throw new CreateGameObjectIdempotencyConflictException(
                    "The supplied idempotencyKey was already used with different create arguments. Use a new key for a new mutation intent.");
            }

            if (string.IsNullOrEmpty(record.globalObjectId))
            {
                throw new CreateGameObjectStaleTargetException(
                    "The idempotency key was already consumed but the original mutation did not record a completed target identity. The mutation state is ambiguous, so it will not be replayed automatically.");
            }

            GlobalObjectId globalObjectId;
            if (!GlobalObjectId.TryParse(record.globalObjectId, out globalObjectId))
            {
                throw new CreateGameObjectStaleTargetException(
                    "Stored idempotency target identity is invalid.");
            }

            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(globalObjectId) as GameObject;
            if (resolved == null)
            {
                throw new CreateGameObjectStaleTargetException(
                    "The idempotency key was already consumed, but its original GameObject no longer exists or its scene is not loaded. The mutation will not be replayed automatically.");
            }

            return BuildPayload(resolved, created: false, deduplicated: true);
        }

        private static CreateGameObjectPayload BuildPayload(
            GameObject gameObject,
            bool created,
            bool deduplicated)
        {
            var scene = gameObject.scene;
            var globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject);
            return new CreateGameObjectPayload
            {
                globalObjectId = globalObjectId.ToString(),
                instanceId = gameObject.GetInstanceID(),
                name = gameObject.name,
                sceneName = scene.name,
                scenePath = scene.path ?? string.Empty,
                siblingIndex = gameObject.transform.GetSiblingIndex(),
                activeSelf = gameObject.activeSelf,
                activeInHierarchy = gameObject.activeInHierarchy,
                sceneDirty = scene.isDirty,
                created = created,
                deduplicated = deduplicated,
                undoGroupName = UndoGroupName,
            };
        }

        public static void ValidateName(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException("name must contain at least one non-whitespace character.", nameof(value));
            }

            if (value.Length > MaximumNameLength)
            {
                throw new ArgumentException(
                    $"name must be at most {MaximumNameLength} characters.",
                    nameof(value));
            }

            if (value.IndexOf('\0') >= 0)
            {
                throw new ArgumentException("name must not contain NUL characters.", nameof(value));
            }
        }

        public static void ValidateIdempotencyKey(string value)
        {
            if (string.IsNullOrEmpty(value) ||
                value.Length < MinimumIdempotencyKeyLength ||
                value.Length > MaximumIdempotencyKeyLength)
            {
                throw new ArgumentException(
                    $"idempotencyKey must be {MinimumIdempotencyKeyLength}..{MaximumIdempotencyKeyLength} characters.",
                    nameof(value));
            }

            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                var allowed =
                    (character >= 'a' && character <= 'z') ||
                    (character >= 'A' && character <= 'Z') ||
                    (character >= '0' && character <= '9') ||
                    character == '-' ||
                    character == '_' ||
                    character == '.' ||
                    character == ':';

                if (!allowed)
                {
                    throw new ArgumentException(
                        "idempotencyKey may contain only letters, digits, '-', '_', '.', and ':'.",
                        nameof(value));
                }
            }
        }
    }
}
