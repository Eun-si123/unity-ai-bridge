using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class ComponentMutationCommandTests
    {
        private const string ParseableGameObjectId =
            "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-1-0";
        private const string ParseableComponentId =
            "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-2-0";

        [Test]
        public void ResolveAddableType_FindsConcreteUnityComponent()
        {
            var resolved = ComponentMutationSnapshot.ResolveAddableType("UnityEngine.BoxCollider");
            Assert.That(resolved, Is.EqualTo(typeof(BoxCollider)));
        }

        [Test]
        public void ResolveAddableType_RejectsTransformFamily()
        {
            Assert.Throws<ComponentTypeUnavailableException>(() =>
                ComponentMutationSnapshot.ResolveAddableType("UnityEngine.Transform"));
        }

        [Test]
        public void ComponentAddValidateArguments_AcceptsDocumentedShape()
        {
            Assert.DoesNotThrow(() =>
                ComponentAddCommand.ValidateArguments(
                    ParseableGameObjectId,
                    "UnityEngine.BoxCollider",
                    "component-add-test",
                    "test-epoch",
                    1));
        }

        [Test]
        public void ComponentRemoveValidateArguments_AcceptsDocumentedShape()
        {
            Assert.DoesNotThrow(() =>
                ComponentRemoveCommand.ValidateArguments(
                    ParseableComponentId,
                    "component-remove-test",
                    "test-epoch",
                    1));
        }

        [Test]
        public void ComponentAddFingerprint_DistinguishesTypeIntent()
        {
            var first = ComponentAddCommand.BuildIntentFingerprint(
                ParseableGameObjectId,
                "UnityEngine.BoxCollider",
                "test-epoch",
                1);
            var second = ComponentAddCommand.BuildIntentFingerprint(
                ParseableGameObjectId,
                "UnityEngine.SphereCollider",
                "test-epoch",
                1);

            Assert.That(first, Is.Not.EqualTo(second));
            Assert.That(first, Does.Contain("UnityEngine.BoxCollider"));
        }

        [Test]
        public void ComponentSnapshotMatches_RequiresExactIdentityOwnerAndType()
        {
            var snapshot = new ComponentSnapshotPayload
            {
                globalObjectId = ParseableComponentId,
                gameObjectGlobalObjectId = ParseableGameObjectId,
                typeName = "UnityEngine.BoxCollider",
            };

            Assert.That(
                ComponentMutationSnapshot.Matches(
                    snapshot,
                    ParseableComponentId,
                    ParseableGameObjectId,
                    "UnityEngine.BoxCollider"),
                Is.True);
            Assert.That(
                ComponentMutationSnapshot.Matches(
                    snapshot,
                    ParseableComponentId,
                    ParseableGameObjectId,
                    "UnityEngine.SphereCollider"),
                Is.False);
        }
    }
}
