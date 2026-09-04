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
    internal sealed class CheckpointCommandTests
    {
        private Scene originalScene;
        private Scene testScene;
        private bool testSceneWasDirty;
        private readonly List<GameObject> createdObjects = new List<GameObject>();
        private GameObject target;
        private string globalObjectId;

        [SetUp]
        public void SetUp()
        {
            originalScene = SceneManager.GetActiveScene();
            testScene = FindLoadedSavedScene();
            Assert.That(
                testScene.IsValid() && testScene.isLoaded && !string.IsNullOrEmpty(testScene.path),
                Is.True,
                "Checkpoint tests require at least one already-loaded saved Scene. " +
                "The fixture intentionally does not create/close/save user Scenes because Unity rejects additive " +
                "NewScene while an untitled unsaved Scene is open, and tests must not destroy that user state.");

            testSceneWasDirty = testScene.isDirty;
            Assert.That(SceneManager.SetActiveScene(testScene), Is.True);

            target = CreateGameObject("Checkpoint Original");
            target.transform.localPosition = new Vector3(1.25f, -2f, 3.5f);
            target.transform.localRotation = Quaternion.Euler(10f, 20f, 30f);
            target.transform.localScale = new Vector3(1.5f, 0.75f, 2f);
            globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
            Assert.That(globalObjectId, Is.Not.Empty);
        }

        [TearDown]
        public void TearDown()
        {
            for (var index = createdObjects.Count - 1; index >= 0; index--)
            {
                var gameObject = createdObjects[index];
                if (gameObject != null)
                {
                    UnityEngine.Object.DestroyImmediate(gameObject);
                }
            }
            createdObjects.Clear();
            target = null;

            // If this Scene was clean before the test, the fixture owns every edit it made.
            // Saving after removing all temporary objects returns it to a clean serialized state
            // without depending on non-public/unsupported scene-clean APIs.
            if (testScene.IsValid() && testScene.isLoaded && !testSceneWasDirty)
            {
                Assert.That(EditorSceneManager.SaveScene(testScene), Is.True);
            }

            if (originalScene.IsValid() && originalScene.isLoaded)
            {
                SceneManager.SetActiveScene(originalScene);
            }
        }

        [Test]
        public void Capture_IsReadOnlyForUnityStateAndRecordsBoundedIdentity()
        {
            var before = EditorStateRevision.Capture();
            var checkpoint = CheckpointStore.Capture(globalObjectId);
            var after = EditorStateRevision.Capture();

            Assert.That(checkpoint.checkpointId, Does.StartWith("cp-"));
            Assert.That(checkpoint.checkpointId.Length, Is.EqualTo(67));
            Assert.That(checkpoint.globalObjectId, Is.EqualTo(globalObjectId));
            Assert.That(checkpoint.scenePath, Is.EqualTo(testScene.path));
            Assert.That(checkpoint.parentGlobalObjectId, Is.Empty);
            Assert.That(checkpoint.name, Is.EqualTo("Checkpoint Original"));
            Assert.That(checkpoint.activeSelf, Is.True);
            Assert.That(checkpoint.maximumRetainedCheckpoints, Is.EqualTo(16));
            Assert.That(checkpoint.retainedCheckpointCount, Is.InRange(1, 16));
            Assert.That(after.epoch, Is.EqualTo(before.epoch));
            Assert.That(after.revision, Is.EqualTo(before.revision));
        }

        [Test]
        public void Capture_UnchangedStateProducesSameDeterministicCheckpointId()
        {
            var first = CheckpointStore.Capture(globalObjectId);
            var second = CheckpointStore.Capture(globalObjectId);

            Assert.That(second.checkpointId, Is.EqualTo(first.checkpointId));
            Assert.That(second.capturedStateEpoch, Is.EqualTo(first.capturedStateEpoch));
            Assert.That(second.capturedStateRevision, Is.EqualTo(first.capturedStateRevision));
        }

        [Test]
        public void Get_ReturnsTheRetainedCheckpointWithoutChangingUnityState()
        {
            var captured = CheckpointStore.Capture(globalObjectId);
            var before = EditorStateRevision.Capture();
            var readback = CheckpointStore.Get(captured.checkpointId);
            var after = EditorStateRevision.Capture();

            Assert.That(readback.checkpointId, Is.EqualTo(captured.checkpointId));
            Assert.That(readback.globalObjectId, Is.EqualTo(globalObjectId));
            Assert.That(after.epoch, Is.EqualTo(before.epoch));
            Assert.That(after.revision, Is.EqualTo(before.revision));
        }

        [Test]
        public void Restore_RestoresNameActiveAndLocalTransformAndSameIdReplayIsReadOnly()
        {
            var checkpoint = CheckpointStore.Capture(globalObjectId);

            target.name = "Changed Name";
            target.SetActive(false);
            target.transform.localPosition = new Vector3(9f, 8f, 7f);
            target.transform.localRotation = Quaternion.Euler(70f, 80f, 90f);
            target.transform.localScale = new Vector3(3f, 4f, 5f);
            EditorSceneManager.MarkSceneDirty(testScene);
            EditorStateRevision.Advance();

            var preRestore = EditorStateRevision.Capture();
            var mutationId = "checkpoint-restore-test-" + Guid.NewGuid().ToString("N");
            var result = CheckpointRestoreCommand.Execute(
                checkpoint.checkpointId,
                mutationId,
                preRestore.epoch,
                preRestore.revision);

            Assert.That(result.replayed, Is.False);
            Assert.That(result.changed, Is.True);
            Assert.That(target.name, Is.EqualTo(checkpoint.name));
            Assert.That(target.activeSelf, Is.EqualTo(checkpoint.activeSelf));
            AssertVector(target.transform.localPosition, checkpoint.localPosition);
            AssertVector(target.transform.localScale, checkpoint.localScale);
            Assert.That(
                Quaternion.Angle(
                    target.transform.localRotation,
                    new Quaternion(
                        checkpoint.localRotation.x,
                        checkpoint.localRotation.y,
                        checkpoint.localRotation.z,
                        checkpoint.localRotation.w)),
                Is.LessThanOrEqualTo(0.001f));

            var beforeReplay = EditorStateRevision.Capture();
            var replay = CheckpointRestoreCommand.Execute(
                checkpoint.checkpointId,
                mutationId,
                preRestore.epoch,
                preRestore.revision);
            var afterReplay = EditorStateRevision.Capture();

            Assert.That(replay.replayed, Is.True);
            Assert.That(afterReplay.epoch, Is.EqualTo(beforeReplay.epoch));
            Assert.That(afterReplay.revision, Is.EqualTo(beforeReplay.revision));
        }

        [Test]
        public void Restore_RejectsReparentedTargetBeforeCheckpointValuesAreApplied()
        {
            var parentA = CreateGameObject("Parent A");
            var parentB = CreateGameObject("Parent B");
            target.transform.SetParent(parentA.transform, false);
            EditorSceneManager.MarkSceneDirty(testScene);
            EditorStateRevision.Advance();
            globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();

            var checkpoint = CheckpointStore.Capture(globalObjectId);
            target.transform.SetParent(parentB.transform, false);
            target.name = "Must Stay Changed";
            EditorSceneManager.MarkSceneDirty(testScene);
            EditorStateRevision.Advance();
            var current = EditorStateRevision.Capture();

            var exception = Assert.Throws<CheckpointUnavailableException>(() =>
                CheckpointRestoreCommand.Execute(
                    checkpoint.checkpointId,
                    "checkpoint-reparent-test-" + Guid.NewGuid().ToString("N"),
                    current.epoch,
                    current.revision));

            Assert.That(exception, Is.Not.Null);
            StringAssert.Contains("reparented", exception.Message);
            Assert.That(target.name, Is.EqualTo("Must Stay Changed"));
            Assert.That(target.transform.parent, Is.EqualTo(parentB.transform));
        }

        [Test]
        public void RestoreValidateArguments_RequiresFreshStateExpectation()
        {
            Assert.Throws<ArgumentException>(() =>
                CheckpointRestoreCommand.ValidateArguments(
                    "cp-" + new string('a', 64),
                    "checkpoint-restore-validation",
                    string.Empty,
                    0));
        }

        [Test]
        public void CheckpointIdValidation_RejectsUppercaseOrWrongLengthHashes()
        {
            Assert.Throws<ArgumentException>(() =>
                CheckpointStore.ValidateCheckpointId("cp-" + new string('A', 64)));
            Assert.Throws<ArgumentException>(() =>
                CheckpointStore.ValidateCheckpointId("cp-" + new string('a', 63)));
        }

        private GameObject CreateGameObject(string name)
        {
            var gameObject = new GameObject(name);
            if (gameObject.scene != testScene)
            {
                SceneManager.MoveGameObjectToScene(gameObject, testScene);
            }
            createdObjects.Add(gameObject);
            return gameObject;
        }

        private static Scene FindLoadedSavedScene()
        {
            var activeScene = SceneManager.GetActiveScene();
            if (activeScene.IsValid() &&
                activeScene.isLoaded &&
                !string.IsNullOrEmpty(activeScene.path))
            {
                return activeScene;
            }

            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isLoaded && !string.IsNullOrEmpty(scene.path))
                {
                    return scene;
                }
            }

            return default;
        }

        private static void AssertVector(Vector3 actual, TransformVector3Payload expected)
        {
            Assert.That(actual.x, Is.EqualTo(expected.x).Within(0.0001f));
            Assert.That(actual.y, Is.EqualTo(expected.y).Within(0.0001f));
            Assert.That(actual.z, Is.EqualTo(expected.z).Within(0.0001f));
        }
    }
}
