using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Execution
{
    [Serializable]
    internal sealed class BridgeActionRecord
    {
        public string operation;
        public string mutationId;
        public int undoGroup;
        public string undoGroupName;
        public string scenePath;
        public long completedUnixMs;
        public string stateBeforeEpoch;
        public long stateBeforeRevision;
        public string stateAfterEpoch;
        public long stateAfterRevision;
        public bool undone;
        public long undoPerformedUnixMs;
        public string undoStateEpoch;
        public long undoStateRevision;
    }

    [Serializable]
    internal sealed class BridgeActionHistoryStorage
    {
        public BridgeActionRecord[] actions;
    }

    internal sealed class BridgeActionUndoSafety
    {
        public bool safe;
        public string reason;
    }

    internal static class BridgeActionHistory
    {
        internal const int MaximumEntries = 32;
        private const string SessionKey = "UnityAiBridge.BridgeActionHistory.v1";

        private static readonly HashSet<string> SupportedOperations = new HashSet<string>(StringComparer.Ordinal)
        {
            "gameObject.create",
            "gameObject.update",
            "gameObject.delete",
            "transform.set",
            "component.add",
            "component.remove",
            "component.property.set",
        };

        public static void TryRecordCompleted(EditorMutationContext context, string mutationId)
        {
            if (context == null ||
                context.outcome == null ||
                !context.outcome.changed ||
                !context.undoRecorded ||
                context.stateBefore == null ||
                context.stateAfter == null ||
                string.IsNullOrWhiteSpace(mutationId) ||
                !SupportedOperations.Contains(context.operation))
            {
                return;
            }

            try
            {
                var record = new BridgeActionRecord
                {
                    operation = context.operation,
                    mutationId = mutationId,
                    undoGroup = context.undoGroup,
                    undoGroupName = context.undoGroupName ?? string.Empty,
                    scenePath = context.activeScene.IsValid()
                        ? context.activeScene.path ?? string.Empty
                        : string.Empty,
                    completedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    stateBeforeEpoch = context.stateBefore.epoch ?? string.Empty,
                    stateBeforeRevision = context.stateBefore.revision,
                    stateAfterEpoch = context.stateAfter.epoch ?? string.Empty,
                    stateAfterRevision = context.stateAfter.revision,
                    undone = false,
                    undoPerformedUnixMs = 0,
                    undoStateEpoch = string.Empty,
                    undoStateRevision = 0,
                };

                var current = ReadAll();
                var next = new List<BridgeActionRecord>(MaximumEntries) { record };
                for (var index = 0; index < current.Length && next.Count < MaximumEntries; index++)
                {
                    var existing = current[index];
                    if (existing == null ||
                        string.Equals(existing.mutationId, mutationId, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    next.Add(existing);
                }

                Write(next.ToArray());
            }
            catch (Exception exception)
            {
                // Action-history availability must never turn an already verified mutation into a
                // late failure/rollback. Missing history therefore fails closed: safe Undo simply
                // remains unavailable for this mutation.
                Debug.LogWarning(
                    $"[Unity AI Bridge] Could not record bridge action history for {context.operation}/{mutationId}: {exception.Message}");
            }
        }

        public static BridgeActionRecord[] ReadRecent(int maxResults)
        {
            if (maxResults < 1 || maxResults > MaximumEntries)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxResults),
                    $"maxResults must be 1..{MaximumEntries}.");
            }

            var all = ReadAll();
            var count = Math.Min(maxResults, all.Length);
            var result = new BridgeActionRecord[count];
            Array.Copy(all, result, count);
            return result;
        }

        public static BridgeActionRecord ReadLatest()
        {
            var all = ReadAll();
            return all.Length > 0 ? all[0] : null;
        }

        public static BridgeActionUndoSafety EvaluateLatestSafety(BridgeActionRecord record)
        {
            var currentState = EditorStateRevision.Capture();
            var activeScene = SceneManager.GetActiveScene();
            return EvaluateSafety(
                record,
                currentState,
                EditorApplication.isCompiling,
                EditorApplication.isPlayingOrWillChangePlaymode,
                activeScene.IsValid() && activeScene.isLoaded
                    ? activeScene.path ?? string.Empty
                    : string.Empty,
                Undo.GetCurrentGroup(),
                Undo.GetCurrentGroupName());
        }

        internal static BridgeActionUndoSafety EvaluateSafetyForTests(
            BridgeActionRecord record,
            EditorStateRevisionSnapshot currentState,
            bool isCompiling,
            bool isPlayingOrWillChangePlaymode,
            string activeScenePath,
            int currentUndoGroup,
            string currentUndoGroupName)
        {
            return EvaluateSafety(
                record,
                currentState,
                isCompiling,
                isPlayingOrWillChangePlaymode,
                activeScenePath,
                currentUndoGroup,
                currentUndoGroupName);
        }

        public static BridgeActionRecord MarkLatestUndone(
            string mutationId,
            EditorStateRevisionSnapshot undoState)
        {
            if (undoState == null)
            {
                throw new ArgumentNullException(nameof(undoState));
            }

            var all = ReadAll();
            if (all.Length == 0 || all[0] == null ||
                !string.Equals(all[0].mutationId, mutationId, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "The bridge action history changed before the Undo result could be recorded.");
            }

            all[0].undone = true;
            all[0].undoPerformedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            all[0].undoStateEpoch = undoState.epoch ?? string.Empty;
            all[0].undoStateRevision = undoState.revision;
            Write(all);
            return all[0];
        }

        internal static void ClearForVerification()
        {
            SessionState.EraseString(SessionKey);
        }

        internal static void WriteForVerification(params BridgeActionRecord[] records)
        {
            Write(records ?? Array.Empty<BridgeActionRecord>());
        }

        private static BridgeActionUndoSafety EvaluateSafety(
            BridgeActionRecord record,
            EditorStateRevisionSnapshot currentState,
            bool isCompiling,
            bool isPlayingOrWillChangePlaymode,
            string activeScenePath,
            int currentUndoGroup,
            string currentUndoGroupName)
        {
            if (record == null)
            {
                return Unsafe("no_bridge_action");
            }
            if (record.undone)
            {
                return Unsafe("latest_action_already_undone");
            }
            if (isCompiling)
            {
                return Unsafe("editor_compiling");
            }
            if (isPlayingOrWillChangePlaymode)
            {
                return Unsafe("play_mode_active_or_transitioning");
            }
            if (currentState == null ||
                !string.Equals(currentState.epoch, record.stateAfterEpoch, StringComparison.Ordinal) ||
                currentState.revision != record.stateAfterRevision)
            {
                return Unsafe("state_advanced_since_action");
            }
            if (!string.Equals(activeScenePath ?? string.Empty, record.scenePath ?? string.Empty, StringComparison.Ordinal))
            {
                return Unsafe("active_scene_changed");
            }
            if (currentUndoGroup != record.undoGroup)
            {
                return Unsafe("undo_group_changed");
            }
            if (!string.Equals(
                    currentUndoGroupName ?? string.Empty,
                    record.undoGroupName ?? string.Empty,
                    StringComparison.Ordinal))
            {
                return Unsafe("undo_group_name_changed");
            }

            return new BridgeActionUndoSafety
            {
                safe = true,
                reason = string.Empty,
            };
        }

        private static BridgeActionUndoSafety Unsafe(string reason)
        {
            return new BridgeActionUndoSafety
            {
                safe = false,
                reason = reason,
            };
        }

        private static BridgeActionRecord[] ReadAll()
        {
            var json = SessionState.GetString(SessionKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return Array.Empty<BridgeActionRecord>();
            }

            var storage = JsonUtility.FromJson<BridgeActionHistoryStorage>(json);
            if (storage == null || storage.actions == null)
            {
                throw new InvalidOperationException("The stored bridge action history is invalid.");
            }

            return storage.actions;
        }

        private static void Write(BridgeActionRecord[] actions)
        {
            var storage = new BridgeActionHistoryStorage
            {
                actions = actions ?? Array.Empty<BridgeActionRecord>(),
            };
            SessionState.SetString(SessionKey, JsonUtility.ToJson(storage));
        }
    }
}
