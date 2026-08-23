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
            var rollbackVerifierCalled = false;
            var rollbackVerified = false;

            try
            {
                EditorMutationTransaction.ExecuteWithOutcome(
                    Operation,
                    UndoGroupName,
                    string.Empty,
                    0,
                    string.Empty,
                    string.Empty,
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
                    (_, __) => false,
                    (_, createdGlobalObjectId) =>
                    {
                        rollbackVerifierCalled = true;
                        var readback = ObjectResolverCommand.Execute(createdGlobalObjectId);
                        var hierarchyMatches = CountHierarchyMatches(
                            SceneManager.GetActiveScene(),
                            probeName);
                        rollbackVerified = !readback.found && hierarchyMatches == 0;
                        return rollbackVerified;
                    });

                throw new InvalidOperationException(
                    "Rollback probe unexpectedly reported transaction success after forced verification failure.");
            }
            catch (EditorMutationVerificationException exception)
            {
                if (string.IsNullOrEmpty(globalObjectId))
                {
                    Fail("Rollback probe did not capture a GlobalObjectId before verification failed.");
                    return;
                }

                if (!rollbackVerifierCalled || !rollbackVerified)
                {
                    Fail(
                        $"Transaction rollback verifier did not confirm rollback: called={rollbackVerifierCalled}, verified={rollbackVerified}.");
                    return;
                }

                var outcome = exception.Outcome;
                if (outcome == null ||
                    !outcome.changed ||
                    outcome.verified ||
                    !outcome.rolledBack ||
                    !outcome.rollbackVerified)
                {
                    Fail(
                        "Structured rollback outcome was inconsistent: " +
                        $"changed={outcome?.changed}, verified={outcome?.verified}, " +
                        $"rolledBack={outcome?.rolledBack}, rollbackVerified={outcome?.rollbackVerified}.");
                    return;
                }

                var readback = ObjectResolverCommand.Execute(globalObjectId);
                var hierarchyMatches = CountHierarchyMatches(SceneManager.GetActiveScene(), probeName);
                if (readback.found || hierarchyMatches != 0)
                {
                    Fail(
                        $"Final rollback readback failed: found={readback.found}, hierarchyMatches={hierarchyMatches}, globalObjectId={globalObjectId}.");
                    return;
                }

                if (outcome.rollbackDirtyResidue !=
                    (!outcome.sceneWasDirtyBefore && outcome.sceneIsDirtyAfter))
                {
                    Fail(
                        "Dirty-state residue classification was inconsistent: " +
                        $"sceneWasDirtyBefore={outcome.sceneWasDirtyBefore}, " +
                        $"sceneIsDirtyAfter={outcome.sceneIsDirtyAfter}, " +
                        $"rollbackDirtyResidue={outcome.rollbackDirtyResidue}.");
                    return;
                }

                Debug.Log(
                    "[Unity AI Bridge] Transaction verification + dirty-state reporting PASS: " +
                    "forcedVerificationFailure=true, changed=true, verified=false, rolledBack=true, " +
                    "rollbackVerifierCalled=true, rollbackVerified=true, rollbackTargetFound=false, hierarchyMatches=0, " +
                    $"sceneWasDirtyBefore={outcome.sceneWasDirtyBefore}, " +
                    $"sceneIsDirtyAfter={outcome.sceneIsDirtyAfter}, " +
                    $"dirtyStateChanged={outcome.dirtyStateChanged}, " +
                    $"rollbackDirtyResidue={outcome.rollbackDirtyResidue}, " +
                    $"globalObjectId={globalObjectId}");
            }
            catch (Exception exception)
            {
                Debug.LogError(
                    "[Unity AI Bridge] Transaction verification + dirty-state reporting FAILED: " + exception);
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
            Debug.LogError(
                "[Unity AI Bridge] Transaction verification + dirty-state reporting FAILED: " + message);
        }
    }
}
