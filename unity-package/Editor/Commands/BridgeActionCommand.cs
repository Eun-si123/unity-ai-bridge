using System;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class BridgeActionHistoryEntryPayload
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
        public bool isLatest;
        public bool safeToUndoNow;
        public string unsafeReason;
    }

    [Serializable]
    internal sealed class BridgeActionHistoryPayload
    {
        public string journalKind;
        public string sessionScope;
        public string coverage;
        public int returnedCount;
        public int maximumResults;
        public string stateEpoch;
        public long stateRevision;
        public int currentUndoGroup;
        public string currentUndoGroupName;
        public BridgeActionHistoryEntryPayload[] actions;
    }

    [Serializable]
    internal sealed class BridgeActionUndoPayload
    {
        public string operation;
        public string mutationId;
        public bool undone;
        public int undoGroup;
        public string undoGroupName;
        public int observedUndoGroup;
        public string observedUndoName;
        public string priorStateEpoch;
        public long priorStateRevision;
        public string stateEpoch;
        public long stateRevision;
        public bool sceneIsDirty;
    }

    internal sealed class BridgeActionUndoUnavailableException : InvalidOperationException
    {
        public BridgeActionUndoUnavailableException(string message) : base(message) { }
    }

    internal sealed class BridgeActionUndoVerificationException : InvalidOperationException
    {
        public BridgeActionUndoVerificationException(string message) : base(message) { }
    }

    internal static class BridgeActionHistoryCommand
    {
        public const int DefaultMaxResults = 10;
        public const int MaximumMaxResults = BridgeActionHistory.MaximumEntries;

        public static void ValidateArguments(int maxResults)
        {
            if (maxResults < 1 || maxResults > MaximumMaxResults)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxResults),
                    $"maxResults must be 1..{MaximumMaxResults}.");
            }
        }

        public static BridgeActionHistoryPayload Execute(int maxResults)
        {
            ValidateArguments(maxResults);
            var records = BridgeActionHistory.ReadRecent(maxResults);
            var state = EditorStateRevision.Capture();
            var entries = new BridgeActionHistoryEntryPayload[records.Length];

            for (var index = 0; index < records.Length; index++)
            {
                var record = records[index];
                var isLatest = index == 0;
                var safety = isLatest
                    ? BridgeActionHistory.EvaluateLatestSafety(record)
                    : new BridgeActionUndoSafety
                    {
                        safe = false,
                        reason = "not_latest_bridge_action",
                    };

                entries[index] = ToPayload(record, isLatest, safety);
            }

            return new BridgeActionHistoryPayload
            {
                journalKind = "bridge_action_history_v1",
                sessionScope = "current_editor_session",
                coverage = "editor_mutation_transaction_scene_edits_v1",
                returnedCount = entries.Length,
                maximumResults = MaximumMaxResults,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
                currentUndoGroup = Undo.GetCurrentGroup(),
                currentUndoGroupName = Undo.GetCurrentGroupName() ?? string.Empty,
                actions = entries,
            };
        }

        internal static BridgeActionHistoryEntryPayload ToPayload(
            BridgeActionRecord record,
            bool isLatest,
            BridgeActionUndoSafety safety)
        {
            if (record == null)
            {
                throw new ArgumentNullException(nameof(record));
            }

            return new BridgeActionHistoryEntryPayload
            {
                operation = record.operation ?? string.Empty,
                mutationId = record.mutationId ?? string.Empty,
                undoGroup = record.undoGroup,
                undoGroupName = record.undoGroupName ?? string.Empty,
                scenePath = record.scenePath ?? string.Empty,
                completedUnixMs = record.completedUnixMs,
                stateBeforeEpoch = record.stateBeforeEpoch ?? string.Empty,
                stateBeforeRevision = record.stateBeforeRevision,
                stateAfterEpoch = record.stateAfterEpoch ?? string.Empty,
                stateAfterRevision = record.stateAfterRevision,
                undone = record.undone,
                undoPerformedUnixMs = record.undoPerformedUnixMs,
                undoStateEpoch = record.undoStateEpoch ?? string.Empty,
                undoStateRevision = record.undoStateRevision,
                isLatest = isLatest,
                safeToUndoNow = safety != null && safety.safe,
                unsafeReason = safety != null ? safety.reason ?? string.Empty : "safety_unavailable",
            };
        }
    }

    internal static class BridgeActionUndoLastCommand
    {
        public static void ValidateArguments(
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            MutationStatusCommand.ValidateArguments(mutationId);
            EditorStateRevision.ValidateExpectation(expectedStateEpoch, expectedStateRevision);
            if (string.IsNullOrEmpty(expectedStateEpoch) || expectedStateRevision < 1)
            {
                throw new ArgumentException(
                    "expectedStateEpoch and expectedStateRevision are required for action.undoLast.");
            }
        }

        public static BridgeActionUndoPayload Execute(
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(mutationId, expectedStateEpoch, expectedStateRevision);
            EditorStateRevision.RequireCurrent(expectedStateEpoch, expectedStateRevision);

            var record = BridgeActionHistory.ReadLatest();
            if (record == null)
            {
                throw new BridgeActionUndoUnavailableException(
                    "No current-session bridge action is available for safe Undo.");
            }
            if (!string.Equals(record.mutationId, mutationId, StringComparison.Ordinal))
            {
                throw new BridgeActionUndoUnavailableException(
                    "The requested mutationId is not the latest bridge action. Arbitrary historical Undo is not supported.");
            }

            var safety = BridgeActionHistory.EvaluateLatestSafety(record);
            if (!safety.safe)
            {
                throw new BridgeActionUndoUnavailableException(
                    $"The latest bridge action is not safe to Undo now: {safety.reason}. Refresh action history and native Unity state.");
            }

            var priorState = EditorStateRevision.Capture();
            var observed = false;
            var observedIsRedo = false;
            var observedUndoGroup = -1;
            var observedUndoName = string.Empty;

            void OnUndoRedo(in UndoRedoInfo info)
            {
                observed = true;
                observedIsRedo = info.isRedo;
                observedUndoGroup = info.undoGroup;
                observedUndoName = info.undoName ?? string.Empty;
            }

            Undo.undoRedoEvent += OnUndoRedo;
            try
            {
                Undo.PerformUndo();
            }
            finally
            {
                Undo.undoRedoEvent -= OnUndoRedo;
            }

            var stateAfterUndo = EditorStateRevision.Capture();
            if (!observed ||
                observedIsRedo ||
                observedUndoGroup != record.undoGroup ||
                !string.Equals(observedUndoName, record.undoGroupName, StringComparison.Ordinal) ||
                string.Equals(stateAfterUndo.epoch, priorState.epoch, StringComparison.Ordinal) &&
                stateAfterUndo.revision == priorState.revision)
            {
                throw new BridgeActionUndoVerificationException(
                    "Unity performed an Undo request, but the observed undoRedoEvent/state token did not exactly confirm the recorded latest bridge action. Re-observe native Unity state before doing anything else.");
            }

            BridgeActionHistory.MarkLatestUndone(mutationId, stateAfterUndo);
            var activeScene = SceneManager.GetActiveScene();
            return new BridgeActionUndoPayload
            {
                operation = record.operation ?? string.Empty,
                mutationId = record.mutationId ?? string.Empty,
                undone = true,
                undoGroup = record.undoGroup,
                undoGroupName = record.undoGroupName ?? string.Empty,
                observedUndoGroup = observedUndoGroup,
                observedUndoName = observedUndoName,
                priorStateEpoch = priorState.epoch,
                priorStateRevision = priorState.revision,
                stateEpoch = stateAfterUndo.epoch,
                stateRevision = stateAfterUndo.revision,
                sceneIsDirty = activeScene.IsValid() && activeScene.isLoaded && activeScene.isDirty,
            };
        }
    }
}
