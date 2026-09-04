using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityAiBridge.Editor.Connection;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    internal sealed class TaskJournalWireNormalizationTests
    {
        [Test]
        public void GameObjectUpdate_OmittedTransformFields_AreNormalizedAfterJsonUtility()
        {
            const string json =
                "{\"index\":0,\"operation\":\"gameObject.update\",\"mutationId\":\"wire-update\",\"globalObjectId\":\"GlobalObjectId_V1-2-example-1-0\",\"name\":\"Updated\",\"activeSelf\":true}";

            var step = JsonUtility.FromJson<TaskStepPlanPayload>(json);
            Assert.That(step, Is.Not.Null);

            LocalBridgeConnection.NormalizeTaskStepJsonUtilityArtifacts(new[] { step });

            Assert.That(step.localPosition, Is.Null);
            Assert.That(step.localEulerAngles, Is.Null);
            Assert.That(step.localScale, Is.Null);
        }

        [Test]
        public void GameObjectUpdate_NonDefaultIrrelevantTransformField_RemainsRejectable()
        {
            var step = new TaskStepPlanPayload
            {
                index = 0,
                operation = TaskJournalCommand.GameObjectUpdateOperation,
                mutationId = "wire-update-nondefault",
                globalObjectId = "GlobalObjectId_V1-2-example-1-0",
                name = "Updated",
                activeSelf = true,
                localPosition = new TransformVector3Payload { x = 1f, y = 0f, z = 0f },
                localEulerAngles = new TransformVector3Payload(),
                localScale = new TransformVector3Payload(),
            };

            LocalBridgeConnection.NormalizeTaskStepJsonUtilityArtifacts(new[] { step });

            Assert.That(step.localPosition, Is.Not.Null);
            Assert.That(step.localEulerAngles, Is.Null);
            Assert.That(step.localScale, Is.Null);
        }

        [Test]
        public void TransformSet_ZeroVectors_AreNeverNormalizedAway()
        {
            var step = new TaskStepPlanPayload
            {
                index = 0,
                operation = TaskJournalCommand.TransformSetOperation,
                mutationId = "wire-transform-zero",
                globalObjectId = "GlobalObjectId_V1-2-example-1-0",
                localPosition = new TransformVector3Payload(),
                localEulerAngles = new TransformVector3Payload(),
                localScale = new TransformVector3Payload(),
            };

            LocalBridgeConnection.NormalizeTaskStepJsonUtilityArtifacts(new[] { step });

            Assert.That(step.localPosition, Is.Not.Null);
            Assert.That(step.localEulerAngles, Is.Not.Null);
            Assert.That(step.localScale, Is.Not.Null);
        }
    }
}
