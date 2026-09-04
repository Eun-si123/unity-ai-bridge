using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class TaskJournalCommandTests
    {
        private Scene originalScene;
        private Scene testScene;
        private string temporaryScenePath;
        private GameObject target;
        private string globalObjectId;
        private readonly List<string> taskIds = new List<string>();
        private readonly List<string> mutationIds = new List<string>();

        [SetUp]
        public void SetUp()
        {
            originalScene = SceneManager.GetActiveScene();
            Assert.That(originalScene.IsValid() && originalScene.isLoaded, Is.True);

            temporaryScenePath =
                "Assets/UnityAiBridge_TaskJournalTest_" + Guid.NewGuid().ToString("N") + ".unity";

            Assert.That(
                EditorSceneManager.SaveScene(originalScene, temporaryScenePath, true),
                Is.True,
                "Task journal tests must be able to create a temporary saved copy without changing the user's Scene.");

            testScene = EditorSceneManager.OpenScene(temporaryScenePath, OpenSceneMode.Additive);
            Assert.That(testScene.IsValid() && testScene.isLoaded, Is.True);
            Assert.That(SceneManager.SetActiveScene(testScene), Is.True);

            target = new GameObject("Task Journal Original");
            SceneManager.MoveGameObjectToScene(target, testScene);
            target.transform.localPosition = new Vector3(1f, 2f, 3f);
            target.transform.localRotation = Quaternion.Euler(5f, 10f, 15f);
            target.transform.localScale = Vector3.one;
            globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
            Assert.That(globalObjectId, Is.Not.Empty);
        }

        [TearDown]
        public void TearDown()
        {
            for (var index = 0; index < taskIds.Count; index++)
            {
                EditorTaskJournal.ClearForVerification(taskIds[index]);
            }
            for (var index = 0; index < mutationIds.Count; index++)
            {
                EditorMutationLifecycle.ClearForVerification(mutationIds[index]);
            }
            taskIds.Clear();
            mutationIds.Clear();

            target = null;
            if (originalScene.IsValid() && originalScene.isLoaded)
            {
                SceneManager.SetActiveScene(originalScene);
            }
            if (testScene.IsValid() && testScene.isLoaded)
            {
                EditorSceneManager.CloseScene(testScene, true);
            }
            if (!string.IsNullOrEmpty(temporaryScenePath))
            {
                AssetDatabase.DeleteAsset(temporaryScenePath);
            }
        }

        [Test]
        public void BeginAndGet_AreReadOnlyAndExposeReadyFirstStep()
        {
            var taskId = TrackTaskId();
            var steps = BuildTwoStepPlan();
            var before = EditorStateRevision.Capture();

            var begun = TaskJournalCommand.Begin(taskId, steps);
            var afterBegin = EditorStateRevision.Capture();
            var read = TaskJournalCommand.Get(taskId);
            var afterGet = EditorStateRevision.Capture();

            Assert.That(begun.found, Is.True);
            Assert.That(begun.replayed, Is.False);
            Assert.That(begun.status, Is.EqualTo("ready"));
            Assert.That(begun.resumeState, Is.EqualTo("execute_next_reserved_step"));
            Assert.That(begun.safeToExecuteNextStep, Is.True);
            Assert.That(begun.nextStepIndex, Is.EqualTo(0));
            Assert.That(begun.nextOperation, Is.EqualTo(TaskJournalCommand.GameObjectUpdateOperation));
            Assert.That(begun.nextMutationId, Is.EqualTo(steps[0].mutationId));
            Assert.That(read.status, Is.EqualTo("ready"));
            Assert.That(read.safeToExecuteNextStep, Is.True);
            Assert.That(afterBegin.epoch, Is.EqualTo(before.epoch));
            Assert.That(afterBegin.revision, Is.EqualTo(before.revision));
            Assert.That(afterGet.epoch, Is.EqualTo(before.epoch));
            Assert.That(afterGet.revision, Is.EqualTo(before.revision));
        }

        [Test]
        public void Begin_SamePlanReplaysButDifferentPlanConflicts()
        {
            var taskId = TrackTaskId();
            var steps = BuildTwoStepPlan();

            var first = TaskJournalCommand.Begin(taskId, steps);
            var replay = TaskJournalCommand.Begin(taskId, steps);

            Assert.That(first.replayed, Is.False);
            Assert.That(replay.replayed, Is.True);
            Assert.That(replay.taskId, Is.EqualTo(taskId));

            var changedPlan = BuildTwoStepPlan(steps[0].mutationId, steps[1].mutationId);
            changedPlan[0].name = "Different Planned Name";
            Assert.Throws<EditorTaskJournalConflictException>(
                () => TaskJournalCommand.Begin(taskId, changedPlan));
        }

        [Test]
        public void ReservedStep_WrongArgumentsAreRejectedBeforeMutation()
        {
            var taskId = TrackTaskId();
            var steps = BuildTwoStepPlan();
            var task = TaskJournalCommand.Begin(taskId, steps);
            var originalName = target.name;
            var before = EditorStateRevision.Capture();

            Assert.Throws<GameObjectEditMutationConflictException>(() =>
                GameObjectUpdateCommand.Execute(
                    globalObjectId,
                    "Wrong Unplanned Name",
                    true,
                    steps[0].mutationId,
                    task.expectedBoundaryStateEpoch,
                    task.expectedBoundaryStateRevision));

            var after = EditorStateRevision.Capture();
            Assert.That(target.name, Is.EqualTo(originalName));
            Assert.That(after.epoch, Is.EqualTo(before.epoch));
            Assert.That(after.revision, Is.EqualTo(before.revision));
            Assert.That(EditorMutationLifecycle.Read(steps[0].mutationId), Is.Null);
            Assert.That(TaskJournalCommand.Get(taskId).safeToExecuteNextStep, Is.True);
        }

        [Test]
        public void ReservedStep_OutOfOrderIsRejectedBeforeMutation()
        {
            var taskId = TrackTaskId();
            var steps = BuildTwoStepPlan();
            var task = TaskJournalCommand.Begin(taskId, steps);
            var originalPosition = target.transform.localPosition;
            var before = EditorStateRevision.Capture();

            Assert.Throws<TransformMutationConflictException>(() =>
                TransformSetCommand.Execute(
                    globalObjectId,
                    steps[1].localPosition,
                    steps[1].localEulerAngles,
                    steps[1].localScale,
                    steps[1].mutationId,
                    task.expectedBoundaryStateEpoch,
                    task.expectedBoundaryStateRevision));

            var after = EditorStateRevision.Capture();
            Assert.That(target.transform.localPosition, Is.EqualTo(originalPosition));
            Assert.That(after.epoch, Is.EqualTo(before.epoch));
            Assert.That(after.revision, Is.EqualTo(before.revision));
            Assert.That(EditorMutationLifecycle.Read(steps[1].mutationId), Is.Null);
        }

        [Test]
        public void CompletedFirstStep_ExternalStateDriftBlocksResume()
        {
            var taskId = TrackTaskId();
            var steps = BuildTwoStepPlan();
            var begun = TaskJournalCommand.Begin(taskId, steps);

            var update = GameObjectUpdateCommand.Execute(
                globalObjectId,
                steps[0].name,
                steps[0].activeSelf,
                steps[0].mutationId,
                begun.expectedBoundaryStateEpoch,
                begun.expectedBoundaryStateRevision);
            Assert.That(update.replayed, Is.False);

            var afterFirst = TaskJournalCommand.Get(taskId);
            Assert.That(afterFirst.status, Is.EqualTo("ready"));
            Assert.That(afterFirst.nextStepIndex, Is.EqualTo(1));
            Assert.That(afterFirst.safeToExecuteNextStep, Is.True);

            var externalMutationId = TrackMutationId("task-external-drift");
            var externalState = EditorStateRevision.Capture();
            GameObjectUpdateCommand.Execute(
                globalObjectId,
                "External Drift",
                true,
                externalMutationId,
                externalState.epoch,
                externalState.revision);

            var blocked = TaskJournalCommand.Get(taskId);
            Assert.That(blocked.status, Is.EqualTo("blocked"));
            Assert.That(blocked.resumeState, Is.EqualTo("blocked_state_drift"));
            Assert.That(blocked.safeToExecuteNextStep, Is.False);
            Assert.That(blocked.currentStateMatchesExpectedBoundary, Is.False);

            var originalPosition = target.transform.localPosition;
            Assert.Throws<EditorStateStaleException>(() =>
                TransformSetCommand.Execute(
                    globalObjectId,
                    steps[1].localPosition,
                    steps[1].localEulerAngles,
                    steps[1].localScale,
                    steps[1].mutationId,
                    afterFirst.expectedBoundaryStateEpoch,
                    afterFirst.expectedBoundaryStateRevision));
            Assert.That(target.transform.localPosition, Is.EqualTo(originalPosition));
            Assert.That(EditorMutationLifecycle.Read(steps[1].mutationId), Is.Null);
        }

        [Test]
        public void TwoReservedSteps_CompleteInOrderAndTaskBecomesCompleted()
        {
            var taskId = TrackTaskId();
            var steps = BuildTwoStepPlan();
            var begun = TaskJournalCommand.Begin(taskId, steps);

            GameObjectUpdateCommand.Execute(
                globalObjectId,
                steps[0].name,
                steps[0].activeSelf,
                steps[0].mutationId,
                begun.expectedBoundaryStateEpoch,
                begun.expectedBoundaryStateRevision);

            var afterUpdate = TaskJournalCommand.Get(taskId);
            Assert.That(afterUpdate.status, Is.EqualTo("ready"));
            Assert.That(afterUpdate.safeToExecuteNextStep, Is.True);
            Assert.That(afterUpdate.nextStepIndex, Is.EqualTo(1));
            Assert.That(afterUpdate.nextMutationId, Is.EqualTo(steps[1].mutationId));

            var transform = TransformSetCommand.Execute(
                globalObjectId,
                steps[1].localPosition,
                steps[1].localEulerAngles,
                steps[1].localScale,
                steps[1].mutationId,
                afterUpdate.expectedBoundaryStateEpoch,
                afterUpdate.expectedBoundaryStateRevision);
            Assert.That(transform.replayed, Is.False);

            var completed = TaskJournalCommand.Get(taskId);
            Assert.That(completed.status, Is.EqualTo("completed"));
            Assert.That(completed.resumeState, Is.EqualTo("completed"));
            Assert.That(completed.safeToExecuteNextStep, Is.False);
            Assert.That(completed.nextStepIndex, Is.EqualTo(-1));
            Assert.That(completed.steps[0].stepStatus, Is.EqualTo("completed"));
            Assert.That(completed.steps[1].stepStatus, Is.EqualTo("completed"));
            Assert.That(target.name, Is.EqualTo(steps[0].name));
            Assert.That(Vector3.Distance(target.transform.localPosition, steps[1].localPosition.ToVector3()), Is.LessThan(0.0001f));
            Assert.That(Vector3.Distance(target.transform.localScale, steps[1].localScale.ToVector3()), Is.LessThan(0.0001f));
            Assert.That(
                Quaternion.Angle(target.transform.localRotation, Quaternion.Euler(steps[1].localEulerAngles.ToVector3())),
                Is.LessThan(0.001f));
        }

        private TaskStepPlanPayload[] BuildTwoStepPlan(
            string updateMutationId = null,
            string transformMutationId = null)
        {
            updateMutationId = updateMutationId ?? TrackMutationId("task-step-update");
            transformMutationId = transformMutationId ?? TrackMutationId("task-step-transform");
            return new[]
            {
                new TaskStepPlanPayload
                {
                    index = 0,
                    operation = TaskJournalCommand.GameObjectUpdateOperation,
                    mutationId = updateMutationId,
                    globalObjectId = globalObjectId,
                    name = "Task Planned Name",
                    activeSelf = true,
                },
                new TaskStepPlanPayload
                {
                    index = 1,
                    operation = TaskJournalCommand.TransformSetOperation,
                    mutationId = transformMutationId,
                    globalObjectId = globalObjectId,
                    name = string.Empty,
                    activeSelf = false,
                    localPosition = new TransformVector3Payload { x = 4f, y = 5f, z = 6f },
                    localEulerAngles = new TransformVector3Payload { x = 20f, y = 30f, z = 40f },
                    localScale = new TransformVector3Payload { x = 1.5f, y = 0.75f, z = 2f },
                },
            };
        }

        private string TrackTaskId()
        {
            var value = "task-test-" + Guid.NewGuid().ToString("N");
            taskIds.Add(value);
            return value;
        }

        private string TrackMutationId(string prefix)
        {
            var value = prefix + "-" + Guid.NewGuid().ToString("N");
            mutationIds.Add(value);
            return value;
        }
    }
}
