using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class ObjectResolvePayload
    {
        public string requestedGlobalObjectId;
        public bool found;
        public string canonicalGlobalObjectId;
        public int instanceId;
        public string name;
        public string objectType;
        public bool isGameObject;
        public bool isComponent;
        public string owningGameObjectGlobalObjectId;
        public int owningGameObjectInstanceId;
        public string sceneName;
        public string scenePath;
        public string hierarchyPath;
        public int siblingIndex;
        public bool activeSelf;
        public bool activeInHierarchy;
    }

    internal static class ObjectResolverCommand
    {
        public const int MaximumGlobalObjectIdLength = 256;

        public static void ValidateArguments(string globalObjectId)
        {
            if (string.IsNullOrWhiteSpace(globalObjectId))
            {
                throw new ArgumentException("globalObjectId is required.", nameof(globalObjectId));
            }

            if (globalObjectId.Length > MaximumGlobalObjectIdLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(globalObjectId),
                    $"globalObjectId must be at most {MaximumGlobalObjectIdLength} characters.");
            }

            if (!GlobalObjectId.TryParse(globalObjectId, out _))
            {
                throw new ArgumentException("globalObjectId is not a valid Unity GlobalObjectId string.", nameof(globalObjectId));
            }
        }

        public static ObjectResolvePayload Execute(string globalObjectId)
        {
            ValidateArguments(globalObjectId);

            GlobalObjectId.TryParse(globalObjectId, out var parsed);
            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
            if (resolved == null)
            {
                return Missing(globalObjectId);
            }

            var canonicalGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(resolved).ToString();
            var gameObject = resolved as GameObject;
            var component = resolved as Component;
            var owner = gameObject != null ? gameObject : component != null ? component.gameObject : null;

            var payload = new ObjectResolvePayload
            {
                requestedGlobalObjectId = globalObjectId,
                found = true,
                canonicalGlobalObjectId = canonicalGlobalObjectId,
                instanceId = resolved.GetInstanceID(),
                name = resolved.name ?? string.Empty,
                objectType = resolved.GetType().FullName ?? resolved.GetType().Name,
                isGameObject = gameObject != null,
                isComponent = component != null,
                owningGameObjectGlobalObjectId = string.Empty,
                owningGameObjectInstanceId = 0,
                sceneName = string.Empty,
                scenePath = string.Empty,
                hierarchyPath = string.Empty,
                siblingIndex = 0,
                activeSelf = false,
                activeInHierarchy = false,
            };

            if (owner == null)
            {
                return payload;
            }

            payload.owningGameObjectGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString();
            payload.owningGameObjectInstanceId = owner.GetInstanceID();
            payload.hierarchyPath = BuildHierarchyPath(owner.transform);
            payload.siblingIndex = owner.transform.GetSiblingIndex();
            payload.activeSelf = owner.activeSelf;
            payload.activeInHierarchy = owner.activeInHierarchy;

            var scene = owner.scene;
            if (scene.IsValid())
            {
                payload.sceneName = scene.name ?? string.Empty;
                payload.scenePath = scene.path ?? string.Empty;
            }

            return payload;
        }

        private static ObjectResolvePayload Missing(string globalObjectId)
        {
            return new ObjectResolvePayload
            {
                requestedGlobalObjectId = globalObjectId,
                found = false,
                canonicalGlobalObjectId = string.Empty,
                instanceId = 0,
                name = string.Empty,
                objectType = string.Empty,
                isGameObject = false,
                isComponent = false,
                owningGameObjectGlobalObjectId = string.Empty,
                owningGameObjectInstanceId = 0,
                sceneName = string.Empty,
                scenePath = string.Empty,
                hierarchyPath = string.Empty,
                siblingIndex = 0,
                activeSelf = false,
                activeInHierarchy = false,
            };
        }

        private static string BuildHierarchyPath(Transform transform)
        {
            var names = new List<string>();
            var current = transform;
            while (current != null)
            {
                names.Add(current.name);
                current = current.parent;
            }

            names.Reverse();
            return string.Join("/", names);
        }
    }
}
