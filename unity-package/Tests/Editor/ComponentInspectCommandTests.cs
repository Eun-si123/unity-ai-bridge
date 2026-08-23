using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class ComponentInspectCommandTests
    {
        [Test]
        public void ValidateArguments_AcceptsDocumentedBounds()
        {
            Assert.DoesNotThrow(() =>
                ComponentInspectCommand.ValidateArguments(
                    "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0",
                    1,
                    1,
                    0));

            Assert.DoesNotThrow(() =>
                ComponentInspectCommand.ValidateArguments(
                    "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0",
                    ComponentInspectCommand.MaximumMaxComponents,
                    ComponentInspectCommand.MaximumMaxPropertiesPerComponent,
                    ComponentInspectCommand.MaximumMaxDepth));
        }

        [Test]
        public void ValidateArguments_RejectsOutOfRangeLimits()
        {
            var id = "GlobalObjectId_V1-2-00000000000000000000000000000000-1-0";
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ComponentInspectCommand.ValidateArguments(id, 0, 1, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ComponentInspectCommand.ValidateArguments(id, 1, 0, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ComponentInspectCommand.ValidateArguments(
                    id,
                    1,
                    1,
                    ComponentInspectCommand.MaximumMaxDepth + 1));
        }

        [Test]
        public void CaptureProperty_ReportsScalarValuesWithoutReflection()
        {
            var asset = ScriptableObject.CreateInstance<ComponentInspectTestAsset>();
            try
            {
                asset.number = 42;
                asset.label = "hello";
                var serializedObject = new SerializedObject(asset);
                serializedObject.UpdateIfRequiredOrScript();

                var number = ComponentInspectCommand.CaptureProperty(
                    serializedObject.FindProperty(nameof(ComponentInspectTestAsset.number)));
                var label = ComponentInspectCommand.CaptureProperty(
                    serializedObject.FindProperty(nameof(ComponentInspectTestAsset.label)));

                Assert.That(number.valueKind, Is.EqualTo("integer"));
                Assert.That(number.longValue, Is.EqualTo(42));
                Assert.That(label.valueKind, Is.EqualTo("string"));
                Assert.That(label.stringValue, Is.EqualTo("hello"));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(asset);
            }
        }

        [Test]
        public void CaptureProperty_ReportsObjectReferenceMetadata()
        {
            var asset = ScriptableObject.CreateInstance<ComponentInspectTestAsset>();
            try
            {
                asset.name = "ComponentInspectTestAsset";
                asset.reference = asset;
                var serializedObject = new SerializedObject(asset);
                serializedObject.UpdateIfRequiredOrScript();

                var reference = ComponentInspectCommand.CaptureProperty(
                    serializedObject.FindProperty(nameof(ComponentInspectTestAsset.reference)));

                Assert.That(reference.valueKind, Is.EqualTo("objectReference"));
                Assert.That(reference.objectReferenceInstanceId, Is.EqualTo(asset.GetInstanceID()));
                Assert.That(reference.objectReferenceName, Is.EqualTo(asset.name));
                Assert.That(reference.objectReferenceType, Does.Contain(nameof(ComponentInspectTestAsset)));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(asset);
            }
        }
    }

    internal sealed class ComponentInspectTestAsset : ScriptableObject
    {
        public int number;
        public string label;
        public UnityEngine.Object reference;
    }
}
