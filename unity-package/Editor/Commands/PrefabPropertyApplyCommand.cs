using System;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class PrefabPropertyApplyPayload
    {
        public string mutationId;
        public bool replayed;
        public bool applied;
        public string componentGlobalObjectId;
        public string componentTypeName;
        public string propertyPath;
        public string prefabPath;
        public string prefabGuid;
        public string expectedPrefabDependencyHash;
        public string dependencyHashBefore;
        public string dependencyHashAfter;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
    }

    internal sealed class PrefabPropertyApplyCompilingException : InvalidOperationException
    {
        public PrefabPropertyApplyCompilingException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyPlayModeException : InvalidOperationException
    {
        public PrefabPropertyApplyPlayModeException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyUnavailableException : InvalidOperationException
    {
        public PrefabPropertyApplyUnavailableException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyUnsupportedException : InvalidOperationException
    {
        public PrefabPropertyApplyUnsupportedException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyAssetChangedException : InvalidOperationException
    {
        public PrefabPropertyApplyAssetChangedException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyMutationConflictException : InvalidOperationException
    {
        public PrefabPropertyApplyMutationConflictException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyIncompleteException : InvalidOperationException
    {
        public PrefabPropertyApplyIncompleteException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyVerificationException : InvalidOperationException
    {
        public PrefabPropertyApplyVerificationException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyReplayStaleException : InvalidOperationException
    {
        public PrefabPropertyApplyReplayStaleException(string message) : base(message) { }
    }

    internal static class PrefabPropertyApplyCommand
    {
        public const int MaximumPropertyPathLength = 512;
        public const int MaximumPrefabPathLength = 512;
        public const int MaximumDependencyHashLength = 128;

        private const string Operation = "prefab.property.apply";
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.PrefabPropertyApply.";

        public static void ValidateArguments(
            string componentGlobalObjectId,
            string propertyPath,
            string prefabPath,
            string expectedPrefabDependencyHash,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(componentGlobalObjectId);
            ValidatePropertyPath(propertyPath);
            ValidatePrefabPath(prefabPath);
            ValidateDependencyHash(expectedPrefabDependencyHash);
            GameObjectUpdateCommand.ValidateMutationId(mutationId);
            if (string.IsNullOrWhiteSpace(expectedStateEpoch) || expectedStateRevision <= 0)
            {
                throw new ArgumentException(
                    "expectedStateEpoch and a positive expectedStateRevision are required for prefab.property.apply.");
            }
            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
        }

        public static PrefabPropertyApplyPayload Execute(
            string componentGlobalObjectId,
            string propertyPath,
            string prefabPath,
            string expectedPrefabDependencyHash,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                componentGlobalObjectId,
                propertyPath,
                prefabPath,
                expectedPrefabDependencyHash,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new PrefabPropertyApplyCompilingException(
                    "Unity is compiling; prefab.property.apply was not executed.");
            }
            if (EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                throw new PrefabPropertyApplyPlayModeException(
                    "prefab.property.apply is disabled while Unity is in or transitioning to Play Mode.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<PrefabPropertyApplyPayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached prefab.property.apply result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    componentGlobalObjectId,
                    propertyPath,
                    prefabPath,
                    expectedPrefabDependencyHash,
                    expectedStateEpoch,
                    expectedStateRevision);
                EnsureReplayStillMatches(cached);

                var replayState = EditorStateRevision.Capture();
                cached.replayed = true;
                cached.stateEpoch = replayState.epoch;
                cached.stateRevision = replayState.revision;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorStateRevision.RequireCurrent(expectedStateEpoch, expectedStateRevision);
            EnsureAssetHash(prefabPath, expectedPrefabDependencyHash);
            var target = ReadTarget(
                componentGlobalObjectId,
                propertyPath,
                prefabPath,
                requireOverride: true);

            var stateBefore = EditorStateRevision.Capture();
            EditorMutationLifecycleRecord lifecycle;
            try
            {
                lifecycle = EditorMutationLifecycle.Begin(
                    Operation,
                    mutationId,
                    BuildIntentFingerprint(
                        componentGlobalObjectId,
                        propertyPath,
                        prefabPath,
                        expectedPrefabDependencyHash,
                        expectedStateEpoch,
                        expectedStateRevision),
                    stateBefore);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new PrefabPropertyApplyMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new PrefabPropertyApplyIncompleteException(exception.Message);
            }

            // This is an asset-side persistent write. There is intentionally no Unity Undo claim here.
            // If execution or verification becomes ambiguous, the lifecycle remains "started" so the
            // same mutationId cannot blindly reapply the override.
            PrefabUtility.ApplyPropertyOverride(
                target.instanceProperty,
                prefabPath,
                InteractionMode.AutomatedAction);

            AssetDatabase.ImportAsset(
                prefabPath,
                ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            var verified = ReadTarget(
                componentGlobalObjectId,
                propertyPath,
                prefabPath,
                requireOverride: false);
            if (verified.instanceProperty.prefabOverride ||
                !SerializedProperty.DataEquals(verified.instanceProperty, verified.sourceProperty))
            {
                throw new PrefabPropertyApplyVerificationException(
                    "Unity returned from ApplyPropertyOverride, but native readback did not prove that the instance property now matches the selected Prefab Asset source and is no longer an override. The same mutationId will not be re-executed automatically.");
            }

            var dependencyHashAfter = AssetDatabase.GetAssetDependencyHash(prefabPath).ToString();
            var prefabGuid = AssetDatabase.AssetPathToGUID(prefabPath) ?? string.Empty;
            if (string.IsNullOrEmpty(prefabGuid) || string.IsNullOrEmpty(dependencyHashAfter))
            {
                throw new PrefabPropertyApplyVerificationException(
                    "Prefab property apply completed, but GUID/dependencyHash readback was unavailable. The same mutationId will not be re-executed automatically.");
            }

            var stateAfter = EditorStateRevision.Capture();
            var result = new PrefabPropertyApplyPayload
            {
                mutationId = mutationId,
                replayed = false,
                applied = true,
                componentGlobalObjectId = verified.canonicalComponentGlobalObjectId,
                componentTypeName = verified.component.GetType().FullName ?? verified.component.GetType().Name,
                propertyPath = propertyPath,
                prefabPath = prefabPath,
                prefabGuid = prefabGuid,
                expectedPrefabDependencyHash = expectedPrefabDependencyHash,
                dependencyHashBefore = expectedPrefabDependencyHash,
                dependencyHashAfter = dependencyHashAfter,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = stateAfter.epoch,
                stateRevision = stateAfter.revision,
            };

            EditorMutationLifecycle.MarkCompleted(lifecycle, stateAfter);
            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string componentGlobalObjectId,
            string propertyPath,
            string prefabPath,
            string expectedPrefabDependencyHash,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            var component = componentGlobalObjectId ?? string.Empty;
            var property = propertyPath ?? string.Empty;
            var path = prefabPath ?? string.Empty;
            var hash = expectedPrefabDependencyHash ?? string.Empty;
            var epoch = expectedStateEpoch ?? string.Empty;
            return
                $"component:{component.Length}:{component}|property:{property.Length}:{property}|" +
                $"path:{path.Length}:{path}|hash:{hash.Length}:{hash}|" +
                $"epoch:{epoch.Length}:{epoch}|revision:{expectedStateRevision}";
        }

        internal static void ValidatePropertyPath(string propertyPath)
        {
            if (string.IsNullOrWhiteSpace(propertyPath))
            {
                throw new ArgumentException("propertyPath is required.", nameof(propertyPath));
            }
            if (propertyPath.Length > MaximumPropertyPathLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(propertyPath),
                    $"propertyPath must be at most {MaximumPropertyPathLength} characters.");
            }
            if (string.Equals(propertyPath, "m_Script", StringComparison.Ordinal))
            {
                throw new ArgumentException("prefab.property.apply does not apply m_Script overrides.", nameof(propertyPath));
            }
            if (propertyPath.IndexOf(".Array.", StringComparison.Ordinal) >= 0)
            {
                throw new ArgumentException(
                    "prefab.property.apply does not accept array elements or Array.size in the first bounded slice because Unity can apply the entire array for some array-element overrides.",
                    nameof(propertyPath));
            }
        }

        internal static void ValidatePrefabPath(string prefabPath)
        {
            if (string.IsNullOrWhiteSpace(prefabPath))
            {
                throw new ArgumentException("prefabPath is required.", nameof(prefabPath));
            }
            if (prefabPath.Length > MaximumPrefabPathLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(prefabPath),
                    $"prefabPath must be at most {MaximumPrefabPathLength} characters.");
            }
            if (prefabPath.Contains("\\") || prefabPath.StartsWith("/", StringComparison.Ordinal) ||
                prefabPath.Contains("../") || prefabPath.EndsWith("/..", StringComparison.Ordinal) ||
                !prefabPath.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "prefabPath must be a project-relative forward-slash path under Assets with no parent traversal. Package Prefabs are read-only for this operation.",
                    nameof(prefabPath));
            }
            if (!prefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("prefabPath must end in .prefab.", nameof(prefabPath));
            }
        }

        private static void ValidateDependencyHash(string dependencyHash)
        {
            if (string.IsNullOrWhiteSpace(dependencyHash) ||
                dependencyHash.Length > MaximumDependencyHashLength)
            {
                throw new ArgumentException(
                    $"expectedPrefabDependencyHash must be a non-empty string of at most {MaximumDependencyHashLength} characters.",
                    nameof(dependencyHash));
            }
        }

        private static void EnsureAssetHash(string prefabPath, string expectedHash)
        {
            var prefab = PrefabInspectCommand.RequirePrefabAsset(prefabPath);
            var assetType = PrefabUtility.GetPrefabAssetType(prefab);
            if (assetType == PrefabAssetType.Model)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "prefab.property.apply does not write Model Prefabs in this bounded slice.");
            }

            var currentHash = AssetDatabase.GetAssetDependencyHash(prefabPath).ToString();
            if (!string.Equals(currentHash, expectedHash, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyAssetChangedException(
                    $"Prefab Asset dependency hash changed. expected={expectedHash}, current={currentHash}. Re-inspect the Prefab before applying an override.");
            }
        }

        private static ApplyTargetReadback ReadTarget(
            string componentGlobalObjectId,
            string propertyPath,
            string prefabPath,
            bool requireOverride)
        {
            GlobalObjectId.TryParse(componentGlobalObjectId, out var parsed);
            var component = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed) as Component;
            if (component == null)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    "prefab.property.apply requires a live scene Component GlobalObjectId target.");
            }

            var activeScene = SceneManager.GetActiveScene();
            if (!activeScene.IsValid() || !activeScene.isLoaded ||
                component.gameObject.scene != activeScene)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    "The target Component must belong to the current loaded active scene.");
            }
            if (!PrefabUtility.IsPartOfPrefabInstance(component))
            {
                throw new PrefabPropertyApplyUnavailableException(
                    "The target Component is not part of a Prefab instance.");
            }

            var sourceComponent =
                PrefabUtility.GetCorrespondingObjectFromSourceAtPath(component, prefabPath) as Component;
            if (sourceComponent == null ||
                !string.Equals(AssetDatabase.GetAssetPath(sourceComponent), prefabPath, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"The target Component has no corresponding object in the explicitly selected Prefab Asset '{prefabPath}'. This matters for nested Prefabs, where more than one apply target can exist.");
            }

            var instanceSerializedObject = new SerializedObject(component);
            instanceSerializedObject.UpdateIfRequiredOrScript();
            var instanceProperty = FindVisibleProperty(instanceSerializedObject, propertyPath);
            if (instanceProperty.isArray ||
                instanceProperty.propertyPath.IndexOf(".Array.", StringComparison.Ordinal) >= 0)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "Array properties/elements are excluded from the first prefab.property.apply slice because Unity can widen an array-element apply to the entire array.");
            }
            if (!instanceProperty.isInstantiatedPrefab)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"Serialized property '{propertyPath}' is not an instantiated Prefab property.");
            }
            if (requireOverride && !instanceProperty.prefabOverride)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"Serialized property '{propertyPath}' is not currently a Prefab instance override, so there is nothing to apply.");
            }

            var sourceSerializedObject = new SerializedObject(sourceComponent);
            sourceSerializedObject.UpdateIfRequiredOrScript();
            var sourceProperty = sourceSerializedObject.FindProperty(propertyPath);
            if (sourceProperty == null)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"Corresponding serialized property '{propertyPath}' was not found in Prefab Asset '{prefabPath}'.");
            }
            if (sourceProperty.propertyType != instanceProperty.propertyType)
            {
                throw new PrefabPropertyApplyVerificationException(
                    $"Instance/source serialized property types differ for '{propertyPath}'. instance={instanceProperty.propertyType}, source={sourceProperty.propertyType}.");
            }

            return new ApplyTargetReadback
            {
                component = component,
                canonicalComponentGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString(),
                sourceComponent = sourceComponent,
                instanceProperty = instanceProperty.Copy(),
                sourceProperty = sourceProperty.Copy(),
            };
        }

        private static SerializedProperty FindVisibleProperty(
            SerializedObject serializedObject,
            string propertyPath)
        {
            var iterator = serializedObject.GetIterator();
            var enterChildren = true;
            while (iterator.NextVisible(enterChildren))
            {
                enterChildren = true;
                if (string.Equals(iterator.propertyPath, propertyPath, StringComparison.Ordinal))
                {
                    return iterator.Copy();
                }
            }

            throw new PrefabPropertyApplyUnavailableException(
                $"Visible serialized property '{propertyPath}' was not found on the target Component.");
        }

        private static void EnsureSameIntent(
            PrefabPropertyApplyPayload cached,
            string componentGlobalObjectId,
            string propertyPath,
            string prefabPath,
            string expectedPrefabDependencyHash,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.componentGlobalObjectId, componentGlobalObjectId, StringComparison.Ordinal) ||
                !string.Equals(cached.propertyPath, propertyPath, StringComparison.Ordinal) ||
                !string.Equals(cached.prefabPath, prefabPath, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedPrefabDependencyHash, expectedPrefabDependencyHash, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new PrefabPropertyApplyMutationConflictException(
                    "mutationId was already used for prefab.property.apply with different arguments or preconditions.");
            }
        }

        private static void EnsureReplayStillMatches(PrefabPropertyApplyPayload cached)
        {
            var currentGuid = AssetDatabase.AssetPathToGUID(cached.prefabPath) ?? string.Empty;
            var currentHash = AssetDatabase.GetAssetDependencyHash(cached.prefabPath).ToString();
            if (string.IsNullOrEmpty(currentGuid) ||
                !string.Equals(currentGuid, cached.prefabGuid, StringComparison.Ordinal) ||
                !string.Equals(currentHash, cached.dependencyHashAfter, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyReplayStaleException(
                    "The Prefab Asset changed or disappeared after the cached prefab.property.apply completed. The same mutationId will not reapply it automatically.");
            }

            ApplyTargetReadback readback;
            try
            {
                readback = ReadTarget(
                    cached.componentGlobalObjectId,
                    cached.propertyPath,
                    cached.prefabPath,
                    requireOverride: false);
            }
            catch (PrefabPropertyApplyUnavailableException exception)
            {
                throw new PrefabPropertyApplyReplayStaleException(
                    "The cached prefab.property.apply target can no longer be reconciled. " + exception.Message);
            }

            if (readback.instanceProperty.prefabOverride ||
                !SerializedProperty.DataEquals(readback.instanceProperty, readback.sourceProperty))
            {
                throw new PrefabPropertyApplyReplayStaleException(
                    "The cached prefab.property.apply target no longer matches the completed Prefab Asset value. The same mutationId will not reapply it automatically.");
            }
        }

        private sealed class ApplyTargetReadback
        {
            public Component component;
            public string canonicalComponentGlobalObjectId;
            public Component sourceComponent;
            public SerializedProperty instanceProperty;
            public SerializedProperty sourceProperty;
        }
    }
}
