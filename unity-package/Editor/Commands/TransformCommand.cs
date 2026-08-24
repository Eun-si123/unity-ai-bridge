using System;
using System.Globalization;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class TransformVector3Payload
    {
        public float x;
        public float y;
        public float z;

        public static TransformVector3Payload From(Vector3 value)
        {
            return new TransformVector3Payload { x = value.x, y = value.y, z = value.z };
        }

        public Vector3 ToVector3()
        {
            return new Vector3(x, y, z);
        }
    }

    [Serializable]
    internal sealed class TransformQuaternionPayload
    {
        public float x;
        public float y;
        public float z;
        public float w;

        public static TransformQuaternionPayload From(Quaternion value)
        {
            return new TransformQuaternionPayload
            {
                x = value.x,
                y = value.y,
                z = value.z,
                w = value.w,
            };
        }
    }

    [Serializable]
    internal sealed class TransformSnapshotPayload
    {
        public string globalObjectId;
        public int instanceId;
        public string name;
        public string sceneName;
        public string scenePath;
        public string hierarchyPath;
        public bool sceneIsDirty;
        public TransformVector3Payload localPosition;
        public TransformVector3Payload localEulerAngles;
        public TransformQuaternionPayload localRotation;
        public TransformVector3Payload localScale;
        public TransformVector3Payload worldPosition;
        public TransformQuaternionPayload worldRotation;
        public TransformVector3Payload lossyScale;
        public string stateEpoch;
        public long stateRevision;
    }

    [Serializable]
    internal sealed class TransformSetPayload
    {
        public string mutationId;
        public bool replayed;
        public string requestedGlobalObjectId;
        public TransformVector3Payload requestedLocalPosition;
        public TransformVector3Payload requestedLocalEulerAngles;
        public TransformVector3Payload requestedLocalScale;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public TransformSnapshotPayload transform;
    }

    internal sealed class TransformTargetUnavailableException : InvalidOperationException
    {
        public TransformTargetUnavailableException(string message)
            : base(message)
        {
        }
    }

    internal sealed class TransformMutationConflictException : InvalidOperationException
    {
        public TransformMutationConflictException(string message)
            : base(message)
        {
        }
    }

    internal sealed class TransformIncompleteException : InvalidOperationException
    {
        public TransformIncompleteException(string message)
            : base(message)
        {
        }
    }

    internal sealed class TransformReplayStaleException : InvalidOperationException
    {
        public TransformReplayStaleException(string message)
            : base(message)
        {
        }
    }

    internal sealed class TransformReadbackException : InvalidOperationException
    {
        public TransformReadbackException(string message)
            : base(message)
        {
        }
    }

    internal sealed class TransformCompilingException : InvalidOperationException
    {
        public TransformCompilingException(string message)
            : base(message)
        {
        }
    }

    internal static class TransformGetCommand
    {
        public static TransformSnapshotPayload Execute(string globalObjectId)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
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
                throw new TransformTargetUnavailableException(
                    resolved == null
                        ? "The requested transform target no longer exists or its scene is unavailable."
                        : "transform operations currently require a GameObject GlobalObjectId target.");
            }

            canonicalGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject).ToString();
            return gameObject;
        }

        internal static TransformSnapshotPayload Capture(
            GameObject gameObject,
            string canonicalGlobalObjectId)
        {
            if (gameObject == null)
            {
                throw new ArgumentNullException(nameof(gameObject));
            }

            var transform = gameObject.transform;
            var scene = gameObject.scene;
            var state = EditorStateRevision.Capture();
            return new TransformSnapshotPayload
            {
                globalObjectId = canonicalGlobalObjectId,
                instanceId = gameObject.GetInstanceID(),
                name = gameObject.name ?? string.Empty,
                sceneName = scene.IsValid() ? scene.name ?? string.Empty : string.Empty,
                scenePath = scene.IsValid() ? scene.path ?? string.Empty : string.Empty,
                hierarchyPath = BuildHierarchyPath(transform),
                sceneIsDirty = scene.IsValid() && scene.isDirty,
                localPosition = TransformVector3Payload.From(transform.localPosition),
                localEulerAngles = TransformVector3Payload.From(transform.localEulerAngles),
                localRotation = TransformQuaternionPayload.From(transform.localRotation),
                localScale = TransformVector3Payload.From(transform.localScale),
                worldPosition = TransformVector3Payload.From(transform.position),
                worldRotation = TransformQuaternionPayload.From(transform.rotation),
                lossyScale = TransformVector3Payload.From(transform.lossyScale),
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

    internal static class TransformSetCommand
    {
        public const int MaximumMutationIdLength = 128;
        internal const float VectorTolerance = 0.0001f;
        internal const float RotationToleranceDegrees = 0.001f;

        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.TransformSet.";
        private const string UndoGroupName = "Unity AI Bridge: Set Transform";

        public static void ValidateArguments(
            string globalObjectId,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            ValidateVector(localPosition, nameof(localPosition));
            ValidateVector(localEulerAngles, nameof(localEulerAngles));
            ValidateVector(localScale, nameof(localScale));
            ValidateMutationId(mutationId);

            if (string.IsNullOrWhiteSpace(expectedStateEpoch) || expectedStateRevision <= 0)
            {
                throw new ArgumentException(
                    "transform.set requires expectedStateEpoch and a positive expectedStateRevision from a recent Unity observation.");
            }

            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
        }

        public static TransformSetPayload Execute(
            string globalObjectId,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                globalObjectId,
                localPosition,
                localEulerAngles,
                localScale,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new TransformCompilingException(
                    "Unity is compiling; transform.set was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<TransformSetPayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached transform.set mutation result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    globalObjectId,
                    localPosition,
                    localEulerAngles,
                    localScale,
                    expectedStateEpoch,
                    expectedStateRevision);

                TransformSnapshotPayload replayReadback;
                try
                {
                    replayReadback = TransformGetCommand.Execute(cached.transform.globalObjectId);
                }
                catch (TransformTargetUnavailableException exception)
                {
                    throw new TransformReplayStaleException(
                        "The cached transform.set target is no longer available. " + exception.Message);
                }

                if (!SnapshotMatchesRequested(
                    replayReadback,
                    localPosition,
                    localEulerAngles,
                    localScale))
                {
                    throw new TransformReplayStaleException(
                        "The cached transform.set target no longer has the completed transform. " +
                        "The same mutationId will not reapply it automatically.");
                }

                cached.transform = replayReadback;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<TransformMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "transform.set",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        globalObjectId,
                        localPosition,
                        localEulerAngles,
                        localScale,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(
                        context,
                        globalObjectId,
                        localPosition,
                        localEulerAngles,
                        localScale),
                    (_, state) => VerifyMutation(
                        state,
                        localPosition,
                        localEulerAngles,
                        localScale),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new TransformCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new TransformMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new TransformIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new TransformReadbackException(exception.Message);
            }

            if (!execution.outcome.changed || !execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException(
                    "transform.set transaction returned an inconsistent successful verification outcome.");
            }

            var stateAfter = EditorStateRevision.Capture();
            var readback = execution.value.readback;
            readback.stateEpoch = stateAfter.epoch;
            readback.stateRevision = stateAfter.revision;
            readback.sceneIsDirty = execution.value.gameObject.scene.IsValid() &&
                execution.value.gameObject.scene.isDirty;

            var result = new TransformSetPayload
            {
                mutationId = mutationId,
                replayed = false,
                requestedGlobalObjectId = globalObjectId,
                requestedLocalPosition = Copy(localPosition),
                requestedLocalEulerAngles = Copy(localEulerAngles),
                requestedLocalScale = Copy(localScale),
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                transform = readback,
            };

            // The common lifecycle is already terminal at this point. Persisting the operation-specific
            // replay payload afterwards preserves the fail-closed reload gap used by the other writes.
            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string globalObjectId,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return string.Join(
                "|",
                "target:" + globalObjectId,
                "position:" + FormatVector(localPosition),
                "euler:" + FormatVector(localEulerAngles),
                "scale:" + FormatVector(localScale),
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        internal static bool SnapshotMatchesRequested(
            TransformSnapshotPayload snapshot,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale)
        {
            if (snapshot == null)
            {
                return false;
            }

            return VectorApproximately(snapshot.localPosition, localPosition) &&
                RotationApproximately(snapshot.localRotation, localEulerAngles) &&
                VectorApproximately(snapshot.localScale, localScale);
        }

        private static TransformMutationState Mutate(
            EditorMutationContext context,
            string requestedGlobalObjectId,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale)
        {
            var gameObject = TransformGetCommand.ResolveGameObject(
                requestedGlobalObjectId,
                out var canonicalGlobalObjectId);
            if (gameObject.scene != context.activeScene)
            {
                throw new TransformTargetUnavailableException(
                    "transform.set currently requires the target GameObject to belong to the active scene.");
            }

            var transform = gameObject.transform;
            var original = new NativeTransformState
            {
                localPosition = transform.localPosition,
                localRotation = transform.localRotation,
                localScale = transform.localScale,
            };

            Undo.RecordObject(transform, context.undoGroupName);
            context.MarkUndoRecorded();

            transform.localPosition = localPosition.ToVector3();
            transform.localRotation = Quaternion.Euler(localEulerAngles.ToVector3());
            transform.localScale = localScale.ToVector3();
            if (PrefabUtility.IsPartOfNonAssetPrefabInstance(transform))
            {
                PrefabUtility.RecordPrefabInstancePropertyModifications(transform);
            }
            EditorSceneManager.MarkSceneDirty(context.activeScene);

            return new TransformMutationState
            {
                gameObject = gameObject,
                globalObjectId = canonicalGlobalObjectId,
                original = original,
                readback = null,
            };
        }

        private static bool VerifyMutation(
            TransformMutationState state,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale)
        {
            if (state == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            try
            {
                state.readback = TransformGetCommand.Execute(state.globalObjectId);
            }
            catch (TransformTargetUnavailableException)
            {
                return false;
            }

            return state.readback != null &&
                string.Equals(
                    state.readback.globalObjectId,
                    state.globalObjectId,
                    StringComparison.Ordinal) &&
                SnapshotMatchesRequested(
                    state.readback,
                    localPosition,
                    localEulerAngles,
                    localScale);
        }

        private static bool VerifyRollback(TransformMutationState state)
        {
            if (state == null || state.original == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            GameObject gameObject;
            try
            {
                gameObject = TransformGetCommand.ResolveGameObject(state.globalObjectId, out _);
            }
            catch (TransformTargetUnavailableException)
            {
                return false;
            }

            var transform = gameObject.transform;
            return VectorApproximately(transform.localPosition, state.original.localPosition) &&
                Quaternion.Angle(transform.localRotation, state.original.localRotation) <= RotationToleranceDegrees &&
                VectorApproximately(transform.localScale, state.original.localScale);
        }

        private static void EnsureSameIntent(
            TransformSetPayload cached,
            string globalObjectId,
            TransformVector3Payload localPosition,
            TransformVector3Payload localEulerAngles,
            TransformVector3Payload localScale,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.requestedGlobalObjectId, globalObjectId, StringComparison.Ordinal) ||
                !ExactVector(cached.requestedLocalPosition, localPosition) ||
                !ExactVector(cached.requestedLocalEulerAngles, localEulerAngles) ||
                !ExactVector(cached.requestedLocalScale, localScale) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new TransformMutationConflictException(
                    "mutationId was already used for transform.set with different target, values, or state preconditions.");
            }
        }

        private static bool VectorApproximately(
            TransformVector3Payload left,
            TransformVector3Payload right)
        {
            return left != null && right != null &&
                Mathf.Abs(left.x - right.x) <= VectorTolerance &&
                Mathf.Abs(left.y - right.y) <= VectorTolerance &&
                Mathf.Abs(left.z - right.z) <= VectorTolerance;
        }

        private static bool VectorApproximately(Vector3 left, Vector3 right)
        {
            return Mathf.Abs(left.x - right.x) <= VectorTolerance &&
                Mathf.Abs(left.y - right.y) <= VectorTolerance &&
                Mathf.Abs(left.z - right.z) <= VectorTolerance;
        }

        private static bool VectorApproximately(
            TransformVector3Payload left,
            Vector3 right)
        {
            return left != null &&
                Mathf.Abs(left.x - right.x) <= VectorTolerance &&
                Mathf.Abs(left.y - right.y) <= VectorTolerance &&
                Mathf.Abs(left.z - right.z) <= VectorTolerance;
        }

        private static bool RotationApproximately(
            TransformQuaternionPayload actual,
            TransformVector3Payload requestedEuler)
        {
            if (actual == null || requestedEuler == null)
            {
                return false;
            }

            var actualQuaternion = new Quaternion(actual.x, actual.y, actual.z, actual.w);
            var requestedQuaternion = Quaternion.Euler(requestedEuler.ToVector3());
            return Quaternion.Angle(actualQuaternion, requestedQuaternion) <= RotationToleranceDegrees;
        }

        private static bool ExactVector(
            TransformVector3Payload left,
            TransformVector3Payload right)
        {
            return left != null && right != null &&
                left.x.Equals(right.x) &&
                left.y.Equals(right.y) &&
                left.z.Equals(right.z);
        }

        private static TransformVector3Payload Copy(TransformVector3Payload value)
        {
            return new TransformVector3Payload { x = value.x, y = value.y, z = value.z };
        }

        private static string FormatVector(TransformVector3Payload value)
        {
            return string.Join(
                ",",
                value.x.ToString("R", CultureInfo.InvariantCulture),
                value.y.ToString("R", CultureInfo.InvariantCulture),
                value.z.ToString("R", CultureInfo.InvariantCulture));
        }

        private static void ValidateVector(TransformVector3Payload value, string name)
        {
            if (value == null)
            {
                throw new ArgumentNullException(name);
            }

            if (!IsFinite(value.x) || !IsFinite(value.y) || !IsFinite(value.z))
            {
                throw new ArgumentException(name + " must contain only finite numeric values.", name);
            }
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
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

        private sealed class TransformMutationState
        {
            public GameObject gameObject;
            public string globalObjectId;
            public NativeTransformState original;
            public TransformSnapshotPayload readback;
        }

        private sealed class NativeTransformState
        {
            public Vector3 localPosition;
            public Quaternion localRotation;
            public Vector3 localScale;
        }
    }
}
