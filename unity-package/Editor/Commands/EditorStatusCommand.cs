using System;
using System.IO;
using UnityAiBridge.Editor.Execution;
using UnityAiBridge.Editor.Protocol;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class EditorStatusPayload
    {
        public string unityVersion;
        public string projectName;
        public string activeScene;
        public bool isPlaying;
        public bool isCompiling;
        public string agentVersion;
        public string[] capabilities;
        public string stateEpoch;
        public long stateRevision;
    }

    internal static class EditorStatusCommand
    {
        private static readonly string[] Capabilities =
        {
            "editor.status",
            "scene.hierarchy",
            "editor.diagnostics",
            "object.resolve",
            "gameObject.create",
            "scene.save",
            "transform.get",
            "transform.set",
            "state.revision.v1",
        };

        public static EditorStatusPayload Execute()
        {
            var projectRoot = Directory.GetParent(Application.dataPath);
            var activeScene = SceneManager.GetActiveScene();
            var state = EditorStateRevision.Capture();

            return new EditorStatusPayload
            {
                unityVersion = Application.unityVersion,
                projectName = projectRoot != null ? projectRoot.Name : string.Empty,
                activeScene = string.IsNullOrEmpty(activeScene.path) ? activeScene.name : activeScene.path,
                isPlaying = EditorApplication.isPlaying,
                isCompiling = EditorApplication.isCompiling,
                agentVersion = BridgeProtocol.PackageVersion,
                capabilities = Capabilities,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
            };
        }
    }
}
