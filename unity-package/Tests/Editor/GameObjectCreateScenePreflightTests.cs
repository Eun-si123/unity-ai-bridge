using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class GameObjectCreateScenePreflightTests
    {
        [Test]
        public void UnsavedActiveSceneIsRejectedBeforeCreate()
        {
            var originalScene = SceneManager.GetActiveScene();
            var originalSceneWasUnsaved = originalScene.IsValid() &&
                originalScene.isLoaded &&
                string.IsNullOrEmpty(originalScene.path);

            Scene temporaryScene = default;
            var createdTemporaryScene = false;

            try
            {
                if (!originalSceneWasUnsaved)
                {
                    temporaryScene = EditorSceneManager.NewScene(
                        NewSceneSetup.EmptyScene,
                        NewSceneMode.Additive);
                    createdTemporaryScene = true;
                    SceneManager.SetActiveScene(temporaryScene);
                }

                var activeScene = SceneManager.GetActiveScene();
                Assert.That(activeScene.IsValid(), Is.True);
                Assert.That(activeScene.isLoaded, Is.True);
                Assert.That(activeScene.path, Is.Empty);

                var exception = Assert.Throws<GameObjectCreateUnsavedSceneException>(
                    GameObjectCreateCommand.EnsureActiveSceneSupportsDurableIdentity);

                Assert.That(exception, Is.Not.Null);
                StringAssert.Contains("saved to an asset", exception.Message);
                StringAssert.Contains("GlobalObjectId", exception.Message);
            }
            finally
            {
                if (createdTemporaryScene && temporaryScene.IsValid() && temporaryScene.isLoaded)
                {
                    if (originalScene.IsValid() && originalScene.isLoaded)
                    {
                        SceneManager.SetActiveScene(originalScene);
                    }

                    EditorSceneManager.CloseScene(temporaryScene, true);
                }
            }
        }
    }
}
