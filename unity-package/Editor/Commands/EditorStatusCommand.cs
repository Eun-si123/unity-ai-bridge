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
        public bool isPaused;
        public bool isPlayingOrWillChangePlaymode;
        public string playModeState;
        public bool enterPlayModeOptionsEnabled;
        public bool disableDomainReload;
        public bool disableSceneReload;
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
            "editor.playMode.set",
            "scene.hierarchy",
            "editor.diagnostics",
            "object.resolve",
            "gameObject.create",
            "gameObject.update",
            "gameObject.delete",
            "component.inspect",
            "component.add",
            "component.remove",
            "component.property.set",
            "asset.search",
            "asset.inspect",
            "script.read",
            "script.replace",
            "prefab.inspect",
            "prefab.instantiate",
            "prefab.asset.create",
            "prefab.property.apply",
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
            var playMode = PlayModeCommand.CaptureSnapshot();

            return new EditorStatusPayload
            {
                unityVersion = Application.unityVersion,
                projectName = projectRoot != null ? projectRoot.Name : string.Empty,
                activeScene = string.IsNullOrEmpty(activeScene.path) ? activeScene.name : activeScene.path,
                isPlaying = playMode.isPlaying,
                isPaused = playMode.isPaused,
                isPlayingOrWillChangePlaymode = playMode.isPlayingOrWillChangePlaymode,
                playModeState = playMode.mode,
                enterPlayModeOptionsEnabled = playMode.enterPlayModeOptionsEnabled,
                disableDomainReload = playMode.disableDomainReload,
                disableSceneReload = playMode.disableSceneReload,
                isCompiling = EditorApplication.isCompiling,
                agentVersion = BridgeProtocol.PackageVersion,
                capabilities = Capabilities,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
            };
        }
    }
}
