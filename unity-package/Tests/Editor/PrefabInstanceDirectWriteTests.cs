using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class PrefabInstanceDirectWriteTests
    {
        private const string FixturePath =
            "Packages/com.eunsung.unity-ai-bridge/Tests/Editor/Fixtures/PrefabWorkflowFixture.prefab";

        [Test]
        public void DirectUndoWrites_RecordScenePrefabInstanceOverrides()
        {
            var unique = Guid.NewGuid().ToString("N");
            var prefabPath = $"Assets/UnityAiBridge_DirectPrefabWrite_{unique}.prefab";
            var scenePath = $"Assets/UnityAiBridge_DirectPrefabWrite_{unique}.unity";
            var previousActiveScene = SceneManager.GetActiveScene();
            var replacedCleanUntitledScene = false;
            var untitledRestoreSetup = NewSceneSetup.EmptyScene;
            Scene testScene = default;
            GameObject instance = null;

            try
            {
                Assert.That(AssetDatabase.CopyAsset(FixturePath, prefabPath), Is.True);
                AssetDatabase.ImportAsset(
                    prefabPath,
                    ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                Assert.That(prefab, Is.Not.Null);

                if (HasUnsavedUntitledScene())
                {
                    if (SceneManager.sceneCount != 1 ||
                        !previousActiveScene.IsValid() ||
                        !previousActiveScene.isLoaded ||
                        !string.IsNullOrEmpty(previousActiveScene.path) ||
                        previousActiveScene.isDirty ||
                        !TryGetSafeUntitledRestoreSetup(previousActiveScene, out untitledRestoreSetup))
                    {
                        Assert.Ignore(
                            "Direct Prefab-instance write integration requires either saved open scenes or the clean default Test Runner Untitled scene. It will not replace an unknown/dirty unsaved user scene.");
                    }

                    testScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Single);
                    replacedCleanUntitledScene = true;
                }
                else
                {
                    testScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Additive);
                }

                Assert.That(testScene.IsValid(), Is.True);
                Assert.That(testScene.isLoaded, Is.True);
                Assert.That(EditorSceneManager.SaveScene(testScene, scenePath), Is.True);

                if (SceneManager.GetActiveScene().handle != testScene.handle)
                {
                    Assert.That(SceneManager.SetActiveScene(testScene), Is.True,
                        "The temporary direct-write scene could not be made active.");
                }

                instance = PrefabUtility.InstantiatePrefab(prefab, testScene) as GameObject;
                Assert.That(instance, Is.Not.Null);
                Assert.That(EditorSceneManager.SaveScene(testScene), Is.True);

                var gameObjectGlobalObjectId =
                    GlobalObjectId.GetGlobalObjectIdSlow(instance).ToString();
                Assert.That(GlobalObjectId.TryParse(gameObjectGlobalObjectId, out _), Is.True,
                    "The integration test requires a durable scene-backed GlobalObjectId.");

                var transformState = EditorStateRevision.Capture();
                var transformResult = TransformSetCommand.Execute(
                    gameObjectGlobalObjectId,
                    Vector(instance.transform.localPosition),
                    Vector(instance.transform.localEulerAngles),
                    new TransformVector3Payload { x = 2.25f, y = 3.25f, z = 4.25f },
                    "direct-prefab-transform-" + unique,
                    transformState.epoch,
                    transformState.revision);

                Assert.That(transformResult.replayed, Is.False);
                AssertVector3(instance.transform.localScale, new Vector3(2.25f, 3.25f, 4.25f));

                var transformSerialized = new SerializedObject(instance.transform);
                transformSerialized.UpdateIfRequiredOrScript();
                var scaleProperty = transformSerialized.FindProperty("m_LocalScale");
                Assert.That(scaleProperty, Is.Not.Null);
                Assert.That(scaleProperty.prefabOverride, Is.True,
                    "TransformSetCommand must persist its direct Undo.RecordObject write as a scene Prefab-instance override.");

                var gameObjectState = EditorStateRevision.Capture();
                var updateResult = GameObjectUpdateCommand.Execute(
                    gameObjectGlobalObjectId,
                    instance.name,
                    false,
                    "direct-prefab-gameobject-" + unique,
                    gameObjectState.epoch,
                    gameObjectState.revision);

                Assert.That(updateResult.replayed, Is.False);
                Assert.That(updateResult.changed, Is.True);
                Assert.That(instance.activeSelf, Is.False);

                var gameObjectSerialized = new SerializedObject(instance);
                gameObjectSerialized.UpdateIfRequiredOrScript();
                var activeProperty = gameObjectSerialized.FindProperty("m_IsActive");
                Assert.That(activeProperty, Is.Not.Null);
                Assert.That(activeProperty.prefabOverride, Is.True,
                    "GameObjectUpdateCommand must persist its direct Undo.RecordObject write as a scene Prefab-instance override.");

                Assert.That(EditorSceneManager.SaveScene(testScene), Is.True,
                    "The test-owned scene should serialize the recorded Prefab instance overrides without error.");

                transformSerialized = new SerializedObject(instance.transform);
                transformSerialized.UpdateIfRequiredOrScript();
                scaleProperty = transformSerialized.FindProperty("m_LocalScale");
                Assert.That(scaleProperty.prefabOverride, Is.True,
                    "Transform override metadata disappeared after saving the scene.");

                gameObjectSerialized = new SerializedObject(instance);
                gameObjectSerialized.UpdateIfRequiredOrScript();
                activeProperty = gameObjectSerialized.FindProperty("m_IsActive");
                Assert.That(activeProperty.prefabOverride, Is.True,
                    "GameObject active-state override metadata disappeared after saving the scene.");
            }
            finally
            {
                if (instance != null)
                {
                    UnityEngine.Object.DestroyImmediate(instance);
                }

                if (testScene.IsValid() && testScene.isLoaded && !string.IsNullOrEmpty(testScene.path))
                {
                    EditorSceneManager.SaveScene(testScene);
                }

                if (replacedCleanUntitledScene)
                {
                    EditorSceneManager.NewScene(untitledRestoreSetup, NewSceneMode.Single);
                }
                else
                {
                    if (previousActiveScene.IsValid() && previousActiveScene.isLoaded)
                    {
                        SceneManager.SetActiveScene(previousActiveScene);
                    }
                    if (testScene.IsValid() && testScene.isLoaded)
                    {
                        EditorSceneManager.CloseScene(testScene, true);
                    }
                }

                DeleteTemporaryAsset(prefabPath);
                DeleteTemporaryAsset(scenePath);
            }
        }

        private static TransformVector3Payload Vector(Vector3 value)
        {
            return new TransformVector3Payload
            {
                x = value.x,
                y = value.y,
                z = value.z,
            };
        }

        private static bool HasUnsavedUntitledScene()
        {
            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isLoaded && string.IsNullOrEmpty(scene.path))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool TryGetSafeUntitledRestoreSetup(
            Scene scene,
            out NewSceneSetup setup)
        {
            setup = NewSceneSetup.EmptyScene;
            var roots = scene.GetRootGameObjects();
            if (roots.Length == 0)
            {
                return true;
            }

            for (var index = 0; index < roots.Length; index++)
            {
                var name = roots[index].name;
                if (!string.Equals(name, "Main Camera", StringComparison.Ordinal) &&
                    !string.Equals(name, "Directional Light", StringComparison.Ordinal) &&
                    !string.Equals(name, "Global Volume", StringComparison.Ordinal))
                {
                    return false;
                }
            }

            setup = NewSceneSetup.DefaultGameObjects;
            return true;
        }

        private static void DeleteTemporaryAsset(string path)
        {
            if (!string.IsNullOrEmpty(AssetDatabase.AssetPathToGUID(path)) ||
                AssetDatabase.LoadMainAssetAtPath(path) != null)
            {
                AssetDatabase.DeleteAsset(path);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            }
        }

        private static void AssertVector3(Vector3 actual, Vector3 expected)
        {
            Assert.That(actual.x, Is.EqualTo(expected.x).Within(0.0001f));
            Assert.That(actual.y, Is.EqualTo(expected.y).Within(0.0001f));
            Assert.That(actual.z, Is.EqualTo(expected.z).Within(0.0001f));
        }
    }
}
