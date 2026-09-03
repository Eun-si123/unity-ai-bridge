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
                NewSceneMode.Additive);

            try
            {
                Assert.That(temporaryScene.IsValid(), Is.True);
                Assert.That(temporaryScene.isLoaded, Is.True);
                Assert.That(temporaryScene.path, Is.Empty);
                Assert.That(SceneManager.SetActiveScene(temporaryScene), Is.True);

                var exception = Assert.Throws<GameObjectCreateUnsavedSceneException>(
                    GameObjectCreateCommand.EnsureActiveSceneSupportsDurableIdentity);

                Assert.That(exception, Is.Not.Null);
                StringAssert.Contains("saved to an asset", exception.Message);
                StringAssert.Contains("GlobalObjectId", exception.Message);
            }
            finally
            {
                if (originalScene.IsValid() && originalScene.isLoaded)
                {
                    SceneManager.SetActiveScene(originalScene);
                }
                if (temporaryScene.IsValid() && temporaryScene.isLoaded)
                {
                    EditorSceneManager.CloseScene(temporaryScene, true);
                }
            }
        }
    }
}
