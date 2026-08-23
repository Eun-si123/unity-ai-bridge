using System;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class PrefabAssetCreatePayload
    {
        public string mutationId;
        public bool replayed;
        public bool created;
        public string sourceGlobalObjectId;
        public string sourceName;
        public string destinationPath;
        public string prefabGuid;
        public string dependencyHash;
        public string prefabAssetType;
        public string rootName;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public string stateEpoch;
        public long stateRevision;
    }

    internal sealed class PrefabAssetCreateCompilingException : InvalidOperationException
    {
        public PrefabAssetCreateCompilingException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreatePlayModeException : InvalidOperationException
    {
        public PrefabAssetCreatePlayModeException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateUnavailableException : InvalidOperationException
    {
        public PrefabAssetCreateUnavailableException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateDestinationOccupiedException : InvalidOperationException
    {
        public PrefabAssetCreateDestinationOccupiedException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateMutationConflictException : InvalidOperationException
    {
        public PrefabAssetCreateMutationConflictException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateIncompleteException : InvalidOperationException
    {
        public PrefabAssetCreateIncompleteException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateFailedException : InvalidOperationException
    {
        public PrefabAssetCreateFailedException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateVerificationException : InvalidOperationException
    {
        public PrefabAssetCreateVerificationException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateReplayStaleException : InvalidOperationException
    {
        public PrefabAssetCreateReplayStaleException(string message) : base(message) { }
    }

    internal sealed class PrefabAssetCreateCleanupException : InvalidOperationException
    {
        public PrefabAssetCreateCleanupException(string message) : base(message) { }
    }

    internal static class PrefabAssetCreateCommand
    {
        public const int MaximumDestinationPathLength = 512;
        public const int MaximumMutationIdLength = 128;

        private const string Operation = "prefab.asset.create";
        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.PrefabAssetCreate.";

        public static void ValidateArguments(
            string sourceGlobalObjectId,
            string destinationPath,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(sourceGlobalObjectId);
            ValidateDestinationPath(destinationPath);
            ValidateMutationId(mutationId);
            if (string.IsNullOrWhiteSpace(expectedStateEpoch) || expectedStateRevision <= 0)
            {
                throw new ArgumentException(
                    "expectedStateEpoch and a positive expectedStateRevision are required for prefab.asset.create.");
            }
            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
        }

        public static PrefabAssetCreatePayload Execute(
            string sourceGlobalObjectId,
            string destinationPath,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(sourceGlobalObjectId, destinationPath, mutationId, expectedStateEpoch, expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new PrefabAssetCreateCompilingException(
                    "Unity is compiling; prefab.asset.create was not executed.");
            }
            if (EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                throw new PrefabAssetCreatePlayModeException(
                    "prefab.asset.create is disabled while Unity is in or transitioning to Play Mode.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<PrefabAssetCreatePayload>(cachedJson);
                if (cached == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException("The cached prefab.asset.create result is invalid.");
                }
                EnsureSameIntent(cached, sourceGlobalObjectId, destinationPath, expectedStateEpoch, expectedStateRevision);
                EnsureReplayStillMatches(cached);
                var replayState = EditorStateRevision.Capture();
                cached.replayed = true;
                cached.stateEpoch = replayState.epoch;
                cached.stateRevision = replayState.revision;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorStateRevision.RequireCurrent(expectedStateEpoch, expectedStateRevision);
            var source = RequireSource(sourceGlobalObjectId);
            var sourceNameBefore = source.name ?? string.Empty;
            EnsureDestinationAvailable(destinationPath);

            var stateBefore = EditorStateRevision.Capture();
            EditorMutationLifecycleRecord lifecycle;
            try
            {
                lifecycle = EditorMutationLifecycle.Begin(
                    Operation,
                    mutationId,
                    BuildIntentFingerprint(sourceGlobalObjectId, destinationPath, expectedStateEpoch, expectedStateRevision),
                    stateBefore);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new PrefabAssetCreateMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new PrefabAssetCreateIncompleteException(exception.Message);
            }

            bool success;
            var savedRoot = PrefabUtility.SaveAsPrefabAsset(source, destinationPath, out success);
            if (!success || savedRoot == null)
            {
                throw new PrefabAssetCreateFailedException(
                    $"Unity did not confirm creating Prefab Asset '{destinationPath}'. Refresh AssetDatabase state before retrying with a new mutationId.");
            }

            PrefabInspectPayload inspected;
            try
            {
                // SaveAsPrefabAsset normally imports immediately, but force the exact new asset to
                // complete its import before semantic readback so GUID/hash/type observations are deterministic.
                AssetDatabase.ImportAsset(
                    destinationPath,
                    ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                inspected = VerifyCreatedAsset(
                    source,
                    sourceGlobalObjectId,
                    sourceNameBefore,
                    savedRoot,
                    destinationPath);
            }
            catch (Exception exception)
            {
                CleanupCreatedAsset(destinationPath, exception.Message);
                throw;
            }

            var stateAfter = EditorStateRevision.Capture();
            var result = new PrefabAssetCreatePayload
            {
                mutationId = mutationId,
                replayed = false,
                created = true,
                sourceGlobalObjectId = sourceGlobalObjectId,
                sourceName = sourceNameBefore,
                destinationPath = destinationPath,
                prefabGuid = inspected.guid,
                dependencyHash = inspected.dependencyHash,
                prefabAssetType = inspected.prefabAssetType,
                rootName = inspected.rootName,
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
            string sourceGlobalObjectId,
            string destinationPath,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            var source = sourceGlobalObjectId ?? string.Empty;
            var path = destinationPath ?? string.Empty;
            var epoch = expectedStateEpoch ?? string.Empty;
            return $"source:{source.Length}:{source}|path:{path.Length}:{path}|epoch:{epoch.Length}:{epoch}|revision:{expectedStateRevision}";
        }

        internal static void ValidateDestinationPath(string destinationPath)
        {
            if (string.IsNullOrWhiteSpace(destinationPath))
            {
                throw new ArgumentException("destinationPath is required.", nameof(destinationPath));
            }
            if (destinationPath.Length > MaximumDestinationPathLength)
            {
                throw new ArgumentOutOfRangeException(nameof(destinationPath),
                    $"destinationPath must be at most {MaximumDestinationPathLength} characters.");
            }
            if (destinationPath.Contains("\\") || destinationPath.StartsWith("/", StringComparison.Ordinal) ||
                destinationPath.Contains("../") || destinationPath.EndsWith("/..", StringComparison.Ordinal) ||
                !destinationPath.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "destinationPath must be a project-relative forward-slash path under Assets with no parent traversal.",
                    nameof(destinationPath));
            }
            if (!destinationPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("destinationPath must end in .prefab.", nameof(destinationPath));
            }

            var separator = destinationPath.LastIndexOf('/');
            var parentFolder = separator > 0 ? destinationPath.Substring(0, separator) : string.Empty;
            if (string.IsNullOrEmpty(parentFolder) || !AssetDatabase.IsValidFolder(parentFolder))
            {
                throw new ArgumentException(
                    $"destinationPath parent folder '{parentFolder}' does not exist in AssetDatabase.",
                    nameof(destinationPath));
            }
        }

        private static GameObject RequireSource(string sourceGlobalObjectId)
        {
            var readback = ObjectResolverCommand.Execute(sourceGlobalObjectId);
            if (!readback.found || !readback.isGameObject)
            {
                throw new PrefabAssetCreateUnavailableException(
                    "prefab.asset.create requires a live scene GameObject GlobalObjectId source.");
            }

            var activeScene = SceneManager.GetActiveScene();
            if (!activeScene.IsValid() || !activeScene.isLoaded ||
                !string.Equals(readback.scenePath, activeScene.path ?? string.Empty, StringComparison.Ordinal))
            {
                throw new PrefabAssetCreateUnavailableException(
                    "The source GameObject must belong to the current loaded active scene.");
            }

            GlobalObjectId.TryParse(readback.canonicalGlobalObjectId, out var parsed);
            var source = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed) as GameObject;
            if (source == null)
            {
                throw new PrefabAssetCreateUnavailableException("The source GameObject could not be re-resolved natively.");
            }
            if (PrefabUtility.IsPartOfPrefabInstance(source))
            {
                throw new PrefabAssetCreateUnavailableException(
                    "The first prefab.asset.create slice accepts only plain scene GameObjects, not existing Prefab instances or variant sources.");
            }
            return source;
        }

        private static void EnsureDestinationAvailable(string destinationPath)
        {
            var guid = AssetDatabase.AssetPathToGUID(destinationPath);
            var existing = AssetDatabase.LoadMainAssetAtPath(destinationPath);
            if (!string.IsNullOrEmpty(guid) || existing != null || AssetDatabase.IsValidFolder(destinationPath))
            {
                throw new PrefabAssetCreateDestinationOccupiedException(
                    $"Prefab destination already exists at '{destinationPath}'. This operation never overwrites an existing asset.");
            }
        }

        private static PrefabInspectPayload VerifyCreatedAsset(
            GameObject source,
            string sourceGlobalObjectId,
            string sourceNameBefore,
            GameObject savedRoot,
            string destinationPath)
        {
            var sourceReadback = ObjectResolverCommand.Execute(sourceGlobalObjectId);
            if (!sourceReadback.found || !sourceReadback.isGameObject ||
                !string.Equals(sourceReadback.name, sourceNameBefore, StringComparison.Ordinal) ||
                !string.Equals(source.name ?? string.Empty, sourceNameBefore, StringComparison.Ordinal))
            {
                throw new PrefabAssetCreateVerificationException(
                    "The source GameObject changed or disappeared while verifying Prefab Asset creation.");
            }
            if (PrefabUtility.IsPartOfPrefabInstance(source))
            {
                throw new PrefabAssetCreateVerificationException(
                    "SaveAsPrefabAsset unexpectedly changed the source scene GameObject into a Prefab instance.");
            }

            if (!PrefabUtility.IsPartOfPrefabAsset(savedRoot) ||
                !string.Equals(AssetDatabase.GetAssetPath(savedRoot), destinationPath, StringComparison.Ordinal))
            {
                throw new PrefabAssetCreateVerificationException(
                    "Unity returned a saved Prefab root that does not belong to the requested destination asset.");
            }

            var inspected = PrefabInspectCommand.Execute(destinationPath, 0, 1);
            if (string.IsNullOrEmpty(inspected.guid) || string.IsNullOrEmpty(inspected.dependencyHash) ||
                string.IsNullOrEmpty(inspected.rootName) || inspected.returnedNodeCount != 1 ||
                !string.Equals(inspected.rootName, savedRoot.name ?? string.Empty, StringComparison.Ordinal))
            {
                throw new PrefabAssetCreateVerificationException(
                    $"Unity created a Prefab Asset, but native readback was inconsistent. savedRootName='{savedRoot.name}', inspectedRootName='{inspected.rootName}', guid='{inspected.guid}', dependencyHash='{inspected.dependencyHash}', returnedNodeCount={inspected.returnedNodeCount}.");
            }
            return inspected;
        }

        private static void CleanupCreatedAsset(string destinationPath, string verificationMessage)
        {
            var deleted = AssetDatabase.DeleteAsset(destinationPath);
            // Asset deletion can leave a short-lived database observation behind until refresh.
            // Force a synchronous refresh before proving cleanup absence.
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var guidAfter = AssetDatabase.AssetPathToGUID(destinationPath);
            var remaining = AssetDatabase.LoadMainAssetAtPath(destinationPath);
            if (!deleted || !string.IsNullOrEmpty(guidAfter) || remaining != null)
            {
                throw new PrefabAssetCreateCleanupException(
                    $"Prefab Asset verification failed and cleanup could not prove removal of '{destinationPath}'. deleted={deleted}, guidAfter='{guidAfter}', remaining={(remaining != null ? remaining.name : "<null>")}. Original verification error: {verificationMessage}");
            }
        }

        private static void EnsureSameIntent(
            PrefabAssetCreatePayload cached,
            string sourceGlobalObjectId,
            string destinationPath,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(cached.sourceGlobalObjectId, sourceGlobalObjectId, StringComparison.Ordinal) ||
                !string.Equals(cached.destinationPath, destinationPath, StringComparison.Ordinal) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new PrefabAssetCreateMutationConflictException(
                    "mutationId was already used for prefab.asset.create with different source/path/preconditions.");
            }
        }

        private static void EnsureReplayStillMatches(PrefabAssetCreatePayload cached)
        {
            var guid = AssetDatabase.AssetPathToGUID(cached.destinationPath);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(cached.destinationPath);
            if (prefab == null || !PrefabUtility.IsPartOfPrefabAsset(prefab) ||
                !string.Equals(guid, cached.prefabGuid, StringComparison.Ordinal) ||
                !string.Equals(AssetDatabase.GetAssetDependencyHash(cached.destinationPath).ToString(), cached.dependencyHash, StringComparison.Ordinal) ||
                !string.Equals(prefab.name ?? string.Empty, cached.rootName, StringComparison.Ordinal))
            {
                throw new PrefabAssetCreateReplayStaleException(
                    "The completed Prefab Asset no longer matches the cached GUID/dependencyHash/root. The same mutationId will not write the asset again automatically.");
            }
        }

        private static void ValidateMutationId(string mutationId)
        {
            if (string.IsNullOrWhiteSpace(mutationId) || mutationId.Length > MaximumMutationIdLength)
            {
                throw new ArgumentException($"mutationId must be 1..{MaximumMutationIdLength} characters.", nameof(mutationId));
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
