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
        public string gameObjectGlobalObjectId;
        public string propertyPath;
        public string propertyType;
        public string prefabPath;
        public string prefabGuid;
        public string expectedPrefabDependencyHash;
        public string dependencyHashAfter;
        public bool prefabOverrideBefore;
        public bool prefabOverrideAfter;
        public bool sourceMatchesInstanceAfter;
        public bool sceneWasDirtyBefore;
        public bool sceneIsDirtyAfter;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
        public ComponentPropertyPayload property;
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

    internal sealed class PrefabPropertyApplyReplayStaleException : InvalidOperationException
    {
        public PrefabPropertyApplyReplayStaleException(string message) : base(message) { }
    }

    internal sealed class PrefabPropertyApplyVerificationException : InvalidOperationException
    {
        public PrefabPropertyApplyVerificationException(string message) : base(message) { }
    }

    internal static class PrefabPropertyApplyCommand
    {
        public const int MaximumPropertyPathLength = 512;
        public const int MaximumPrefabPathLength = 512;
        public const int MaximumDependencyHashLength = 128;
        public const int MaximumMutationIdLength = 128;

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
            if (string.IsNullOrWhiteSpace(propertyPath) || propertyPath.Length > MaximumPropertyPathLength)
            {
                throw new ArgumentException(
                    $"propertyPath must be a non-empty string of at most {MaximumPropertyPathLength} characters.",
                    nameof(propertyPath));
            }
            ValidatePrefabPath(prefabPath);
            if (string.IsNullOrWhiteSpace(expectedPrefabDependencyHash) ||
                expectedPrefabDependencyHash.Length > MaximumDependencyHashLength)
            {
                throw new ArgumentException(
                    $"expectedPrefabDependencyHash must be a non-empty string of at most {MaximumDependencyHashLength} characters.",
                    nameof(expectedPrefabDependencyHash));
            }
            ValidateMutationId(mutationId);
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
                if (cached == null || string.IsNullOrEmpty(cached.mutationId) || cached.property == null)
                {
                    throw new InvalidOperationException(
                        "The cached prefab.property.apply result is invalid.");
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
            var preflight = ResolveApplyTarget(
                componentGlobalObjectId,
                propertyPath,
                prefabPath,
                requireOverride: true);
            EnsureAssetHash(prefabPath, expectedPrefabDependencyHash);

            var stateBefore = EditorStateRevision.Capture();
            var sceneWasDirtyBefore = preflight.component.gameObject.scene.isDirty;
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

            PrefabUtility.ApplyPropertyOverride(
                preflight.instanceProperty,
                prefabPath,
                InteractionMode.AutomatedAction);

            // Force the exact Prefab Asset to finish import before observing its new hash/source data.
            AssetDatabase.ImportAsset(
                prefabPath,
                ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            ApplyReadback verified;
            try
            {
                verified = VerifyApplied(
                    componentGlobalObjectId,
                    propertyPath,
                    prefabPath,
                    preflight.prefabGuid,
                    expectedPrefabDependencyHash);
            }
            catch (Exception exception)
                when (!(exception is PrefabPropertyApplyVerificationException))
            {
                throw new PrefabPropertyApplyVerificationException(exception.Message);
            }

            var stateAfter = EditorStateRevision.Advance();
            var result = new PrefabPropertyApplyPayload
            {
                mutationId = mutationId,
                replayed = false,
                applied = true,
                componentGlobalObjectId = verified.componentGlobalObjectId,
                gameObjectGlobalObjectId = verified.gameObjectGlobalObjectId,
                propertyPath = propertyPath,
                propertyType = verified.instanceProperty.propertyType.ToString(),
                prefabPath = prefabPath,
                prefabGuid = preflight.prefabGuid,
                expectedPrefabDependencyHash = expectedPrefabDependencyHash,
                dependencyHashAfter = verified.dependencyHash,
                prefabOverrideBefore = true,
                prefabOverrideAfter = verified.instanceProperty.prefabOverride,
                sourceMatchesInstanceAfter = verified.sourceMatchesInstance,
                sceneWasDirtyBefore = sceneWasDirtyBefore,
                sceneIsDirtyAfter = verified.component.gameObject.scene.isDirty,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = stateAfter.epoch,
                stateRevision = stateAfter.revision,
                property = ComponentInspectCommand.CaptureProperty(verified.instanceProperty),
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
            return $"component:{componentGlobalObjectId.Length}:{componentGlobalObjectId}" +
                   $"|property:{propertyPath.Length}:{propertyPath}" +
                   $"|prefab:{prefabPath.Length}:{prefabPath}" +
                   $"|hash:{expectedPrefabDependencyHash.Length}:{expectedPrefabDependencyHash}" +
                   $"|epoch:{expectedStateEpoch.Length}:{expectedStateEpoch}" +
                   $"|revision:{expectedStateRevision}";
        }

        private static ApplyReadback ResolveApplyTarget(
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
                    "prefab.property.apply requires a live Component GlobalObjectId target.");
            }
            if (component is Transform)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "The first prefab.property.apply slice does not apply Transform/RectTransform properties.");
            }

            var activeScene = SceneManager.GetActiveScene();
            if (!activeScene.IsValid() || !activeScene.isLoaded ||
                component.gameObject.scene != activeScene)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    "The target Component must belong to the current loaded active scene.");
            }
            if (!PrefabUtility.IsPartOfPrefabInstance(component) ||
                !PrefabUtility.IsPartOfPrefabThatCanBeAppliedTo(component) ||
                PrefabUtility.IsPartOfImmutablePrefab(component) ||
                PrefabUtility.IsPartOfModelPrefab(component))
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "The target Component must belong to an editable regular Prefab instance.");
            }

            var outermost = PrefabUtility.GetOutermostPrefabInstanceRoot(component.gameObject);
            if (outermost == null || !PrefabUtility.IsOutermostPrefabInstanceRoot(outermost))
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "The target must belong to an outermost Prefab instance with a stable apply target.");
            }
            var linkedPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(outermost);
            if (!string.Equals(linkedPath, prefabPath, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"Prefab linkage path mismatch. requested='{prefabPath}', linked='{linkedPath}'.");
            }

            var prefabRoot = PrefabInspectCommand.RequirePrefabAsset(prefabPath);
            if (PrefabUtility.GetPrefabAssetType(prefabRoot) != PrefabAssetType.Regular)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "The first prefab.property.apply slice supports Regular Prefab Assets only.");
            }

            var sourceComponent = PrefabUtility.GetCorrespondingObjectFromSource(component) as Component;
            if (sourceComponent == null ||
                !string.Equals(AssetDatabase.GetAssetPath(sourceComponent), prefabPath, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "Nested/variant Component source targets are not supported by the first property-apply slice.");
            }

            var instanceSerialized = new SerializedObject(component);
            instanceSerialized.UpdateIfRequiredOrScript();
            var instanceProperty = FindVisibleProperty(instanceSerialized, propertyPath);
            ValidateSupportedProperty(instanceProperty);
            if (requireOverride && !instanceProperty.prefabOverride)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"Serialized property '{propertyPath}' is not currently a Prefab override.");
            }

            var sourceSerialized = new SerializedObject(sourceComponent);
            sourceSerialized.UpdateIfRequiredOrScript();
            var sourceProperty = sourceSerialized.FindProperty(propertyPath);
            if (sourceProperty == null)
            {
                throw new PrefabPropertyApplyUnavailableException(
                    $"The source Prefab Asset does not contain serialized property '{propertyPath}'.");
            }

            return new ApplyReadback
            {
                component = component,
                sourceComponent = sourceComponent,
                componentGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString(),
                gameObjectGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component.gameObject).ToString(),
                prefabGuid = AssetDatabase.AssetPathToGUID(prefabPath) ?? string.Empty,
                dependencyHash = AssetDatabase.GetAssetDependencyHash(prefabPath).ToString(),
                instanceProperty = instanceProperty,
                sourceProperty = sourceProperty,
                sourceMatchesInstance = SerializedProperty.DataEquals(instanceProperty, sourceProperty),
            };
        }

        private static ApplyReadback VerifyApplied(
            string componentGlobalObjectId,
            string propertyPath,
            string prefabPath,
            string expectedPrefabGuid,
            string expectedOldHash)
        {
            var readback = ResolveApplyTarget(
                componentGlobalObjectId,
                propertyPath,
                prefabPath,
                requireOverride: false);

            if (string.IsNullOrEmpty(readback.prefabGuid) ||
                !string.Equals(readback.prefabGuid, expectedPrefabGuid, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyVerificationException(
                    "Prefab GUID changed while applying the property override.");
            }
            if (string.IsNullOrEmpty(readback.dependencyHash) ||
                string.Equals(readback.dependencyHash, expectedOldHash, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyVerificationException(
                    "Prefab dependencyHash did not change after applying the overridden property.");
            }
            if (readback.instanceProperty.prefabOverride)
            {
                throw new PrefabPropertyApplyVerificationException(
                    "The instance property is still marked as a Prefab override after ApplyPropertyOverride.");
            }
            if (!readback.sourceMatchesInstance)
            {
                throw new PrefabPropertyApplyVerificationException(
                    "The Prefab source property does not match the instance property after apply.");
            }
            return readback;
        }

        private static void EnsureAssetHash(string prefabPath, string expectedHash)
        {
            PrefabInspectCommand.RequirePrefabAsset(prefabPath);
            var current = AssetDatabase.GetAssetDependencyHash(prefabPath).ToString();
            if (!string.Equals(current, expectedHash, StringComparison.Ordinal))
            {
                throw new PrefabPropertyApplyAssetChangedException(
                    $"Prefab Asset dependency hash changed. expected={expectedHash}, current={current}. Re-inspect before applying the override.");
            }
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
                    "mutationId was already used for prefab.property.apply with different target/property/asset/preconditions.");
            }
        }

        private static void EnsureReplayStillMatches(PrefabPropertyApplyPayload cached)
        {
            ApplyReadback readback;
            try
            {
                readback = ResolveApplyTarget(
                    cached.componentGlobalObjectId,
                    cached.propertyPath,
                    cached.prefabPath,
                    requireOverride: false);
            }
            catch (Exception exception)
                when (exception is PrefabPropertyApplyUnavailableException ||
                      exception is PrefabPropertyApplyUnsupportedException)
            {
                throw new PrefabPropertyApplyReplayStaleException(
                    "The completed prefab.property.apply target is no longer available or linked as before. " +
                    exception.Message);
            }

            if (!string.Equals(readback.prefabGuid, cached.prefabGuid, StringComparison.Ordinal) ||
                !string.Equals(readback.dependencyHash, cached.dependencyHashAfter, StringComparison.Ordinal) ||
                readback.instanceProperty.prefabOverride ||
                !readback.sourceMatchesInstance)
            {
                throw new PrefabPropertyApplyReplayStaleException(
                    "The completed Prefab property apply no longer matches the current asset/instance state. The same mutationId will not apply a later override automatically.");
            }
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

        private static void ValidateSupportedProperty(SerializedProperty property)
        {
            if (property == null || !property.editable)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "The requested serialized property is unavailable or read-only.");
            }
            if (string.Equals(property.propertyPath, "m_Script", StringComparison.Ordinal) || property.isArray)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    "m_Script and array/container properties are not supported by the first prefab property-apply slice.");
            }
            var supported = property.propertyType == SerializedPropertyType.Boolean ||
                            property.propertyType == SerializedPropertyType.Integer ||
                            property.propertyType == SerializedPropertyType.Float ||
                            property.propertyType == SerializedPropertyType.String ||
                            property.propertyType == SerializedPropertyType.Vector3;
            if (!supported)
            {
                throw new PrefabPropertyApplyUnsupportedException(
                    $"Serialized property '{property.propertyPath}' type '{property.propertyType}' is not supported. " +
                    "This slice supports Boolean, Integer, Float, String, and Vector3 only.");
            }
        }

        private static void ValidatePrefabPath(string prefabPath)
        {
            if (string.IsNullOrWhiteSpace(prefabPath) || prefabPath.Length > MaximumPrefabPathLength ||
                prefabPath.Contains("\\") || prefabPath.StartsWith("/", StringComparison.Ordinal) ||
                prefabPath.Contains("../") || prefabPath.EndsWith("/..", StringComparison.Ordinal) ||
                !prefabPath.StartsWith("Assets/", StringComparison.Ordinal) ||
                !prefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    "prefabPath must be an exact project-relative Assets/.../*.prefab path with forward slashes and no parent traversal.",
                    nameof(prefabPath));
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

        private sealed class ApplyReadback
        {
            public Component component;
            public Component sourceComponent;
            public string componentGlobalObjectId;
            public string gameObjectGlobalObjectId;
            public string prefabGuid;
            public string dependencyHash;
            public SerializedProperty instanceProperty;
            public SerializedProperty sourceProperty;
            public bool sourceMatchesInstance;
        }
    }
}
