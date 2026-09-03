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
            var temporaryScene = EditorSceneManager.NewScene(
                NewSceneSetup.EmptyScene,
                NewSceneMode.Single);

            try
            {
                Assert.That(temporaryScene.IsValid(), Is.True);
                Assert.That(temporaryScene.isLoaded, Is.True);
                Assert.That(temporaryScene.path, Is.Empty);

                var exception = Assert.Throws<GameObjectCreateUnsavedSceneException>(
                    GameObjectCreateCommand.EnsureActiveSceneSupportsDurableIdentity);

                Assert.That(exception, Is.Not.Null);
                StringAssert.Contains("saved to an asset", exception.Message);
                StringAssert.Contains("GlobalObjectId", exception.Message);
            }
            finally
            {
                if (originalScene.IsValid() && originalScene.isLoaded && !string.IsNullOrEmpty(originalScene.path))
                {
                    EditorSceneManager.OpenScene(originalScene.path, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
                }
            }
        }
    }
}
