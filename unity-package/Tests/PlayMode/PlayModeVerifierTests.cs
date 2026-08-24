using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace UnityAiBridge.PlayMode.Tests
{
    public sealed class PlayModeVerifierTests
    {
        [UnityTest]
        public IEnumerator RunsOneFrameInsidePlayMode()
        {
            Assert.IsTrue(Application.isPlaying);
            yield return null;
            Assert.IsTrue(Application.isPlaying);
        }
    }
}
