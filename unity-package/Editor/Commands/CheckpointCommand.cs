using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class CheckpointSnapshotPayload
    {
        public string checkpointId;
        public string globalObjectId;
        public string scenePath;
        public string parentGlobalObjectId;
        public string name;
        public bool activeSelf;
        public TransformVector3Payload localPosition;
        public TransformVector3Payload localEulerAngles;
        public TransformQuaternionPayload localRotation;
        public TransformVector3Payload localScale;
        public string capturedStateEpoch;
        public long capturedStateRevision;
        public long capturedUnixMs;
        public int retainedCheckpointCount;
        public int maximumRetainedCheckpoints;
    }

    [Serializable]
    internal sealed class CheckpointRestorePayload
    {
        public string checkpointId;
        public string mutationId;
        public bool replayed;
        public bool changed;
        public string requestedGlobalObjectId;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public GameObjectSnapshotPayload gameObject;
        public TransformSnapshotPayload transform;
    }

    [Serializable]
    internal sealed class CheckpointIndexPayload
    {
        public string[] checkpointIds;
    }

    internal sealed class CheckpointNotFoundException : InvalidOperationException
    {
        public CheckpointNotFoundException(string message) : base(message) { }
    }

    internal sealed class CheckpointUnavailableException : InvalidOperationException
    {
        public CheckpointUnavailableException(string message) : base(message) { }
    }

    internal sealed class CheckpointMutationConflictException : InvalidOperationException
    {
        public CheckpointMutationConflictException(string message) : base(message) { }
    }

    internal sealed class CheckpointIncompleteException : InvalidOperationException
    {
        public CheckpointIncompleteException(string message) : base(message) { }
    }

    internal sealed class CheckpointReplayStaleException : InvalidOperationException
    {
        public CheckpointReplayStaleException(string message) : base(message) { }
    }

    internal sealed class CheckpointReadbackException : InvalidOperationException
    {
        public CheckpointReadbackException(string message) : base(message) { }
    }

    internal sealed class CheckpointCompilingException : InvalidOperationException
    {
        public CheckpointCompilingException(string message) : base(message) { }
    }

    internal static class CheckpointStore
    {
        public const int MaximumRetainedCheckpoints = 16;

        private const string EntryKeyPrefix = "UnityAiBridge.Checkpoint.v1.";
        private const string IndexKey = "UnityAiBridge.Checkpoint.Index.v1";
        private const string CheckpointPrefix = "cp-";
        private const int Sha256HexLength = 64;

        public static CheckpointSnapshotPayload Capture(string globalObjectId)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            if (EditorApplication.isCompiling)
            {
                throw new CheckpointCompilingException(
                    "Unity is compiling; checkpoint.capture was not executed.");
            }

            var gameObject = GameObjectSnapshotCommand.ResolveGameObject(
                globalObjectId,
                out var canonicalGlobalObjectId);
            var activeScene = SceneManager.GetActiveScene();
            RequirePersistentActiveSceneTarget(gameObject, activeScene, "checkpoint.capture");

            var state = EditorStateRevision.Capture();
            var transform = gameObject.transform;
            var checkpoint = new CheckpointSnapshotPayload
            {
                checkpointId = string.Empty,
                globalObjectId = canonicalGlobalObjectId,
                scenePath = activeScene.path,
                parentGlobalObjectId = CaptureParentGlobalObjectId(transform.parent),
                name = gameObject.name ?? string.Empty,
                activeSelf = gameObject.activeSelf,
                localPosition = TransformVector3Payload.From(transform.localPosition),
                localEulerAngles = TransformVector3Payload.From(transform.localEulerAngles),
                localRotation = TransformQuaternionPayload.From(transform.localRotation),
                localScale = TransformVector3Payload.From(transform.localScale),
                capturedStateEpoch = state.epoch,
                capturedStateRevision = state.revision,
                capturedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                retainedCheckpointCount = 0,
                maximumRetainedCheckpoints = MaximumRetainedCheckpoints,
            };
            checkpoint.checkpointId = ComputeCheckpointId(checkpoint);
            Persist(checkpoint);
            ApplyRetentionMetadata(checkpoint);
            return checkpoint;
        }

        public static CheckpointSnapshotPayload Get(string checkpointId)
        {
            ValidateCheckpointId(checkpointId);
            var json = SessionState.GetString(EntryKeyPrefix + checkpointId, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                throw new CheckpointNotFoundException(
                    "The requested checkpoint is not retained in the current Unity Editor session.");
            }

            var checkpoint = JsonUtility.FromJson<CheckpointSnapshotPayload>(json);
            if (checkpoint == null ||
                !string.Equals(checkpoint.checkpointId, checkpointId, StringComparison.Ordinal) ||
                string.IsNullOrEmpty(checkpoint.globalObjectId) ||
                string.IsNullOrEmpty(checkpoint.scenePath))
            {
                throw new InvalidOperationException("The retained checkpoint record is invalid.");
            }

            ApplyRetentionMetadata(checkpoint);
            return checkpoint;
        }

        public static void ValidateCheckpointId(string checkpointId)
        {
            if (string.IsNullOrWhiteSpace(checkpointId) ||
                checkpointId.Length != CheckpointPrefix.Length + Sha256HexLength ||
                !checkpointId.StartsWith(CheckpointPrefix, StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "checkpointId must be the exact deterministic id returned by checkpoint.capture.",
                    nameof(checkpointId));
            }

            for (var index = CheckpointPrefix.Length; index < checkpointId.Length; index++)
            {
                var value = checkpointId[index];
                var isHex =
                    (value >= '0' && value <= '9') ||
                    (value >= 'a' && value <= 'f');
                if (!isHex)
                {
                    throw new ArgumentException(
                        "checkpointId must be the exact lowercase SHA-256 id returned by checkpoint.capture.",
                        nameof(checkpointId));
                }
            }
        }

        internal static string CaptureParentGlobalObjectId(Transform parent)
        {
            return parent == null
                ? string.Empty
                : GlobalObjectId.GetGlobalObjectIdSlow(parent.gameObject).ToString();
        }

        internal static void RequirePersistentActiveSceneTarget(
            GameObject gameObject,
            Scene activeScene,
            string operation)
        {
            if (gameObject == null ||
                !activeScene.IsValid() ||
                !activeScene.isLoaded ||
                gameObject.scene != activeScene)
            {
                throw new CheckpointUnavailableException(
                    $"{operation} requires the target GameObject to belong to the active loaded scene.");
            }

            if (string.IsNullOrEmpty(activeScene.path))
            {
                throw new CheckpointUnavailableException(
                    $"{operation} requires a saved active Scene so the target identity remains durable.");
            }
        }

        internal static string ComputeCheckpointId(CheckpointSnapshotPayload checkpoint)
        {
            if (checkpoint == null)
            {
                throw new ArgumentNullException(nameof(checkpoint));
            }

            var identity = string.Join(
                "|",
                "v1",
                checkpoint.globalObjectId ?? string.Empty,
                checkpoint.scenePath ?? string.Empty,
                checkpoint.parentGlobalObjectId ?? string.Empty,
                checkpoint.name ?? string.Empty,
                checkpoint.activeSelf ? "1" : "0",
                FormatVector(checkpoint.localPosition),
                FormatQuaternion(checkpoint.localRotation),
                FormatVector(checkpoint.localScale),
                checkpoint.capturedStateEpoch ?? string.Empty,
                checkpoint.capturedStateRevision.ToString(CultureInfo.InvariantCulture));

            using (var sha256 = SHA256.Create())
            {
                var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(identity));
                var builder = new StringBuilder(CheckpointPrefix, CheckpointPrefix.Length + Sha256HexLength);
                for (var index = 0; index < hash.Length; index++)
                {
                    builder.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }

        private static void Persist(CheckpointSnapshotPayload checkpoint)
        {
            SessionState.SetString(
                EntryKeyPrefix + checkpoint.checkpointId,
                JsonUtility.ToJson(checkpoint));

            var ids = ReadIndex();
            ids.Remove(checkpoint.checkpointId);
            ids.Insert(0, checkpoint.checkpointId);
            while (ids.Count > MaximumRetainedCheckpoints)
            {
                var evicted = ids[ids.Count - 1];
                ids.RemoveAt(ids.Count - 1);
                SessionState.EraseString(EntryKeyPrefix + evicted);
            }
            WriteIndex(ids);
        }

        private static List<string> ReadIndex()
        {
            var json = SessionState.GetString(IndexKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return new List<string>();
            }

            var payload = JsonUtility.FromJson<CheckpointIndexPayload>(json);
            return payload != null && payload.checkpointIds != null
                ? new List<string>(payload.checkpointIds)
                : new List<string>();
        }

        private static void WriteIndex(List<string> ids)
        {
            SessionState.SetString(
                IndexKey,
                JsonUtility.ToJson(new CheckpointIndexPayload
                {
                    checkpointIds = ids.ToArray(),
                }));
        }

        private static void ApplyRetentionMetadata(CheckpointSnapshotPayload checkpoint)
        {
            checkpoint.retainedCheckpointCount = ReadIndex().Count;
            checkpoint.maximumRetainedCheckpoints = MaximumRetainedCheckpoints;
        }

        private static string FormatVector(TransformVector3Payload value)
        {
            return value == null
                ? string.Empty
                : string.Join(
                    ",",
                    value.x.ToString("R", CultureInfo.InvariantCulture),
                    value.y.ToString("R", CultureInfo.InvariantCulture),
                    value.z.ToString("R", CultureInfo.InvariantCulture));
        }

        private static string FormatQuaternion(TransformQuaternionPayload value)
        {
            return value == null
                ? string.Empty
                : string.Join(
                    ",",
                    value.x.ToString("R", CultureInfo.InvariantCulture),
                    value.y.ToString("R", CultureInfo.InvariantCulture),
                    value.z.ToString("R", CultureInfo.InvariantCulture),
                    value.w.ToString("R", CultureInfo.InvariantCulture));
        }
    }

    internal static class CheckpointRestoreCommand
    {
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.CheckpointRestore.";
        private const string UndoGroupName = "Unity AI Bridge: Restore Checkpoint";
        private const float VectorTolerance = 0.0001f;
        private const float RotationToleranceDegrees = 0.001f;

        public static void ValidateArguments(
            string checkpointId,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            CheckpointStore.ValidateCheckpointId(checkpointId);
            GameObjectUpdateCommand.ValidateMutationId(mutationId);
            GameObjectUpdateCommand.RequireStateExpectation(
                expectedStateEpoch,
                expectedStateRevision,
                "checkpoint.restore");
        }

        public static CheckpointRestorePayload Execute(
            string checkpointId,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                checkpointId,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new CheckpointCompilingException(
                    "Unity is compiling; checkpoint.restore was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<CheckpointRestorePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached checkpoint.restore result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    checkpointId,
                    expectedStateEpoch,
                    expectedStateRevision);
                var checkpoint = CheckpointStore.Get(checkpointId);
                var readback = CaptureVerifiedReadback(checkpoint, "checkpoint.restore replay");
                if (!ReadbackMatchesCheckpoint(readback, checkpoint))
                {
                    throw new CheckpointReplayStaleException(
                        "The checkpoint.restore target no longer matches the completed checkpoint state. " +
                        "The same mutationId will not reapply the restore automatically.");
                }

                cached.gameObject = readback.gameObject;
                cached.transform = readback.transform;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            var checkpointToRestore = CheckpointStore.Get(checkpointId);
            EditorMutationExecution<RestoreMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "checkpoint.restore",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        checkpointToRestore,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(context, checkpointToRestore),
                    (_, state) => VerifyMutation(state, checkpointToRestore),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new CheckpointCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new CheckpointMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new CheckpointIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new CheckpointReadbackException(exception.Message);
            }

            if (!execution.outcome.verified || execution.outcome.rolledBack)
            {
                throw new InvalidOperationException(
                    "checkpoint.restore transaction returned an inconsistent successful verification outcome.");
            }

            var readbackState = execution.value.readback;
            var currentState = EditorStateRevision.Capture();
            readbackState.gameObject.stateEpoch = currentState.epoch;
            readbackState.gameObject.stateRevision = currentState.revision;
            readbackState.transform.stateEpoch = currentState.epoch;
            readbackState.transform.stateRevision = currentState.revision;

            var result = new CheckpointRestorePayload
            {
                checkpointId = checkpointId,
                mutationId = mutationId,
                replayed = false,
                changed = execution.outcome.changed,
                requestedGlobalObjectId = checkpointToRestore.globalObjectId,
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                gameObject = readbackState.gameObject,
                transform = readbackState.transform,
            };
            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            CheckpointSnapshotPayload checkpoint,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            return string.Join(
                "|",
                "checkpoint:" + checkpoint.checkpointId,
                "target:" + checkpoint.globalObjectId,
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        private static RestoreMutationState Mutate(
            EditorMutationContext context,
            CheckpointSnapshotPayload checkpoint)
        {
            var readbackBefore = CaptureVerifiedReadback(checkpoint, "checkpoint.restore");
            var gameObject = readbackBefore.gameObjectReference;
            var transform = gameObject.transform;
            var original = new RestoreNativeState
            {
                name = gameObject.name,
                activeSelf = gameObject.activeSelf,
                localPosition = transform.localPosition,
                localRotation = transform.localRotation,
                localScale = transform.localScale,
            };

            var changed = !ReadbackMatchesCheckpoint(readbackBefore, checkpoint);
            if (changed)
            {
                Undo.RecordObject(gameObject, context.undoGroupName);
                Undo.RecordObject(transform, context.undoGroupName);
                context.MarkUndoRecorded();

                gameObject.name = checkpoint.name;
                gameObject.SetActive(checkpoint.activeSelf);
                transform.localPosition = checkpoint.localPosition.ToVector3();
                transform.localRotation = ToQuaternion(checkpoint.localRotation);
                transform.localScale = checkpoint.localScale.ToVector3();

                if (PrefabUtility.IsPartOfNonAssetPrefabInstance(gameObject))
                {
                    PrefabUtility.RecordPrefabInstancePropertyModifications(gameObject);
                }
                if (PrefabUtility.IsPartOfNonAssetPrefabInstance(transform))
                {
                    PrefabUtility.RecordPrefabInstancePropertyModifications(transform);
                }
                EditorSceneManager.MarkSceneDirty(context.activeScene);
            }

            return new RestoreMutationState
            {
                gameObject = gameObject,
                globalObjectId = checkpoint.globalObjectId,
                original = original,
                readback = null,
            };
        }

        private static bool VerifyMutation(
            RestoreMutationState state,
            CheckpointSnapshotPayload checkpoint)
        {
            try
            {
                state.readback = CaptureVerifiedReadback(checkpoint, "checkpoint.restore verification");
                return ReadbackMatchesCheckpoint(state.readback, checkpoint);
            }
            catch (CheckpointUnavailableException)
            {
                return false;
            }
            catch (GameObjectEditTargetUnavailableException)
            {
                return false;
            }
        }

        private static bool VerifyRollback(RestoreMutationState state)
        {
            if (state == null || state.original == null || string.IsNullOrEmpty(state.globalObjectId))
            {
                return false;
            }

            GameObject gameObject;
            try
            {
                gameObject = GameObjectSnapshotCommand.ResolveGameObject(state.globalObjectId, out _);
            }
            catch (GameObjectEditTargetUnavailableException)
            {
                return false;
            }

            var transform = gameObject.transform;
            return string.Equals(gameObject.name, state.original.name, StringComparison.Ordinal) &&
                gameObject.activeSelf == state.original.activeSelf &&
                VectorApproximately(transform.localPosition, state.original.localPosition) &&
                Quaternion.Angle(transform.localRotation, state.original.localRotation) <= RotationToleranceDegrees &&
                VectorApproximately(transform.localScale, state.original.localScale);
        }

        private static VerifiedCheckpointReadback CaptureVerifiedReadback(
            CheckpointSnapshotPayload checkpoint,
            string operation)
        {
            var gameObject = GameObjectSnapshotCommand.ResolveGameObject(
                checkpoint.globalObjectId,
                out var canonicalGlobalObjectId);
            var activeScene = SceneManager.GetActiveScene();
            CheckpointStore.RequirePersistentActiveSceneTarget(gameObject, activeScene, operation);
            if (!string.Equals(activeScene.path, checkpoint.scenePath, StringComparison.Ordinal))
            {
                throw new CheckpointUnavailableException(
                    $"{operation} refuses to cross Scene identity; the active target Scene differs from the checkpoint.");
            }

            var currentParent = CheckpointStore.CaptureParentGlobalObjectId(gameObject.transform.parent);
            if (!string.Equals(
                currentParent,
                checkpoint.parentGlobalObjectId,
                StringComparison.Ordinal))
            {
                throw new CheckpointUnavailableException(
                    $"{operation} refuses to restore local Transform values after the target was reparented.");
            }

            return new VerifiedCheckpointReadback
            {
                gameObjectReference = gameObject,
                gameObject = GameObjectSnapshotCommand.Capture(gameObject, canonicalGlobalObjectId),
                transform = TransformGetCommand.Capture(gameObject, canonicalGlobalObjectId),
                parentGlobalObjectId = currentParent,
            };
        }

        private static bool ReadbackMatchesCheckpoint(
            VerifiedCheckpointReadback readback,
            CheckpointSnapshotPayload checkpoint)
        {
            return readback != null &&
                readback.gameObject != null &&
                readback.transform != null &&
                string.Equals(
                    readback.gameObject.globalObjectId,
                    checkpoint.globalObjectId,
                    StringComparison.Ordinal) &&
                string.Equals(readback.gameObject.scenePath, checkpoint.scenePath, StringComparison.Ordinal) &&
                string.Equals(
                    readback.parentGlobalObjectId,
                    checkpoint.parentGlobalObjectId,
                    StringComparison.Ordinal) &&
                string.Equals(readback.gameObject.name, checkpoint.name, StringComparison.Ordinal) &&
                readback.gameObject.activeSelf == checkpoint.activeSelf &&
                VectorApproximately(readback.transform.localPosition, checkpoint.localPosition) &&
                Quaternion.Angle(
                    ToQuaternion(readback.transform.localRotation),
                    ToQuaternion(checkpoint.localRotation)) <= RotationToleranceDegrees &&
                VectorApproximately(readback.transform.localScale, checkpoint.localScale);
        }

        private static void EnsureSameIntent(
            CheckpointRestorePayload cached,
            string checkpointId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.checkpointId, checkpointId, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new CheckpointMutationConflictException(
                    "mutationId was already used for checkpoint.restore with a different checkpoint or state precondition.");
            }
        }

        private static Quaternion ToQuaternion(TransformQuaternionPayload value)
        {
            if (value == null)
            {
                throw new ArgumentNullException(nameof(value));
            }
            return new Quaternion(value.x, value.y, value.z, value.w);
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

        private sealed class RestoreMutationState
        {
            public GameObject gameObject;
            public string globalObjectId;
            public RestoreNativeState original;
            public VerifiedCheckpointReadback readback;
        }

        private sealed class RestoreNativeState
        {
            public string name;
            public bool activeSelf;
            public Vector3 localPosition;
            public Quaternion localRotation;
            public Vector3 localScale;
        }

        private sealed class VerifiedCheckpointReadback
        {
            public GameObject gameObjectReference;
            public GameObjectSnapshotPayload gameObject;
            public TransformSnapshotPayload transform;
            public string parentGlobalObjectId;
        }
    }
}
