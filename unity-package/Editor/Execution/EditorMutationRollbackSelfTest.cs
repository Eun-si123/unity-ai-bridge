using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityAiBridge.Editor.Commands;

namespace UnityAiBridge.Editor.Execution
{
    internal static class EditorMutationRollbackSelfTest
    {
        private const string MenuPath = "Tools/Unity AI Bridge/Verify Transaction Rollback";
        private const string Operation = "dev.transaction.rollbackProbe";
        private const string UndoGroupName = "Unity AI Bridge: Rollback Probe";
        private const string ProbeNamePrefix = "MCP_Rollback_Probe_";

        [MenuItem(MenuPath, false, 2100)]
        private static void Run()
        {
            var probeName = ProbeNamePrefix + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var globalObjectId = string.Empty;
            var sceneWasDirty = SceneManager.GetActiveScene().isDirty;

            try
            {
                EditorMutationTransaction.Execute(
                    Operation,
                    UndoGroupName,
                    context =>
                    {
                        var gameObject = new GameObject(probeName);
                        if (gameObject.scene != context.activeScene)
                        {
                            SceneManager.MoveGameObjectToScene(gameObject, context.activeScene);
                        }

                        Undo.RegisterCreatedObjectUndo(gameObject, UndoGroupName);
                        context.MarkUndoRecorded();
                        EditorSceneManager.MarkSceneDirty(context.activeScene);

                        var objects = new UnityEngine.Object[] { gameObject };
                        var globalObjectIds = new GlobalObjectId[1];
                        GlobalObjectId.GetGlobalObjectIdsSlow(objects, globalObjectIds);
                        globalObjectId = globalObjectIds[0].ToString();
                        return globalObjectId;
                    },
                    (_, __) => false);

                throw new InvalidOperationException(
                    "Rollback probe unexpectedly reported transaction success after forced verification failure.");
            }
            catch (EditorMutationVerificationException)
            {
                if (string.IsNullOrEmpty(globalObjectId))
                {
                    Fail("Rollback probe did not capture a GlobalObjectId before verification failed.");
                    return;
                }

                var readback = ObjectResolverCommand.Execute(globalObjectId);
                var hierarchyMatches = CountHierarchyMatches(SceneManager.GetActiveScene(), probeName);
                if (readback.found || hierarchyMatches != 0)
                {
                    Fail(
                        $"Rollback readback failed: found={readback.found}, hierarchyMatches={hierarchyMatches}, globalObjectId={globalObjectId}.");
                    return;
                }

                var sceneIsDirty = SceneManager.GetActiveScene().isDirty;
                Debug.Log(
                    "[Unity AI Bridge] Transaction rollback self-test PASS: " +
                    $"forcedVerificationFailure=true, rollbackTargetFound=false, hierarchyMatches=0, " +
                    $"sceneWasDirty={sceneWasDirty}, sceneIsDirty={sceneIsDirty}, globalObjectId={globalObjectId}");
            }
            catch (Exception exception)
            {
                Debug.LogError(
                    "[Unity AI Bridge] Transaction rollback self-test FAILED: " + exception);
            }
        }

        private static int CountHierarchyMatches(Scene scene, string name)
        {
            if (!scene.IsValid() || !scene.isLoaded)
            {
                return -1;
            }

            var matches = 0;
            foreach (var root in scene.GetRootGameObjects())
            {
                matches += CountHierarchyMatches(root.transform, name);
            }
            return matches;
        }

        private static int CountHierarchyMatches(Transform transform, string name)
        {
            var matches = string.Equals(transform.gameObject.name, name, StringComparison.Ordinal) ? 1 : 0;
            for (var index = 0; index < transform.childCount; index++)
            {
                matches += CountHierarchyMatches(transform.GetChild(index), name);
            }
            return matches;
        }

        private static void Fail(string message)
        {
            Debug.LogError("[Unity AI Bridge] Transaction rollback self-test FAILED: " + message);
        }
    }
}
