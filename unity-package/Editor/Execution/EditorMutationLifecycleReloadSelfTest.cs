using System;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace UnityAiBridge.Editor.Execution
{
    [InitializeOnLoad]
    internal static class EditorMutationLifecycleReloadSelfTest
    {
        private const string MarkerKey = "UnityAiBridge.Verify.MutationLifecycleReload.v1";
        private static readonly string DomainGeneration = Guid.NewGuid().ToString("N");

        static EditorMutationLifecycleReloadSelfTest()
        {
            if (!string.IsNullOrEmpty(SessionState.GetString(MarkerKey, string.Empty)))
            {
                EditorApplication.delayCall += ContinueAfterReload;
            }
        }

        [MenuItem("Tools/Unity AI Bridge/Verify Mutation Lifecycle Reload Safety")]
        private static void StartProbe()
        {
            if (EditorApplication.isCompiling)
            {
                Debug.LogError("[Unity AI Bridge] Mutation lifecycle reload self-test FAILED: Unity is already compiling.");
                return;
            }

            if (!string.IsNullOrEmpty(SessionState.GetString(MarkerKey, string.Empty)))
            {
                Debug.LogError("[Unity AI Bridge] Mutation lifecycle reload self-test FAILED: a previous probe marker is still pending.");
                return;
            }

            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var marker = new ProbeMarker
            {
                mutationId = "verify-lifecycle-" + Guid.NewGuid().ToString("N"),
                objectName = "MCP_Lifecycle_Reload_" + suffix,
                domainGenerationBefore = DomainGeneration,
            };

            var stateBefore = EditorStateRevision.Capture();
            var fingerprint = GameObjectCreateCommand.BuildIntentFingerprint(
                marker.objectName,
                string.Empty,
                0);

            EditorMutationLifecycle.Begin(
                "gameObject.create",
                marker.mutationId,
                fingerprint,
                stateBefore);

            SessionState.SetString(MarkerKey, JsonUtility.ToJson(marker));
            Debug.Log(
                "[Unity AI Bridge] Mutation lifecycle reload probe ARMED. " +
                "Requesting script compilation/domain reload now; the probe will continue automatically afterward.");

            CompilationPipeline.RequestScriptCompilation();
        }

        private static void ContinueAfterReload()
        {
            if (EditorApplication.isCompiling)
            {
                EditorApplication.delayCall += ContinueAfterReload;
                return;
            }

            var json = SessionState.GetString(MarkerKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return;
            }

            var marker = JsonUtility.FromJson<ProbeMarker>(json);
            if (marker == null || string.IsNullOrEmpty(marker.mutationId))
            {
                SessionState.EraseString(MarkerKey);
                Debug.LogError("[Unity AI Bridge] Mutation lifecycle reload self-test FAILED: probe marker was invalid after reload.");
                return;
            }

            try
            {
                if (string.Equals(
                    marker.domainGenerationBefore,
                    DomainGeneration,
                    StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "The probe resumed without observing a new script-domain generation.");
                }

                var record = EditorMutationLifecycle.Read(marker.mutationId);
                if (record == null ||
                    !string.Equals(record.status, EditorMutationLifecycle.StartedStatus, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "The started mutation lifecycle record did not survive domain reload.");
                }

                var rejected = false;
                var rejectionMessage = string.Empty;
                try
                {
                    GameObjectCreateCommand.Execute(marker.objectName, marker.mutationId);
                }
                catch (GameObjectCreateIncompleteException exception)
                {
                    rejected = true;
                    rejectionMessage = exception.Message;
                }

                var hierarchy = HierarchyCommand.Execute(
                    HierarchyCommand.MaximumMaxDepth,
                    HierarchyCommand.MaximumMaxNodes);
                var hierarchyMatches = 0;
                foreach (var node in hierarchy.nodes)
                {
                    if (string.Equals(node.name, marker.objectName, StringComparison.Ordinal))
                    {
                        hierarchyMatches++;
                    }
                }

                if (!rejected)
                {
                    throw new InvalidOperationException(
                        "Retrying the started mutationId after domain reload was not rejected as incomplete.");
                }
                if (hierarchyMatches != 0)
                {
                    throw new InvalidOperationException(
                        $"The fail-closed retry created unexpected Unity state; hierarchyMatches={hierarchyMatches}.");
                }

                Debug.Log(
                    "[Unity AI Bridge] Mutation lifecycle + domain reload safety PASS: " +
                    $"mutationId={marker.mutationId}, lifecycleStatus={record.status}, " +
                    $"domainChanged=true, retryRejected=true, hierarchyMatches={hierarchyMatches}, " +
                    $"rejection={rejectionMessage}");
            }
            catch (Exception exception)
            {
                var unexpected = GameObject.Find(marker.objectName);
                if (unexpected != null)
                {
                    UnityEngine.Object.DestroyImmediate(unexpected);
                }

                Debug.LogError(
                    "[Unity AI Bridge] Mutation lifecycle + domain reload safety FAILED: " +
                    exception);
            }
            finally
            {
                EditorMutationLifecycle.ClearForVerification(marker.mutationId);
                SessionState.EraseString(MarkerKey);
            }
        }

        [Serializable]
        private sealed class ProbeMarker
        {
            public string mutationId;
            public string objectName;
            public string domainGenerationBefore;
        }
    }
}
