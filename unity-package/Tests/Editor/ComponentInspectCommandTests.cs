using System;
using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class ComponentInspectCommandTests
    {
        // Non-zero asset GUID keeps this fixture syntactically parseable without requiring
        // the referenced object to exist in the consuming Unity project.
        private const string ParseableGlobalObjectId =
            "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-1-0";

        [Test]
        public void ValidateArguments_AcceptsDocumentedBounds()
        {
            Assert.DoesNotThrow(() =>
                ComponentInspectCommand.ValidateArguments(
                    ParseableGlobalObjectId,
                    1,
                    1,
                    0));

            Assert.DoesNotThrow(() =>
                ComponentInspectCommand.ValidateArguments(
                    ParseableGlobalObjectId,
                    ComponentInspectCommand.MaximumMaxComponents,
                    ComponentInspectCommand.MaximumMaxPropertiesPerComponent,
                    ComponentInspectCommand.MaximumMaxDepth));
        }

        [Test]
        public void ValidateArguments_RejectsOutOfRangeLimits()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ComponentInspectCommand.ValidateArguments(ParseableGlobalObjectId, 0, 1, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ComponentInspectCommand.ValidateArguments(ParseableGlobalObjectId, 1, 0, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ComponentInspectCommand.ValidateArguments(
                    ParseableGlobalObjectId,
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
