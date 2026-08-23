using System;
using System.Collections.Generic;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class HierarchyNodePayload
    {
        public string globalObjectId;
        public int instanceId;
        public string name;
        public string hierarchyPath;
        public string parentGlobalObjectId;
        public int depth;
        public int siblingIndex;
        public int childCount;
        public bool activeSelf;
        public bool activeInHierarchy;
    }

    [Serializable]
    internal sealed class HierarchyPayload
    {
        public string sceneName;
        public string scenePath;
        public string stateEpoch;
        public long stateRevision;
        public int rootCount;
        public int returnedNodeCount;
        public int maxDepth;
        public int maxNodes;
        public bool truncatedByDepth;
        public bool truncatedByNodes;
        public HierarchyNodePayload[] nodes;
    }

    internal static class HierarchyCommand
    {
        public const int DefaultMaxDepth = 8;
        public const int DefaultMaxNodes = 200;
        public const int MaximumMaxDepth = 32;
        public const int MaximumMaxNodes = 500;

        private sealed class CollectedNode
        {
            public GameObject gameObject;
            public int parentIndex;
            public int depth;
            public string hierarchyPath;
        }

        private struct PendingNode
        {
            public GameObject gameObject;
            public int parentIndex;
            public int depth;
            public string hierarchyPath;
        }

        public static HierarchyPayload Execute(int maxDepth, int maxNodes)
        {
            if (maxDepth < 1 || maxDepth > MaximumMaxDepth)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxDepth),
                    $"maxDepth must be between 1 and {MaximumMaxDepth}.");
            }

            if (maxNodes < 1 || maxNodes > MaximumMaxNodes)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxNodes),
                    $"maxNodes must be between 1 and {MaximumMaxNodes}.");
            }

            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new InvalidOperationException("The active Unity scene is not valid and loaded.");
            }

            var state = EditorStateRevision.Capture();
            var roots = new List<GameObject>(Math.Max(scene.rootCount, 0));
            scene.GetRootGameObjects(roots);

            var pending = new Stack<PendingNode>(Math.Max(roots.Count, 4));
            for (var index = roots.Count - 1; index >= 0; index--)
            {
                var root = roots[index];
                pending.Push(new PendingNode
                {
                    gameObject = root,
                    parentIndex = -1,
                    depth = 0,
                    hierarchyPath = root.name,
                });
            }

            var collected = new List<CollectedNode>(Math.Min(maxNodes, 256));
            var truncatedByDepth = false;

            while (pending.Count > 0 && collected.Count < maxNodes)
            {
                var current = pending.Pop();
                var gameObject = current.gameObject;
                var transform = gameObject.transform;
                var collectedIndex = collected.Count;

                collected.Add(new CollectedNode
                {
                    gameObject = gameObject,
                    parentIndex = current.parentIndex,
                    depth = current.depth,
                    hierarchyPath = current.hierarchyPath,
                });

                if (transform.childCount == 0)
                {
                    continue;
                }

                if (current.depth + 1 >= maxDepth)
                {
                    truncatedByDepth = true;
                    continue;
                }

                for (var childIndex = transform.childCount - 1; childIndex >= 0; childIndex--)
                {
                    var child = transform.GetChild(childIndex).gameObject;
                    pending.Push(new PendingNode
                    {
                        gameObject = child,
                        parentIndex = collectedIndex,
                        depth = current.depth + 1,
                        hierarchyPath = current.hierarchyPath + "/" + child.name,
                    });
                }
            }

            var objects = new UnityEngine.Object[collected.Count];
            for (var index = 0; index < collected.Count; index++)
            {
                objects[index] = collected[index].gameObject;
            }

            var globalObjectIds = new GlobalObjectId[objects.Length];
            GlobalObjectId.GetGlobalObjectIdsSlow(objects, globalObjectIds);

            var nodes = new HierarchyNodePayload[collected.Count];
            for (var index = 0; index < collected.Count; index++)
            {
                var item = collected[index];
                var transform = item.gameObject.transform;
                nodes[index] = new HierarchyNodePayload
                {
                    globalObjectId = globalObjectIds[index].ToString(),
                    instanceId = item.gameObject.GetInstanceID(),
                    name = item.gameObject.name,
                    hierarchyPath = item.hierarchyPath,
                    parentGlobalObjectId = item.parentIndex >= 0
                        ? globalObjectIds[item.parentIndex].ToString()
                        : string.Empty,
                    depth = item.depth,
                    siblingIndex = transform.GetSiblingIndex(),
                    childCount = transform.childCount,
                    activeSelf = item.gameObject.activeSelf,
                    activeInHierarchy = item.gameObject.activeInHierarchy,
                };
            }

            return new HierarchyPayload
            {
                sceneName = scene.name,
                scenePath = scene.path ?? string.Empty,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
                rootCount = roots.Count,
                returnedNodeCount = nodes.Length,
                maxDepth = maxDepth,
                maxNodes = maxNodes,
                truncatedByDepth = truncatedByDepth,
                truncatedByNodes = pending.Count > 0,
                nodes = nodes,
            };
        }
    }
}
