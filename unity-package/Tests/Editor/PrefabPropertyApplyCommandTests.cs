using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class PrefabPropertyApplyCommandTests
    {
        private const string FixturePath =
            "Packages/com.eunsung.unity-ai-bridge/Tests/Editor/Fixtures/PrefabWorkflowFixture.prefab";
        private const string ComponentGlobalObjectId =
            "GlobalObjectId_V1-2-1234567890abcdef1234567890abcdef-1-0";

        [Test]
        public void ValidateArguments_AcceptsBoundedExplicitApplyIntent()
        {
            Assert.DoesNotThrow(() => PrefabPropertyApplyCommand.ValidateArguments(
                ComponentGlobalObjectId,
                "m_LocalScale",
                "Assets/PrefabPropertyApply.prefab",
                "0123456789abcdef0123456789abcdef",
                "prefab-property-test-1",
                "epoch-1",
                7));
        }

        [Test]
        public void ValidatePropertyPath_RejectsScriptAndArrayElement()
        {
            Assert.Throws<ArgumentException>(() =>
                PrefabPropertyApplyCommand.ValidatePropertyPath("m_Script"));
            Assert.Throws<ArgumentException>(() =>
                PrefabPropertyApplyCommand.ValidatePropertyPath("items.Array.data[0]"));
        }

        [Test]
        public void ValidatePrefabPath_RejectsPackagesTraversalAndNonPrefab()
        {
            Assert.Throws<ArgumentException>(() =>
                PrefabPropertyApplyCommand.ValidatePrefabPath(
                    "Packages/com.example/Test.prefab"));
            Assert.Throws<ArgumentException>(() =>
                PrefabPropertyApplyCommand.ValidatePrefabPath("Assets/../Test.prefab"));
            Assert.Throws<ArgumentException>(() =>
                PrefabPropertyApplyCommand.ValidatePrefabPath("Assets/Test.asset"));
        }

        [Test]
        public void IntentFingerprint_ChangesWithPropertyAssetHashAndSceneState()
        {
            var first = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentGlobalObjectId,
                "m_LocalScale",
                "Assets/A.prefab",
                "hash-a",
                "epoch-a",
                11);
            var changedProperty = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentGlobalObjectId,
                "m_LocalPosition",
                "Assets/A.prefab",
                "hash-a",
                "epoch-a",
                11);
            var changedAsset = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentGlobalObjectId,
                "m_LocalScale",
                "Assets/B.prefab",
                "hash-a",
                "epoch-a",
                11);
            var changedHash = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentGlobalObjectId,
                "m_LocalScale",
                "Assets/A.prefab",
                "hash-b",
                "epoch-a",
                11);
            var changedState = PrefabPropertyApplyCommand.BuildIntentFingerprint(
                ComponentGlobalObjectId,
                "m_LocalScale",
                "Assets/A.prefab",
                "hash-a",
                "epoch-a",
                12);

            Assert.That(first, Is.Not.EqualTo(changedProperty));
            Assert.That(first, Is.Not.EqualTo(changedAsset));
            Assert.That(first, Is.Not.EqualTo(changedHash));
            Assert.That(first, Is.Not.EqualTo(changedState));
        }

        [Test]
        public void Execute_AppliesSingleTransformOverride_Replays_AndRejectsStaleReplay()
        {
            var unique = Guid.NewGuid().ToString("N");
            var prefabPath = $"Assets/UnityAiBridge_PrefabPropertyApply_{unique}.prefab";
            var mutationId = "prefab-property-apply-" + unique;
            GameObject instance = null;

            try
            {
                Assert.That(AssetDatabase.CopyAsset(FixturePath, prefabPath), Is.True);
                AssetDatabase.ImportAsset(
                    prefabPath,
                    ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                Assert.That(prefab, Is.Not.Null);
                instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
                Assert.That(instance, Is.Not.Null);

                var serialized = new SerializedObject(instance.transform);
                serialized.UpdateIfRequiredOrScript();
                var scaleProperty = serialized.FindProperty("m_LocalScale");
                Assert.That(scaleProperty, Is.Not.Null);
                scaleProperty.vector3Value = new Vector3(2.5f, 3.5f, 4.5f);
                Assert.That(serialized.ApplyModifiedProperties(), Is.True);
                PrefabUtility.RecordPrefabInstancePropertyModifications(instance.transform);

                serialized = new SerializedObject(instance.transform);
                serialized.UpdateIfRequiredOrScript();
                scaleProperty = serialized.FindProperty("m_LocalScale");
                Assert.That(scaleProperty.prefabOverride, Is.True,
                    "The test must create a real Prefab instance override before invoking the command.");

                var componentGlobalObjectId =
                    GlobalObjectId.GetGlobalObjectIdSlow(instance.transform).ToString();
                var hashBefore = AssetDatabase.GetAssetDependencyHash(prefabPath).ToString();
                var state = EditorStateRevision.Capture();

                var result = PrefabPropertyApplyCommand.Execute(
                    componentGlobalObjectId,
                    "m_LocalScale",
                    prefabPath,
                    hashBefore,
                    mutationId,
                    state.epoch,
                    state.revision);

                Assert.That(result.applied, Is.True);
                Assert.That(result.replayed, Is.False);
                Assert.That(result.dependencyHashBefore, Is.EqualTo(hashBefore));
                Assert.That(result.dependencyHashAfter, Is.Not.Empty);
                Assert.That(result.prefabGuid, Is.Not.Empty);

                var sourceAfter = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                Assert.That(sourceAfter, Is.Not.Null);
                AssertVector3(sourceAfter.transform.localScale, new Vector3(2.5f, 3.5f, 4.5f));

                serialized = new SerializedObject(instance.transform);
                serialized.UpdateIfRequiredOrScript();
                scaleProperty = serialized.FindProperty("m_LocalScale");
                Assert.That(scaleProperty.prefabOverride, Is.False);
                AssertVector3(scaleProperty.vector3Value, new Vector3(2.5f, 3.5f, 4.5f));

                var replay = PrefabPropertyApplyCommand.Execute(
                    componentGlobalObjectId,
                    "m_LocalScale",
                    prefabPath,
                    hashBefore,
                    mutationId,
                    state.epoch,
                    state.revision);
                Assert.That(replay.replayed, Is.True);
                Assert.That(replay.dependencyHashAfter, Is.EqualTo(result.dependencyHashAfter));

                Assert.That(AssetDatabase.DeleteAsset(prefabPath), Is.True);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

                Assert.Throws<PrefabPropertyApplyReplayStaleException>(() =>
                    PrefabPropertyApplyCommand.Execute(
                        componentGlobalObjectId,
                        "m_LocalScale",
                        prefabPath,
                        hashBefore,
                        mutationId,
                        state.epoch,
                        state.revision));
            }
            finally
            {
                if (instance != null)
                {
                    UnityEngine.Object.DestroyImmediate(instance);
                }
                if (!string.IsNullOrEmpty(AssetDatabase.AssetPathToGUID(prefabPath)) ||
                    AssetDatabase.LoadMainAssetAtPath(prefabPath) != null)
                {
                    AssetDatabase.DeleteAsset(prefabPath);
                    AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                }
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
