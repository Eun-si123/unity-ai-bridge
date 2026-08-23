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
    internal sealed class ComponentSnapshotPayload
    {
        public string globalObjectId;
        public int instanceId;
        public string typeName;
        public string assemblyQualifiedName;
        public string gameObjectGlobalObjectId;
        public int gameObjectInstanceId;
        public string gameObjectName;
        public string sceneName;
        public string scenePath;
        public int componentIndex;
        public string stateEpoch;
        public long stateRevision;
    }

    [Serializable]
    internal sealed class ComponentAddPayload
    {
        public string mutationId;
        public bool replayed;
        public bool added;
        public string requestedGameObjectGlobalObjectId;
        public string requestedTypeName;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public ComponentSnapshotPayload component;
    }

    [Serializable]
    internal sealed class ComponentRemovePayload
    {
        public string mutationId;
        public bool replayed;
        public bool removed;
        public string requestedComponentGlobalObjectId;
        public string deletedTypeName;
        public string deletedAssemblyQualifiedName;
        public string deletedGameObjectGlobalObjectId;
        public string deletedGameObjectName;
        public string deletedSceneName;
        public string deletedScenePath;
        public int deletedComponentIndex;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
    }

    internal sealed class ComponentMutationTargetUnavailableException : InvalidOperationException
    {
        public ComponentMutationTargetUnavailableException(string message) : base(message) { }
    }

    internal sealed class ComponentTypeUnavailableException : InvalidOperationException
    {
        public ComponentTypeUnavailableException(string message) : base(message) { }
    }

    internal sealed class ComponentMutationConflictException : InvalidOperationException
    {
        public ComponentMutationConflictException(string message) : base(message) { }
    }

    internal sealed class ComponentMutationIncompleteException : InvalidOperationException
    {
        public ComponentMutationIncompleteException(string message) : base(message) { }
    }

    internal sealed class ComponentMutationReplayStaleException : InvalidOperationException
    {
        public ComponentMutationReplayStaleException(string message) : base(message) { }
    }

    internal sealed class ComponentMutationReadbackException : InvalidOperationException
    {
        public ComponentMutationReadbackException(string message) : base(message) { }
    }

    internal sealed class ComponentMutationCompilingException : InvalidOperationException
    {
        public ComponentMutationCompilingException(string message) : base(message) { }
    }

    internal static class ComponentMutationSnapshot
    {
        public const int MaximumTypeNameLength = 512;

        internal static Type ResolveAddableType(string typeName)
        {
            if (string.IsNullOrWhiteSpace(typeName))
            {
                throw new ArgumentException("typeName is required.", nameof(typeName));
            }
            if (typeName.Length > MaximumTypeNameLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(typeName),
                    $"typeName must be at most {MaximumTypeNameLength} characters.");
            }

            Type match = null;
            foreach (var candidate in TypeCache.GetTypesDerivedFrom<Component>())
            {
                if (!string.Equals(candidate.FullName, typeName, StringComparison.Ordinal) &&
                    !string.Equals(candidate.AssemblyQualifiedName, typeName, StringComparison.Ordinal))
                {
                    continue;
                }

                if (match != null && match != candidate)
                {
                    throw new ComponentTypeUnavailableException(
                        $"Component type '{typeName}' is ambiguous across loaded Unity assemblies. Use the exact assembly-qualified name.");
                }
                match = candidate;
            }

            if (match == null)
            {
                throw new ComponentTypeUnavailableException(
                    $"Component type '{typeName}' was not found in Unity TypeCache.");
            }
            if (!match.IsClass || match.IsAbstract || match.ContainsGenericParameters)
            {
                throw new ComponentTypeUnavailableException(
                    $"Component type '{typeName}' is not a concrete attachable Component type.");
            }
            if (typeof(Transform).IsAssignableFrom(match))
            {
                throw new ComponentTypeUnavailableException(
                    "component.add does not add or replace Transform/RectTransform components in this slice.");
            }

            return match;
        }

        internal static Component ResolveComponent(
            string globalObjectId,
            out string canonicalGlobalObjectId)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            GlobalObjectId.TryParse(globalObjectId, out var parsed);
            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
            var component = resolved as Component;
            if (component == null)
            {
                throw new ComponentMutationTargetUnavailableException(
                    resolved == null
                        ? "The requested Component target no longer exists or its scene is unavailable."
                        : "component.remove requires a Component GlobalObjectId target.");
            }
            if (component is Transform)
            {
                throw new ComponentMutationTargetUnavailableException(
                    "component.remove does not remove Transform/RectTransform components.");
            }

            canonicalGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString();
            return component;
        }

        internal static ComponentSnapshotPayload Capture(Component component, string canonicalGlobalObjectId)
        {
            if (component == null)
            {
                throw new ArgumentNullException(nameof(component));
            }

            var owner = component.gameObject;
            if (owner == null)
            {
                throw new ComponentMutationTargetUnavailableException(
                    "The Component no longer has an owning GameObject.");
            }

            var ownerGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(owner).ToString();
            var scene = owner.scene;
            var type = component.GetType();
            var components = owner.GetComponents<Component>();
            var componentIndex = -1;
            for (var index = 0; index < components.Length; index++)
            {
                if (ReferenceEquals(components[index], component))
                {
                    componentIndex = index;
                    break;
                }
            }
            if (componentIndex < 0)
            {
                throw new ComponentMutationTargetUnavailableException(
                    "The Component is no longer present in its owning GameObject component list.");
            }

            var state = EditorStateRevision.Capture();
            return new ComponentSnapshotPayload
            {
                globalObjectId = canonicalGlobalObjectId,
                instanceId = component.GetInstanceID(),
                typeName = type.FullName ?? type.Name,
                assemblyQualifiedName = type.AssemblyQualifiedName ?? string.Empty,
                gameObjectGlobalObjectId = ownerGlobalObjectId,
                gameObjectInstanceId = owner.GetInstanceID(),
                gameObjectName = owner.name ?? string.Empty,
                sceneName = scene.IsValid() ? scene.name ?? string.Empty : string.Empty,
                scenePath = scene.IsValid() ? scene.path ?? string.Empty : string.Empty,
                componentIndex = componentIndex,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
            };
        }

        internal static bool Matches(
            ComponentSnapshotPayload snapshot,
            string expectedComponentGlobalObjectId,
            string expectedGameObjectGlobalObjectId,
            string expectedTypeName)
        {
            return snapshot != null &&
                string.Equals(snapshot.globalObjectId, expectedComponentGlobalObjectId, StringComparison.Ordinal) &&
                string.Equals(snapshot.gameObjectGlobalObjectId, expectedGameObjectGlobalObjectId, StringComparison.Ordinal) &&
                string.Equals(snapshot.typeName, expectedTypeName, StringComparison.Ordinal);
        }

        internal static void RequireActiveSceneOwner(
            Component component,
            Scene activeScene,
            string operation)
        {
            if (component == null || component.gameObject == null || component.gameObject.scene != activeScene)
            {
                throw new ComponentMutationTargetUnavailableException(
                    $"{operation} currently requires the Component owner to belong to the active scene.");
            }
        }
    }

    internal static class ComponentAddCommand
    {
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.ComponentAdd.";
        private const string UndoGroupName = "Unity AI Bridge: Add Component";

        public static void ValidateArguments(
            string gameObjectGlobalObjectId,
            string typeName,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(gameObjectGlobalObjectId);
            ComponentMutationSnapshot.ResolveAddableType(typeName);
            GameObjectUpdateCommand.ValidateMutationId(mutationId);
            GameObjectUpdateCommand.RequireStateExpectation(
                expectedStateEpoch,
                expectedStateRevision,
                "component.add");
        }

        public static ComponentAddPayload Execute(
            string gameObjectGlobalObjectId,
            string typeName,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                gameObjectGlobalObjectId,
                typeName,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new ComponentMutationCompilingException(
                    "Unity is compiling; component.add was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<ComponentAddPayload>(cachedJson);
                if (cached == null || cached.component == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached component.add mutation result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    gameObjectGlobalObjectId,
                    typeName,
                    expectedStateEpoch,
                    expectedStateRevision);

                ComponentSnapshotPayload replayReadback;
                try
                {
                    var component = ComponentMutationSnapshot.ResolveComponent(
                        cached.component.globalObjectId,
                        out var canonicalComponentGlobalObjectId);
                    replayReadback = ComponentMutationSnapshot.Capture(
                        component,
                        canonicalComponentGlobalObjectId);
                }
                catch (ComponentMutationTargetUnavailableException exception)
                {
                    throw new ComponentMutationReplayStaleException(
                        "The cached component.add target is no longer available, for example after Undo. " + exception.Message);
                }

                if (!ComponentMutationSnapshot.Matches(
                        replayReadback,
                        cached.component.globalObjectId,
                        cached.component.gameObjectGlobalObjectId,
                        cached.component.typeName))
                {
                    throw new ComponentMutationReplayStaleException(
                        "The cached component.add result no longer matches native Component type/ownership. " +
                        "The same mutationId will not add another Component automatically.");
                }

                cached.component = replayReadback;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<AddMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "component.add",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        gameObjectGlobalObjectId,
                        typeName,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(context, gameObjectGlobalObjectId, typeName),
                    (_, state) => VerifyMutation(state),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new ComponentMutationCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new ComponentMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new ComponentMutationIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new ComponentMutationReadbackException(exception.Message);
            }

            if (!execution.outcome.changed || !execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException(
                    "component.add transaction returned an inconsistent successful verification outcome.");
            }

            var stateAfter = EditorStateRevision.Capture();
            execution.value.readback.stateEpoch = stateAfter.epoch;
            execution.value.readback.stateRevision = stateAfter.revision;
            var result = new ComponentAddPayload
            {
                mutationId = mutationId,
                replayed = false,
                added = true,
                requestedGameObjectGlobalObjectId = gameObjectGlobalObjectId,
                requestedTypeName = typeName,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                component = execution.value.readback,
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string gameObjectGlobalObjectId,
            string typeName,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return string.Join(
                "|",
                "owner:" + gameObjectGlobalObjectId,
                "type:" + typeName.Length.ToString(CultureInfo.InvariantCulture) + ":" + typeName,
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        private static AddMutationState Mutate(
            EditorMutationContext context,
            string requestedGameObjectGlobalObjectId,
            string requestedTypeName)
        {
            var gameObject = GameObjectSnapshotCommand.ResolveGameObject(
                requestedGameObjectGlobalObjectId,
                out var canonicalGameObjectGlobalObjectId);
            GameObjectUpdateCommand.RequireActiveSceneTarget(
                gameObject,
                context.activeScene,
                "component.add");

            var type = ComponentMutationSnapshot.ResolveAddableType(requestedTypeName);
            var component = Undo.AddComponent(gameObject, type);
            if (component == null)
            {
                throw new ComponentMutationTargetUnavailableException(
                    $"Unity did not return a Component after adding '{requestedTypeName}'.");
            }

            context.MarkUndoRecorded();
            EditorSceneManager.MarkSceneDirty(context.activeScene);
            var componentGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString();

            return new AddMutationState
            {
                componentGlobalObjectId = componentGlobalObjectId,
                gameObjectGlobalObjectId = canonicalGameObjectGlobalObjectId,
                typeName = type.FullName ?? type.Name,
                readback = null,
            };
        }

        private static bool VerifyMutation(AddMutationState state)
        {
            if (state == null || string.IsNullOrEmpty(state.componentGlobalObjectId))
            {
                return false;
            }

            try
            {
                var component = ComponentMutationSnapshot.ResolveComponent(
                    state.componentGlobalObjectId,
                    out var canonicalComponentGlobalObjectId);
                state.readback = ComponentMutationSnapshot.Capture(
                    component,
                    canonicalComponentGlobalObjectId);
            }
            catch (ComponentMutationTargetUnavailableException)
            {
                return false;
            }

            return ComponentMutationSnapshot.Matches(
                state.readback,
                state.componentGlobalObjectId,
                state.gameObjectGlobalObjectId,
                state.typeName);
        }

        private static bool VerifyRollback(AddMutationState state)
        {
            if (state == null || string.IsNullOrEmpty(state.componentGlobalObjectId))
            {
                return false;
            }

            var readback = ObjectResolverCommand.Execute(state.componentGlobalObjectId);
            return !readback.found;
        }

        private static void EnsureSameIntent(
            ComponentAddPayload cached,
            string gameObjectGlobalObjectId,
            string typeName,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.requestedGameObjectGlobalObjectId, gameObjectGlobalObjectId, StringComparison.Ordinal) ||
                !string.Equals(cached.requestedTypeName, typeName, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new ComponentMutationConflictException(
                    "mutationId was already used for component.add with different owner, type, or state preconditions.");
            }
        }

        private sealed class AddMutationState
        {
            public string componentGlobalObjectId;
            public string gameObjectGlobalObjectId;
            public string typeName;
            public ComponentSnapshotPayload readback;
        }
    }

    internal static class ComponentRemoveCommand
    {
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.ComponentRemove.";
        private const string UndoGroupName = "Unity AI Bridge: Remove Component";

        public static void ValidateArguments(
            string componentGlobalObjectId,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(componentGlobalObjectId);
            GameObjectUpdateCommand.ValidateMutationId(mutationId);
            GameObjectUpdateCommand.RequireStateExpectation(
                expectedStateEpoch,
                expectedStateRevision,
                "component.remove");
        }

        public static ComponentRemovePayload Execute(
            string componentGlobalObjectId,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                componentGlobalObjectId,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new ComponentMutationCompilingException(
                    "Unity is compiling; component.remove was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<ComponentRemovePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached component.remove mutation result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    componentGlobalObjectId,
                    expectedStateEpoch,
                    expectedStateRevision);

                var activeScene = SceneManager.GetActiveScene();
                if (!activeScene.IsValid() || !activeScene.isLoaded ||
                    !string.Equals(activeScene.path ?? string.Empty, cached.deletedScenePath, StringComparison.Ordinal))
                {
                    throw new ComponentMutationReplayStaleException(
                        "The active scene no longer matches the scene in which the cached component.remove completed.");
                }

                var readback = ObjectResolverCommand.Execute(cached.requestedComponentGlobalObjectId);
                if (readback.found)
                {
                    throw new ComponentMutationReplayStaleException(
                        "The cached component.remove target exists again, for example after Undo. " +
                        "The same mutationId will not remove it a second time automatically.");
                }

                var currentState = EditorStateRevision.Capture();
                cached.stateEpoch = currentState.epoch;
                cached.stateRevision = currentState.revision;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<RemoveMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "component.remove",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        componentGlobalObjectId,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(context, componentGlobalObjectId),
                    (_, state) => VerifyMutation(state),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new ComponentMutationCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new ComponentMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new ComponentMutationIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new ComponentMutationReadbackException(exception.Message);
            }

            if (!execution.outcome.changed || !execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException(
                    "component.remove transaction returned an inconsistent successful verification outcome.");
            }

            var stateAfter = EditorStateRevision.Capture();
            var original = execution.value.original;
            var result = new ComponentRemovePayload
            {
                mutationId = mutationId,
                replayed = false,
                removed = true,
                requestedComponentGlobalObjectId = componentGlobalObjectId,
                deletedTypeName = original.typeName,
                deletedAssemblyQualifiedName = original.assemblyQualifiedName,
                deletedGameObjectGlobalObjectId = original.gameObjectGlobalObjectId,
                deletedGameObjectName = original.gameObjectName,
                deletedSceneName = original.sceneName,
                deletedScenePath = original.scenePath,
                deletedComponentIndex = original.componentIndex,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                stateEpoch = stateAfter.epoch,
                stateRevision = stateAfter.revision,
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string componentGlobalObjectId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return string.Join(
                "|",
                "target:" + componentGlobalObjectId,
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        private static RemoveMutationState Mutate(
            EditorMutationContext context,
            string requestedComponentGlobalObjectId)
        {
            var component = ComponentMutationSnapshot.ResolveComponent(
                requestedComponentGlobalObjectId,
                out var canonicalComponentGlobalObjectId);
            ComponentMutationSnapshot.RequireActiveSceneOwner(
                component,
                context.activeScene,
                "component.remove");

            var original = ComponentMutationSnapshot.Capture(
                component,
                canonicalComponentGlobalObjectId);
            Undo.DestroyObjectImmediate(component);
            context.MarkUndoRecorded();
            EditorSceneManager.MarkSceneDirty(context.activeScene);

            return new RemoveMutationState
            {
                componentGlobalObjectId = canonicalComponentGlobalObjectId,
                original = original,
            };
        }

        private static bool VerifyMutation(RemoveMutationState state)
        {
            if (state == null || string.IsNullOrEmpty(state.componentGlobalObjectId))
            {
                return false;
            }

            var readback = ObjectResolverCommand.Execute(state.componentGlobalObjectId);
            return !readback.found;
        }

        private static bool VerifyRollback(RemoveMutationState state)
        {
            if (state == null || state.original == null || string.IsNullOrEmpty(state.componentGlobalObjectId))
            {
                return false;
            }

            ComponentSnapshotPayload readback;
            try
            {
                var component = ComponentMutationSnapshot.ResolveComponent(
                    state.componentGlobalObjectId,
                    out var canonicalComponentGlobalObjectId);
                readback = ComponentMutationSnapshot.Capture(component, canonicalComponentGlobalObjectId);
            }
            catch (ComponentMutationTargetUnavailableException)
            {
                return false;
            }

            return ComponentMutationSnapshot.Matches(
                    readback,
                    state.original.globalObjectId,
                    state.original.gameObjectGlobalObjectId,
                    state.original.typeName) &&
                readback.componentIndex == state.original.componentIndex &&
                string.Equals(readback.scenePath, state.original.scenePath, StringComparison.Ordinal);
        }

        private static void EnsureSameIntent(
            ComponentRemovePayload cached,
            string componentGlobalObjectId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.requestedComponentGlobalObjectId, componentGlobalObjectId, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new ComponentMutationConflictException(
                    "mutationId was already used for component.remove with different target or state preconditions.");
            }
        }

        private sealed class RemoveMutationState
        {
            public string componentGlobalObjectId;
            public ComponentSnapshotPayload original;
        }
    }
}
