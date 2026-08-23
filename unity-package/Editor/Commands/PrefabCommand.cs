using System;
using System.Collections.Generic;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class PrefabNodePayload
    {
        public string relativePath;
        public string name;
        public int depth;
        public int siblingIndex;
        public int childCount;
        public bool activeSelf;
        public string[] componentTypeNames;
    }

    [Serializable]
    internal sealed class PrefabInspectPayload
    {
        public string guid;
        public string path;
        public string dependencyHash;
        public string prefabAssetType;
        public string rootName;
        public int totalNodeCount;
        public int returnedNodeCount;
        public int maxDepth;
        public int maxNodes;
        public bool truncatedByDepth;
        public bool truncatedByNodes;
        public PrefabNodePayload[] nodes;
    }

    [Serializable]
    internal sealed class PrefabInstantiatePayload
    {
        public string mutationId;
        public bool replayed;
        public string prefabGuid;
        public string prefabPath;
        public string expectedPrefabDependencyHash;
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

    internal sealed class PrefabUnavailableException : InvalidOperationException
    {
        public PrefabUnavailableException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetChangedException : InvalidOperationException
    {
        public PrefabAssetChangedException(string message) : base(message) { }
    }

    internal sealed class PrefabMutationConflictException : InvalidOperationException
    {
        public PrefabMutationConflictException(string message) : base(message) { }
    }

    internal sealed class PrefabMutationIncompleteException : InvalidOperationException
    {
        public PrefabMutationIncompleteException(string message) : base(message) { }
    }

    internal sealed class PrefabReplayStaleException : InvalidOperationException
    {
        public PrefabReplayStaleException(string message) : base(message) { }
    }

    internal sealed class PrefabReadbackException : InvalidOperationException
    {
        public PrefabReadbackException(string message) : base(message) { }
    }

    internal static class PrefabInspectCommand
    {
        public const int DefaultMaxDepth = 8;
        public const int MaximumMaxDepth = 32;
        public const int DefaultMaxNodes = 100;
        public const int MaximumMaxNodes = 500;

        public static void ValidateArguments(string path, int maxDepth, int maxNodes)
        {
            AssetSearchCommand.ValidateProjectPath(path, nameof(path));
            if (maxDepth < 0 || maxDepth > MaximumMaxDepth)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxDepth),
                    $"maxDepth must be between 0 and {MaximumMaxDepth}.");
            }
            if (maxNodes < 1 || maxNodes > MaximumMaxNodes)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxNodes),
                    $"maxNodes must be between 1 and {MaximumMaxNodes}.");
            }
        }

        public static PrefabInspectPayload Execute(string path, int maxDepth, int maxNodes)
        {
            ValidateArguments(path, maxDepth, maxNodes);
            var prefab = RequirePrefabAsset(path);
            var nodes = new List<PrefabNodePayload>();
            var totalNodeCount = 0;
            var truncatedByDepth = false;
            var truncatedByNodes = false;
            Traverse(
                prefab.transform,
                prefab.name,
                0,
                maxDepth,
                maxNodes,
                nodes,
                ref totalNodeCount,
                ref truncatedByDepth,
                ref truncatedByNodes);

            return new PrefabInspectPayload
            {
                guid = AssetDatabase.AssetPathToGUID(path) ?? string.Empty,
                path = path,
                dependencyHash = AssetDatabase.GetAssetDependencyHash(path).ToString(),
                prefabAssetType = PrefabUtility.GetPrefabAssetType(prefab).ToString(),
                rootName = prefab.name ?? string.Empty,
                totalNodeCount = totalNodeCount,
                returnedNodeCount = nodes.Count,
                maxDepth = maxDepth,
                maxNodes = maxNodes,
                truncatedByDepth = truncatedByDepth,
                truncatedByNodes = truncatedByNodes,
                nodes = nodes.ToArray(),
            };
        }

        internal static GameObject RequirePrefabAsset(string path)
        {
            if (AssetDatabase.IsValidFolder(path))
            {
                throw new PrefabUnavailableException("Prefab operations require an exact prefab asset file path, not a folder.");
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            var guid = AssetDatabase.AssetPathToGUID(path);
            if (prefab == null || string.IsNullOrEmpty(guid) || !PrefabUtility.IsPartOfPrefabAsset(prefab))
            {
                throw new PrefabUnavailableException($"No Unity Prefab Asset is available at '{path}'.");
            }

            return prefab;
        }

        private static void Traverse(
            Transform current,
            string relativePath,
            int depth,
            int maxDepth,
            int maxNodes,
            List<PrefabNodePayload> nodes,
            ref int totalNodeCount,
            ref bool truncatedByDepth,
            ref bool truncatedByNodes)
        {
            totalNodeCount++;
            if (depth > maxDepth)
            {
                truncatedByDepth = true;
                return;
            }
            if (nodes.Count >= maxNodes)
            {
                truncatedByNodes = true;
                return;
            }

            var components = current.gameObject.GetComponents<Component>();
            var componentNames = new string[components.Length];
            for (var index = 0; index < components.Length; index++)
            {
                componentNames[index] = components[index] != null
                    ? components[index].GetType().FullName ?? components[index].GetType().Name
                    : "<MissingScript>";
            }

            nodes.Add(new PrefabNodePayload
            {
                relativePath = relativePath,
                name = current.gameObject.name ?? string.Empty,
                depth = depth,
                siblingIndex = current.GetSiblingIndex(),
                childCount = current.childCount,
                activeSelf = current.gameObject.activeSelf,
                componentTypeNames = componentNames,
            });

            for (var index = 0; index < current.childCount; index++)
            {
                var child = current.GetChild(index);
                Traverse(
                    child,
                    relativePath + "/" + child.name,
                    depth + 1,
                    maxDepth,
                    maxNodes,
                    nodes,
                    ref totalNodeCount,
                    ref truncatedByDepth,
                    ref truncatedByNodes);
            }
        }
    }

    internal static class PrefabInstantiateCommand
    {
        public const int MaximumMutationIdLength = 128;
        public const int MaximumDependencyHashLength = 128;

        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.PrefabInstantiate.";
        private const string UndoGroupName = "Unity AI Bridge: Instantiate Prefab";

        public static void ValidateArguments(
            string prefabPath,
            string expectedPrefabDependencyHash,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            AssetSearchCommand.ValidateProjectPath(prefabPath, nameof(prefabPath));
            if (string.IsNullOrWhiteSpace(expectedPrefabDependencyHash) ||
                expectedPrefabDependencyHash.Length > MaximumDependencyHashLength)
            {
                throw new ArgumentException(
                    $"expectedPrefabDependencyHash must be a non-empty string of at most {MaximumDependencyHashLength} characters.",
                    nameof(expectedPrefabDependencyHash));
            }
            ValidateMutationId(mutationId);
            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
            if (string.IsNullOrEmpty(expectedStateEpoch) || expectedStateRevision <= 0)
            {
                throw new ArgumentException("prefab.instantiate requires a fresh expectedStateEpoch + expectedStateRevision.");
            }
        }

        public static PrefabInstantiatePayload Execute(
            string prefabPath,
            string expectedPrefabDependencyHash,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                prefabPath,
                expectedPrefabDependencyHash,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<PrefabInstantiatePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached prefab.instantiate result is invalid.");
                }
                if (!string.Equals(cached.prefabPath, prefabPath, StringComparison.Ordinal) ||
                    !string.Equals(cached.expectedPrefabDependencyHash, expectedPrefabDependencyHash, StringComparison.Ordinal) ||
                    !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                    cached.expectedStateRevision != expectedStateRevision)
                {
                    throw new PrefabMutationConflictException(
                        "mutationId was already used for prefab.instantiate with different arguments or preconditions.");
                }

                EnsureAssetHash(prefabPath, expectedPrefabDependencyHash);
                var replayReadback = ObjectResolverCommand.Execute(cached.globalObjectId);
                EnsureReplayStillMatches(cached, replayReadback);
                var replayState = EditorStateRevision.Capture();
                cached.instanceId = replayReadback.instanceId;
                cached.name = replayReadback.name;
                cached.hierarchyPath = replayReadback.hierarchyPath;
                cached.sceneName = replayReadback.sceneName;
                cached.scenePath = replayReadback.scenePath;
                cached.siblingIndex = replayReadback.siblingIndex;
                cached.stateEpoch = replayState.epoch;
                cached.stateRevision = replayState.revision;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<InstantiateMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "prefab.instantiate",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(prefabPath, expectedPrefabDependencyHash, expectedStateEpoch, expectedStateRevision),
                    context => InstantiateNative(context, prefabPath, expectedPrefabDependencyHash),
                    (context, state) => VerifyNative(context, state, prefabPath, expectedPrefabDependencyHash),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new PrefabMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new PrefabMutationIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new PrefabReadbackException(exception.Message);
            }

            if (!execution.outcome.changed || !execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException("prefab.instantiate returned an inconsistent successful transaction outcome.");
            }

            var readback = execution.value.readback;
            var stateAfter = EditorStateRevision.Capture();
            var result = new PrefabInstantiatePayload
            {
                mutationId = mutationId,
                replayed = false,
                prefabGuid = AssetDatabase.AssetPathToGUID(prefabPath) ?? string.Empty,
                prefabPath = prefabPath,
                expectedPrefabDependencyHash = expectedPrefabDependencyHash,
                globalObjectId = readback.canonicalGlobalObjectId,
                instanceId = readback.instanceId,
                name = readback.name,
                hierarchyPath = readback.hierarchyPath,
                sceneName = readback.sceneName,
                scenePath = readback.scenePath,
                siblingIndex = readback.siblingIndex,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = stateAfter.epoch,
                stateRevision = stateAfter.revision,
            };
            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string prefabPath,
            string expectedPrefabDependencyHash,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return $"path:{prefabPath.Length}:{prefabPath}|hash:{expectedPrefabDependencyHash.Length}:{expectedPrefabDependencyHash}|epoch:{expectedStateEpoch.Length}:{expectedStateEpoch}|revision:{expectedStateRevision}";
        }

        private static InstantiateMutationState InstantiateNative(
            EditorMutationContext context,
            string prefabPath,
            string expectedPrefabDependencyHash)
        {
            EnsureAssetHash(prefabPath, expectedPrefabDependencyHash);
            var prefab = PrefabInspectCommand.RequirePrefabAsset(prefabPath);
            var instance = PrefabUtility.InstantiatePrefab(prefab, context.activeScene) as GameObject;
            if (instance == null)
            {
                throw new PrefabUnavailableException("Unity did not return a GameObject root while instantiating the Prefab Asset.");
            }

            Undo.RegisterCreatedObjectUndo(instance, context.undoGroupName);
            context.MarkUndoRecorded();
            EditorSceneManager.MarkSceneDirty(context.activeScene);

            var ids = new GlobalObjectId[1];
            GlobalObjectId.GetGlobalObjectIdsSlow(new UnityEngine.Object[] { instance }, ids);
            return new InstantiateMutationState
            {
                globalObjectId = ids[0].ToString(),
                readback = null,
            };
        }

        private static bool VerifyNative(
            EditorMutationContext context,
            InstantiateMutationState state,
            string prefabPath,
            string expectedPrefabDependencyHash)
        {
            EnsureAssetHash(prefabPath, expectedPrefabDependencyHash);
            var readback = ObjectResolverCommand.Execute(state.globalObjectId);
            state.readback = readback;
            if (!readback.found || !readback.isGameObject ||
                !string.Equals(readback.scenePath, context.activeScene.path ?? string.Empty, StringComparison.Ordinal))
            {
                return false;
            }

            var instance = EditorUtility.InstanceIDToObject(readback.instanceId) as GameObject;
            if (instance == null)
            {
                return false;
            }
            var linkedPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance);
            var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
            var sourcePath = source != null ? AssetDatabase.GetAssetPath(source) : string.Empty;
            return string.Equals(linkedPath, prefabPath, StringComparison.Ordinal) &&
                string.Equals(sourcePath, prefabPath, StringComparison.Ordinal);
        }

        private static bool VerifyRollback(InstantiateMutationState state)
        {
            return state != null &&
                !string.IsNullOrEmpty(state.globalObjectId) &&
                !ObjectResolverCommand.Execute(state.globalObjectId).found;
        }

        private static void EnsureReplayStillMatches(
            PrefabInstantiatePayload cached,
            ObjectResolvePayload readback)
        {
            if (!readback.found || !readback.isGameObject)
            {
                throw new PrefabReplayStaleException(
                    "The cached prefab.instantiate target no longer exists, for example after Undo. The same mutationId will not instantiate another copy automatically.");
            }

            var instance = EditorUtility.InstanceIDToObject(readback.instanceId) as GameObject;
            var linkedPath = instance != null
                ? PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instance)
                : string.Empty;
            if (instance == null ||
                !string.Equals(readback.canonicalGlobalObjectId, cached.globalObjectId, StringComparison.Ordinal) ||
                !string.Equals(linkedPath, cached.prefabPath, StringComparison.Ordinal) ||
                !string.Equals(readback.scenePath, cached.scenePath, StringComparison.Ordinal))
            {
                throw new PrefabReplayStaleException(
                    "The cached prefab.instantiate target no longer matches the completed Prefab instance linkage. The same mutationId will not reapply it automatically.");
            }
        }

        private static void EnsureAssetHash(string prefabPath, string expectedPrefabDependencyHash)
        {
            PrefabInspectCommand.RequirePrefabAsset(prefabPath);
            var currentHash = AssetDatabase.GetAssetDependencyHash(prefabPath).ToString();
            if (!string.Equals(currentHash, expectedPrefabDependencyHash, StringComparison.Ordinal))
            {
                throw new PrefabAssetChangedException(
                    $"Prefab Asset dependency hash changed. expected={expectedPrefabDependencyHash}, current={currentHash}. Re-inspect the Prefab before instantiating.");
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
                var allowed = char.IsLetterOrDigit(value) || value == '-' || value == '_' || value == '.' || value == ':';
                if (!allowed)
                {
                    throw new ArgumentException(
                        "mutationId may contain only letters, digits, '-', '_', '.', and ':'.",
                        nameof(mutationId));
                }
            }
        }

        private sealed class InstantiateMutationState
        {
            public string globalObjectId;
            public ObjectResolvePayload readback;
        }
    }
}
