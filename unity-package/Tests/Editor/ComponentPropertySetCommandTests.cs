using NUnit.Framework;
using UnityAiBridge.Editor.Commands;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Tests
{
    public sealed class ComponentPropertySetCommandTests
    {
        private const string ParseableComponentId =
            "GlobalObjectId_V1-2-0123456789abcdef0123456789abcdef-3-0";

        [Test]
        public void ValidateArguments_AcceptsSupportedValue()
        {
            Assert.DoesNotThrow(() =>
                ComponentPropertySetCommand.ValidateArguments(
                    ParseableComponentId,
                    "m_IsTrigger",
                    ComponentPropertyValuePayload.Boolean(true),
                    "component-property-test",
                    "test-epoch",
                    1));
        }

        [Test]
        public void ValidateArguments_RejectsMissingPropertyPath()
        {
            Assert.Throws<System.ArgumentException>(() =>
                ComponentPropertySetCommand.ValidateArguments(
                    ParseableComponentId,
                    "",
                    ComponentPropertyValuePayload.Boolean(true),
                    "component-property-test",
                    "test-epoch",
                    1));
        }

        [Test]
        public void ValidateArguments_RejectsUnsupportedValueKind()
        {
            Assert.Throws<ComponentPropertyUnsupportedException>(() =>
                ComponentPropertySetCommand.ValidateArguments(
                    ParseableComponentId,
                    "m_Anything",
                    new ComponentPropertyValuePayload { kind = "objectReference" },
                    "component-property-test",
                    "test-epoch",
                    1));
        }

        [Test]
        public void BuildIntentFingerprint_IncludesPathAndValueIntent()
        {
            var first = ComponentPropertySetCommand.BuildIntentFingerprint(
                ParseableComponentId,
                "m_IsTrigger",
                ComponentPropertyValuePayload.Boolean(true),
                "test-epoch",
                1);
            var second = ComponentPropertySetCommand.BuildIntentFingerprint(
                ParseableComponentId,
                "m_IsTrigger",
                ComponentPropertyValuePayload.Boolean(false),
                "test-epoch",
                1);
            var third = ComponentPropertySetCommand.BuildIntentFingerprint(
                ParseableComponentId,
                "m_Enabled",
                ComponentPropertyValuePayload.Boolean(true),
                "test-epoch",
                1);

            Assert.That(first, Is.Not.EqualTo(second));
            Assert.That(first, Is.Not.EqualTo(third));
            Assert.That(first, Does.Contain("m_IsTrigger"));
        }

        [Test]
        public void ApplyRequestedValue_SupportsFirstSliceTypes()
        {
            var probe = ScriptableObject.CreateInstance<ComponentPropertyProbe>();
            try
            {
                var serializedObject = new SerializedObject(probe);
                serializedObject.Update();

                Assert.That(
                    ComponentPropertySetCommand.ApplyRequestedValueForTests(
                        serializedObject.FindProperty(nameof(ComponentPropertyProbe.boolValue)),
                        ComponentPropertyValuePayload.Boolean(true)),
                    Is.True);
                Assert.That(
                    ComponentPropertySetCommand.ApplyRequestedValueForTests(
                        serializedObject.FindProperty(nameof(ComponentPropertyProbe.intValue)),
                        ComponentPropertyValuePayload.Integer(42)),
                    Is.True);
                Assert.That(
                    ComponentPropertySetCommand.ApplyRequestedValueForTests(
                        serializedObject.FindProperty(nameof(ComponentPropertyProbe.floatValue)),
                        ComponentPropertyValuePayload.Number(3.5d)),
                    Is.True);
                Assert.That(
                    ComponentPropertySetCommand.ApplyRequestedValueForTests(
                        serializedObject.FindProperty(nameof(ComponentPropertyProbe.stringValue)),
                        ComponentPropertyValuePayload.String("bridge")),
                    Is.True);
                Assert.That(
                    ComponentPropertySetCommand.ApplyRequestedValueForTests(
                        serializedObject.FindProperty(nameof(ComponentPropertyProbe.vectorValue)),
                        ComponentPropertyValuePayload.Vector3(new Vector3(1.25f, -2.5f, 3.75f))),
                    Is.True);

                serializedObject.ApplyModifiedPropertiesWithoutUndo();

                Assert.That(probe.boolValue, Is.True);
                Assert.That(probe.intValue, Is.EqualTo(42));
                Assert.That(probe.floatValue, Is.EqualTo(3.5f).Within(0.0001f));
                Assert.That(probe.stringValue, Is.EqualTo("bridge"));
                Assert.That(probe.vectorValue, Is.EqualTo(new Vector3(1.25f, -2.5f, 3.75f)));
            }
            finally
            {
                Object.DestroyImmediate(probe);
            }
        }

        [Test]
        public void PropertyMatchesRequested_DetectsMatchAndMismatch()
        {
            var probe = ScriptableObject.CreateInstance<ComponentPropertyProbe>();
            try
            {
                var serializedObject = new SerializedObject(probe);
                serializedObject.Update();
                var property = serializedObject.FindProperty(nameof(ComponentPropertyProbe.vectorValue));
                property.vector3Value = new Vector3(2f, 3f, 4f);
                serializedObject.ApplyModifiedPropertiesWithoutUndo();
                serializedObject.Update();
                property = serializedObject.FindProperty(nameof(ComponentPropertyProbe.vectorValue));

                Assert.That(
                    ComponentPropertySetCommand.PropertyMatchesRequestedForTests(
                        property,
                        ComponentPropertyValuePayload.Vector3(new Vector3(2f, 3f, 4f))),
                    Is.True);
                Assert.That(
                    ComponentPropertySetCommand.PropertyMatchesRequestedForTests(
                        property,
                        ComponentPropertyValuePayload.Vector3(new Vector3(2f, 3f, 5f))),
                    Is.False);
            }
            finally
            {
                Object.DestroyImmediate(probe);
            }
        }

        private sealed class ComponentPropertyProbe : ScriptableObject
        {
            public bool boolValue;
            public int intValue;
            public float floatValue;
            public string stringValue = string.Empty;
            public Vector3 vectorValue;
        }
    }
}
