using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class BridgeActionHistoryTests
    {
        [SetUp]
        public void SetUp()
        {
            BridgeActionHistory.ClearForVerification();
        }

        [TearDown]
        public void TearDown()
        {
            BridgeActionHistory.ClearForVerification();
        }

        [Test]
        public void History_EmptyJournalReturnsBoundedReadOnlyPayload()
        {
            var result = BridgeActionHistoryCommand.Execute(5);

            Assert.That(result.journalKind, Is.EqualTo("bridge_action_history_v1"));
            Assert.That(result.sessionScope, Is.EqualTo("current_editor_session"));
            Assert.That(result.coverage, Is.EqualTo("editor_mutation_transaction_scene_edits_v1"));
            Assert.That(result.returnedCount, Is.EqualTo(0));
            Assert.That(result.maximumResults, Is.EqualTo(BridgeActionHistory.MaximumEntries));
            Assert.That(result.actions, Is.Empty);
            Assert.That(result.stateRevision, Is.GreaterThan(0));
        }

        [Test]
        public void Safety_ExactStateSceneAndUndoTopIsAllowed()
        {
            var record = CreateRecord();
            var safety = BridgeActionHistory.EvaluateSafetyForTests(
                record,
                new EditorStateRevisionSnapshot
                {
                    epoch = record.stateAfterEpoch,
                    revision = record.stateAfterRevision,
                },
                isCompiling: false,
                isPlayingOrWillChangePlaymode: false,
                activeScenePath: record.scenePath,
                currentUndoGroup: record.undoGroup,
                currentUndoGroupName: record.undoGroupName);

            Assert.That(safety.safe, Is.True);
            Assert.That(safety.reason, Is.Empty);
        }

        [Test]
        public void Safety_StateAdvanceFailsClosed()
        {
            var record = CreateRecord();
            var safety = BridgeActionHistory.EvaluateSafetyForTests(
                record,
                new EditorStateRevisionSnapshot
                {
                    epoch = record.stateAfterEpoch,
                    revision = record.stateAfterRevision + 1,
                },
                isCompiling: false,
                isPlayingOrWillChangePlaymode: false,
                activeScenePath: record.scenePath,
                currentUndoGroup: record.undoGroup,
                currentUndoGroupName: record.undoGroupName);

            Assert.That(safety.safe, Is.False);
            Assert.That(safety.reason, Is.EqualTo("state_advanced_since_action"));
        }

        [TestCase(42, "Unity AI Bridge: Set Transform", "undo_group_changed")]
        [TestCase(41, "Different Undo Name", "undo_group_name_changed")]
        public void Safety_ChangedUndoTopFailsClosed(
            int currentUndoGroup,
            string currentUndoName,
            string expectedReason)
        {
            var record = CreateRecord();
            var safety = BridgeActionHistory.EvaluateSafetyForTests(
                record,
                new EditorStateRevisionSnapshot
                {
                    epoch = record.stateAfterEpoch,
                    revision = record.stateAfterRevision,
                },
                isCompiling: false,
                isPlayingOrWillChangePlaymode: false,
                activeScenePath: record.scenePath,
                currentUndoGroup: currentUndoGroup,
                currentUndoGroupName: currentUndoName);

            Assert.That(safety.safe, Is.False);
            Assert.That(safety.reason, Is.EqualTo(expectedReason));
        }

        [Test]
        public void Safety_AlreadyUndoneActionNeverBecomesUndoableAgain()
        {
            var record = CreateRecord();
            record.undone = true;
            record.undoPerformedUnixMs = 2000;
            record.undoStateEpoch = "epoch-a";
            record.undoStateRevision = 13;

            var safety = BridgeActionHistory.EvaluateSafetyForTests(
                record,
                new EditorStateRevisionSnapshot
                {
                    epoch = record.stateAfterEpoch,
                    revision = record.stateAfterRevision,
                },
                isCompiling: false,
                isPlayingOrWillChangePlaymode: false,
                activeScenePath: record.scenePath,
                currentUndoGroup: record.undoGroup,
                currentUndoGroupName: record.undoGroupName);

            Assert.That(safety.safe, Is.False);
            Assert.That(safety.reason, Is.EqualTo("latest_action_already_undone"));
        }

        [Test]
        public void History_OlderEntriesAreNeverAdvertisedAsSafeUndoTargets()
        {
            var newest = CreateRecord();
            newest.mutationId = "newest-action";
            var older = CreateRecord();
            older.mutationId = "older-action";
            older.completedUnixMs -= 100;
            BridgeActionHistory.WriteForVerification(newest, older);

            var result = BridgeActionHistoryCommand.Execute(10);

            Assert.That(result.returnedCount, Is.EqualTo(2));
            Assert.That(result.actions[0].isLatest, Is.True);
            Assert.That(result.actions[1].isLatest, Is.False);
            Assert.That(result.actions[1].safeToUndoNow, Is.False);
            Assert.That(result.actions[1].unsafeReason, Is.EqualTo("not_latest_bridge_action"));
        }

        [Test]
        public void History_RejectsUnboundedPageSize()
        {
            Assert.Throws<System.ArgumentOutOfRangeException>(() =>
                BridgeActionHistoryCommand.ValidateArguments(BridgeActionHistory.MaximumEntries + 1));
        }

        private static BridgeActionRecord CreateRecord()
        {
            return new BridgeActionRecord
            {
                operation = "transform.set",
                mutationId = "bridge-action-test",
                undoGroup = 41,
                undoGroupName = "Unity AI Bridge: Set Transform",
                scenePath = "Assets/SampleScene.unity",
                completedUnixMs = 1000,
                stateBeforeEpoch = "epoch-a",
                stateBeforeRevision = 11,
                stateAfterEpoch = "epoch-a",
                stateAfterRevision = 12,
                undone = false,
                undoPerformedUnixMs = 0,
                undoStateEpoch = string.Empty,
                undoStateRevision = 0,
            };
        }
    }
}
