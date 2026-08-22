using System;
using System.IO;
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
    }

    internal static class EditorStatusCommand
    {
        public static EditorStatusPayload Execute()
        {
            var projectRoot = Directory.GetParent(Application.dataPath);
            var activeScene = SceneManager.GetActiveScene();

            return new EditorStatusPayload
            {
                unityVersion = Application.unityVersion,
                projectName = projectRoot != null ? projectRoot.Name : string.Empty,
                activeScene = string.IsNullOrEmpty(activeScene.path) ? activeScene.name : activeScene.path,
                isPlaying = EditorApplication.isPlaying,
                isCompiling = EditorApplication.isCompiling,
            };
        }
    }
}
