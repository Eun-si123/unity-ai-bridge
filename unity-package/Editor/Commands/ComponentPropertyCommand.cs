using System;
using System.Globalization;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class ComponentPropertyValuePayload
    {
        public string kind;
        public bool boolValue;
        public long longValue;
        public double doubleValue;
        public string stringValue;
        public TransformVector3Payload vector3Value;

        public static ComponentPropertyValuePayload Boolean(bool value)
        {
            return new ComponentPropertyValuePayload
            {
                kind = "boolean",
                boolValue = value,
                stringValue = string.Empty,
            };
        }

        public static ComponentPropertyValuePayload Integer(long value)
        {
            return new ComponentPropertyValuePayload
            {
                kind = "integer",
                longValue = value,
                stringValue = string.Empty,
            };
        }

        public static ComponentPropertyValuePayload Number(double value)
        {
            return new ComponentPropertyValuePayload
            {
                kind = "number",
                doubleValue = value,
                stringValue = string.Empty,
            };
        }

        public static ComponentPropertyValuePayload String(string value)
        {
            return new ComponentPropertyValuePayload
            {
                kind = "string",
                stringValue = value ?? string.Empty,
            };
        }

        public static ComponentPropertyValuePayload Vector3(Vector3 value)
        {
            return new ComponentPropertyValuePayload
            {
                kind = "vector3",
                stringValue = string.Empty,
                vector3Value = TransformVector3Payload.From(value),
            };
        }
    }

    [Serializable]
    internal sealed class ComponentPropertySetPayload
    {
        public string mutationId;
        public bool replayed;
        public bool changed;
        public string requestedComponentGlobalObjectId;
        public string requestedPropertyPath;
        public ComponentPropertyValuePayload requestedValue;
        public string expectedStateEpoch;
        public long expectedStateRevision;
        public ComponentSnapshotPayload component;
        public ComponentPropertyPayload property;
    }

    internal sealed class ComponentPropertyUnavailableException : InvalidOperationException
    {
        public ComponentPropertyUnavailableException(string message) : base(message) { }
    }

    internal sealed class ComponentPropertyUnsupportedException : InvalidOperationException
    {
        public ComponentPropertyUnsupportedException(string message) : base(message) { }
    }

    internal static class ComponentPropertySetCommand
    {
        public const int MaximumPropertyPathLength = 512;
        public const int MaximumStringValueLength = 4096;

        private const string SessionKeyPrefix = "UnityAiBridge.Mutation.ComponentPropertySet.";
        private const string UndoGroupName = "Unity AI Bridge: Set Component Property";
        private const double NumberTolerance = 0.000001d;
        private const float VectorTolerance = 0.00001f;

        public static void ValidateArguments(
            string componentGlobalObjectId,
            string propertyPath,
            ComponentPropertyValuePayload value,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ObjectResolverCommand.ValidateArguments(componentGlobalObjectId);
            ValidatePropertyPath(propertyPath);
            ValidateValue(value);
            GameObjectUpdateCommand.ValidateMutationId(mutationId);
            GameObjectUpdateCommand.RequireStateExpectation(
                expectedStateEpoch,
                expectedStateRevision,
                "component.property.set");
        }

        public static ComponentPropertySetPayload Execute(
            string componentGlobalObjectId,
            string propertyPath,
            ComponentPropertyValuePayload value,
            string mutationId,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidateArguments(
                componentGlobalObjectId,
                propertyPath,
                value,
                mutationId,
                expectedStateEpoch,
                expectedStateRevision);

            if (EditorApplication.isCompiling)
            {
                throw new ComponentMutationCompilingException(
                    "Unity is compiling; component.property.set was not executed.");
            }

            var sessionKey = SessionKeyPrefix + mutationId;
            var cachedJson = SessionState.GetString(sessionKey, string.Empty);
            if (!string.IsNullOrEmpty(cachedJson))
            {
                var cached = JsonUtility.FromJson<ComponentPropertySetPayload>(cachedJson);
                if (cached == null || cached.component == null || cached.property == null ||
                    cached.requestedValue == null || string.IsNullOrEmpty(cached.mutationId))
                {
                    throw new InvalidOperationException(
                        "The cached component.property.set mutation result is invalid.");
                }

                EnsureSameIntent(
                    cached,
                    componentGlobalObjectId,
                    propertyPath,
                    value,
                    expectedStateEpoch,
                    expectedStateRevision);

                PropertyReadback replayReadback;
                try
                {
                    replayReadback = ReadCurrent(
                        cached.component.globalObjectId,
                        cached.requestedPropertyPath,
                        requireActiveScene: true);
                }
                catch (Exception exception)
                    when (exception is ComponentPropertyUnavailableException ||
                          exception is ComponentMutationTargetUnavailableException)
                {
                    throw new ComponentMutationReplayStaleException(
                        "The cached component.property.set target/property is no longer available. " +
                        exception.Message);
                }

                if (!PropertyMatchesRequested(replayReadback.serializedProperty, cached.requestedValue))
                {
                    throw new ComponentMutationReplayStaleException(
                        "The cached component.property.set target no longer has the completed property value. " +
                        "The same mutationId will not reapply it automatically.");
                }

                cached.component = replayReadback.component;
                cached.property = replayReadback.property;
                cached.replayed = true;
                SessionState.SetString(sessionKey, JsonUtility.ToJson(cached));
                return cached;
            }

            EditorMutationExecution<PropertyMutationState> execution;
            try
            {
                execution = EditorMutationTransaction.ExecuteWithOutcome(
                    "component.property.set",
                    UndoGroupName,
                    expectedStateEpoch,
                    expectedStateRevision,
                    mutationId,
                    BuildIntentFingerprint(
                        componentGlobalObjectId,
                        propertyPath,
                        value,
                        expectedStateEpoch,
                        expectedStateRevision),
                    context => Mutate(
                        context,
                        componentGlobalObjectId,
                        propertyPath,
                        value),
                    (_, state) => VerifyMutation(state),
                    (_, state) => VerifyRollback(state));
            }
            catch (EditorMutationPreflightException exception)
                when (exception.Failure == EditorMutationPreflightFailure.Compiling)
            {
                throw new ComponentMutationCompilingException(exception.Message);
            }
            catch (EditorMutationLifecycleConflictException exception)
            {
                throw new ComponentMutationConflictException(exception.Message);
            }
            catch (EditorMutationIncompleteException exception)
            {
                throw new ComponentMutationIncompleteException(exception.Message);
            }
            catch (EditorMutationVerificationException exception)
            {
                throw new ComponentMutationReadbackException(exception.Message);
            }

            if (!execution.outcome.verified || execution.outcome.rolledBack || execution.value.readback == null)
            {
                throw new InvalidOperationException(
                    "component.property.set transaction returned an inconsistent successful verification outcome.");
            }

            var stateAfter = EditorStateRevision.Capture();
            execution.value.readback.component.stateEpoch = stateAfter.epoch;
            execution.value.readback.component.stateRevision = stateAfter.revision;

            var result = new ComponentPropertySetPayload
            {
                mutationId = mutationId,
                replayed = false,
                changed = execution.outcome.changed,
                requestedComponentGlobalObjectId = componentGlobalObjectId,
                requestedPropertyPath = propertyPath,
                requestedValue = CloneValue(value),
                expectedStateEpoch = expectedStateEpoch,
                expectedStateRevision = expectedStateRevision,
                component = execution.value.readback.component,
                property = execution.value.readback.property,
            };

            SessionState.SetString(sessionKey, JsonUtility.ToJson(result));
            return result;
        }

        internal static string BuildIntentFingerprint(
            string componentGlobalObjectId,
            string propertyPath,
            ComponentPropertyValuePayload value,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            ValidatePropertyPath(propertyPath);
            ValidateValue(value);
            return string.Join(
                "|",
                "target:" + componentGlobalObjectId,
                "path:" + propertyPath.Length.ToString(CultureInfo.InvariantCulture) + ":" + propertyPath,
                "value:" + BuildValueFingerprint(value),
                "epoch:" + expectedStateEpoch,
                "revision:" + expectedStateRevision.ToString(CultureInfo.InvariantCulture));
        }

        internal static bool ApplyRequestedValueForTests(
            SerializedProperty property,
            ComponentPropertyValuePayload value)
        {
            return ApplyRequestedValue(property, value);
        }

        internal static bool PropertyMatchesRequestedForTests(
            SerializedProperty property,
            ComponentPropertyValuePayload value)
        {
            return PropertyMatchesRequested(property, value);
        }

        private static PropertyMutationState Mutate(
            EditorMutationContext context,
            string componentGlobalObjectId,
            string propertyPath,
            ComponentPropertyValuePayload requestedValue)
        {
            var readback = ReadCurrent(componentGlobalObjectId, propertyPath, requireActiveScene: false);
            ComponentMutationSnapshot.RequireActiveSceneOwner(
                readback.componentObject,
                context.activeScene,
                "component.property.set");

            var originalValue = CaptureValue(readback.serializedProperty);
            var changed = !PropertyMatchesRequested(readback.serializedProperty, requestedValue);
            if (changed)
            {
                var serializedObject = readback.serializedProperty.serializedObject;
                ApplyRequestedValue(readback.serializedProperty, requestedValue);

                // SerializedObject.ApplyModifiedProperties records Unity Undo. Mark the common
                // transaction before applying so a partially failed apply is still treated as
                // potentially mutated and therefore eligible for rollback.
                context.MarkUndoRecorded();
                if (!serializedObject.ApplyModifiedProperties())
                {
                    throw new ComponentMutationReadbackException(
                        "Unity reported no applied serialized change after component.property.set prepared a different value.");
                }
                EditorSceneManager.MarkSceneDirty(context.activeScene);
            }

            return new PropertyMutationState
            {
                componentGlobalObjectId = readback.component.globalObjectId,
                propertyPath = propertyPath,
                requestedValue = CloneValue(requestedValue),
                originalValue = originalValue,
                originalComponent = readback.component,
                readback = null,
            };
        }

        private static bool VerifyMutation(PropertyMutationState state)
        {
            if (state == null || string.IsNullOrEmpty(state.componentGlobalObjectId) ||
                string.IsNullOrEmpty(state.propertyPath) || state.requestedValue == null)
            {
                return false;
            }

            try
            {
                state.readback = ReadCurrent(
                    state.componentGlobalObjectId,
                    state.propertyPath,
                    requireActiveScene: true);
            }
            catch (Exception exception)
                when (exception is ComponentPropertyUnavailableException ||
                      exception is ComponentMutationTargetUnavailableException)
            {
                return false;
            }

            return ComponentMutationSnapshot.Matches(
                    state.readback.component,
                    state.componentGlobalObjectId,
                    state.originalComponent.gameObjectGlobalObjectId,
                    state.originalComponent.typeName) &&
                PropertyMatchesRequested(state.readback.serializedProperty, state.requestedValue);
        }

        private static bool VerifyRollback(PropertyMutationState state)
        {
            if (state == null || state.originalValue == null || state.originalComponent == null ||
                string.IsNullOrEmpty(state.componentGlobalObjectId) || string.IsNullOrEmpty(state.propertyPath))
            {
                return false;
            }

            PropertyReadback rollbackReadback;
            try
            {
                rollbackReadback = ReadCurrent(
                    state.componentGlobalObjectId,
                    state.propertyPath,
                    requireActiveScene: true);
            }
            catch (Exception exception)
                when (exception is ComponentPropertyUnavailableException ||
                      exception is ComponentMutationTargetUnavailableException)
            {
                return false;
            }

            return ComponentMutationSnapshot.Matches(
                    rollbackReadback.component,
                    state.originalComponent.globalObjectId,
                    state.originalComponent.gameObjectGlobalObjectId,
                    state.originalComponent.typeName) &&
                rollbackReadback.component.componentIndex == state.originalComponent.componentIndex &&
                string.Equals(
                    rollbackReadback.component.scenePath,
                    state.originalComponent.scenePath,
                    StringComparison.Ordinal) &&
                PropertyMatchesRequested(rollbackReadback.serializedProperty, state.originalValue);
        }

        private static PropertyReadback ReadCurrent(
            string componentGlobalObjectId,
            string propertyPath,
            bool requireActiveScene)
        {
            var component = ResolveEditableComponent(
                componentGlobalObjectId,
                out var canonicalComponentGlobalObjectId);
            if (requireActiveScene)
            {
                var activeScene = SceneManager.GetActiveScene();
                if (!activeScene.IsValid() || !activeScene.isLoaded)
                {
                    throw new ComponentPropertyUnavailableException(
                        "The active scene is unavailable for component.property.set readback.");
                }
                ComponentMutationSnapshot.RequireActiveSceneOwner(
                    component,
                    activeScene,
                    "component.property.set");
            }

            var serializedObject = new SerializedObject(component);
            serializedObject.UpdateIfRequiredOrScript();
            var property = FindVisibleProperty(serializedObject, propertyPath);
            ValidateEditableProperty(property);

            var componentSnapshot = ComponentMutationSnapshot.Capture(
                component,
                canonicalComponentGlobalObjectId);
            return new PropertyReadback
            {
                componentObject = component,
                component = componentSnapshot,
                serializedProperty = property,
                property = ComponentInspectCommand.CaptureProperty(property),
            };
        }

        private static Component ResolveEditableComponent(
            string globalObjectId,
            out string canonicalGlobalObjectId)
        {
            ObjectResolverCommand.ValidateArguments(globalObjectId);
            GlobalObjectId.TryParse(globalObjectId, out var parsed);
            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
            var component = resolved as Component;
            if (component == null)
            {
                throw new ComponentMutationTargetUnavailableException(
                    resolved == null
                        ? "The requested Component target no longer exists or its scene is unavailable."
                        : "component.property.set requires a Component GlobalObjectId target.");
            }
            if (component is Transform)
            {
                throw new ComponentPropertyUnsupportedException(
                    "component.property.set does not edit Transform/RectTransform serialized fields; use transform.set instead.");
            }

            canonicalGlobalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString();
            return component;
        }

        private static SerializedProperty FindVisibleProperty(
            SerializedObject serializedObject,
            string propertyPath)
        {
            var iterator = serializedObject.GetIterator();
            var enterChildren = true;
            while (iterator.NextVisible(enterChildren))
            {
                enterChildren = true;
                if (string.Equals(iterator.propertyPath, propertyPath, StringComparison.Ordinal))
                {
                    return iterator.Copy();
                }
            }

            throw new ComponentPropertyUnavailableException(
                $"Visible serialized property '{propertyPath}' was not found on the target Component.");
        }

        private static void ValidateEditableProperty(SerializedProperty property)
        {
            if (property == null)
            {
                throw new ComponentPropertyUnavailableException("The requested serialized property is unavailable.");
            }
            if (string.Equals(property.propertyPath, "m_Script", StringComparison.Ordinal))
            {
                throw new ComponentPropertyUnsupportedException(
                    "component.property.set does not modify the m_Script reference.");
            }
            if (!property.editable)
            {
                throw new ComponentPropertyUnsupportedException(
                    $"Serialized property '{property.propertyPath}' is read-only in the current Unity context.");
            }
        }

        private static bool ApplyRequestedValue(
            SerializedProperty property,
            ComponentPropertyValuePayload value)
        {
            if (property == null)
            {
                throw new ArgumentNullException(nameof(property));
            }
            ValidateValue(value);
            ValidateEditableProperty(property);
            RequireValueKindMatchesProperty(property, value);

            var changed = !PropertyMatchesRequested(property, value);
            if (!changed)
            {
                return false;
            }

            switch (value.kind)
            {
                case "boolean":
                    property.boolValue = value.boolValue;
                    break;
                case "integer":
                    property.longValue = value.longValue;
                    break;
                case "number":
                    property.doubleValue = value.doubleValue;
                    break;
                case "string":
                    property.stringValue = value.stringValue ?? string.Empty;
                    break;
                case "vector3":
                    property.vector3Value = value.vector3Value.ToVector3();
                    break;
                default:
                    throw new ComponentPropertyUnsupportedException(
                        $"Unsupported component property value kind '{value.kind}'.");
            }

            return true;
        }

        private static bool PropertyMatchesRequested(
            SerializedProperty property,
            ComponentPropertyValuePayload value)
        {
            if (property == null || value == null)
            {
                return false;
            }

            RequireValueKindMatchesProperty(property, value);
            switch (value.kind)
            {
                case "boolean":
                    return property.boolValue == value.boolValue;
                case "integer":
                    return property.longValue == value.longValue;
                case "number":
                    return NearlyEqual(property.doubleValue, value.doubleValue);
                case "string":
                    return string.Equals(
                        property.stringValue ?? string.Empty,
                        value.stringValue ?? string.Empty,
                        StringComparison.Ordinal);
                case "vector3":
                    return NearlyEqual(property.vector3Value, value.vector3Value.ToVector3());
                default:
                    return false;
            }
        }

        private static ComponentPropertyValuePayload CaptureValue(SerializedProperty property)
        {
            switch (property.propertyType)
            {
                case SerializedPropertyType.Boolean:
                    return ComponentPropertyValuePayload.Boolean(property.boolValue);
                case SerializedPropertyType.Integer:
                    return ComponentPropertyValuePayload.Integer(property.longValue);
                case SerializedPropertyType.Float:
                    return ComponentPropertyValuePayload.Number(property.doubleValue);
                case SerializedPropertyType.String:
                    return ComponentPropertyValuePayload.String(property.stringValue ?? string.Empty);
                case SerializedPropertyType.Vector3:
                    return ComponentPropertyValuePayload.Vector3(property.vector3Value);
                default:
                    throw new ComponentPropertyUnsupportedException(
                        $"Serialized property '{property.propertyPath}' has unsupported type '{property.propertyType}'. " +
                        "This slice supports Boolean, Integer, Float, String, and Vector3 only.");
            }
        }

        private static void RequireValueKindMatchesProperty(
            SerializedProperty property,
            ComponentPropertyValuePayload value)
        {
            var matches =
                (value.kind == "boolean" && property.propertyType == SerializedPropertyType.Boolean) ||
                (value.kind == "integer" && property.propertyType == SerializedPropertyType.Integer) ||
                (value.kind == "number" && property.propertyType == SerializedPropertyType.Float) ||
                (value.kind == "string" && property.propertyType == SerializedPropertyType.String) ||
                (value.kind == "vector3" && property.propertyType == SerializedPropertyType.Vector3);
            if (!matches)
            {
                throw new ComponentPropertyUnsupportedException(
                    $"Requested value kind '{value.kind}' does not match serialized property " +
                    $"'{property.propertyPath}' type '{property.propertyType}'.");
            }
        }

        private static void ValidatePropertyPath(string propertyPath)
        {
            if (string.IsNullOrWhiteSpace(propertyPath))
            {
                throw new ArgumentException("propertyPath is required.", nameof(propertyPath));
            }
            if (propertyPath.Length > MaximumPropertyPathLength)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(propertyPath),
                    $"propertyPath must be at most {MaximumPropertyPathLength} characters.");
            }
        }

        private static void ValidateValue(ComponentPropertyValuePayload value)
        {
            if (value == null)
            {
                throw new ArgumentNullException(nameof(value));
            }

            switch (value.kind)
            {
                case "boolean":
                case "integer":
                    return;
                case "number":
                    if (double.IsNaN(value.doubleValue) || double.IsInfinity(value.doubleValue))
                    {
                        throw new ArgumentException("number component property values must be finite.", nameof(value));
                    }
                    return;
                case "string":
                    if (value.stringValue != null && value.stringValue.Length > MaximumStringValueLength)
                    {
                        throw new ArgumentOutOfRangeException(
                            nameof(value),
                            $"string component property values must be at most {MaximumStringValueLength} characters.");
                    }
                    return;
                case "vector3":
                    if (value.vector3Value == null ||
                        !IsFinite(value.vector3Value.x) ||
                        !IsFinite(value.vector3Value.y) ||
                        !IsFinite(value.vector3Value.z))
                    {
                        throw new ArgumentException(
                            "vector3 component property values require finite x/y/z values.",
                            nameof(value));
                    }
                    return;
                default:
                    throw new ComponentPropertyUnsupportedException(
                        "component.property.set supports value kinds: boolean, integer, number, string, vector3.");
            }
        }

        private static string BuildValueFingerprint(ComponentPropertyValuePayload value)
        {
            switch (value.kind)
            {
                case "boolean":
                    return "boolean:" + (value.boolValue ? "1" : "0");
                case "integer":
                    return "integer:" + value.longValue.ToString(CultureInfo.InvariantCulture);
                case "number":
                    return "number:" + value.doubleValue.ToString("R", CultureInfo.InvariantCulture);
                case "string":
                    var text = value.stringValue ?? string.Empty;
                    return "string:" + text.Length.ToString(CultureInfo.InvariantCulture) + ":" + text;
                case "vector3":
                    return string.Format(
                        CultureInfo.InvariantCulture,
                        "vector3:{0:R},{1:R},{2:R}",
                        value.vector3Value.x,
                        value.vector3Value.y,
                        value.vector3Value.z);
                default:
                    throw new ComponentPropertyUnsupportedException(
                        $"Unsupported component property value kind '{value.kind}'.");
            }
        }

        private static ComponentPropertyValuePayload CloneValue(ComponentPropertyValuePayload value)
        {
            return new ComponentPropertyValuePayload
            {
                kind = value.kind,
                boolValue = value.boolValue,
                longValue = value.longValue,
                doubleValue = value.doubleValue,
                stringValue = value.stringValue ?? string.Empty,
                vector3Value = value.vector3Value == null
                    ? null
                    : new TransformVector3Payload
                    {
                        x = value.vector3Value.x,
                        y = value.vector3Value.y,
                        z = value.vector3Value.z,
                    },
            };
        }

        private static void EnsureSameIntent(
            ComponentPropertySetPayload cached,
            string componentGlobalObjectId,
            string propertyPath,
            ComponentPropertyValuePayload value,
            string expectedStateEpoch,
            long expectedStateRevision)
        {
            if (!string.Equals(
                    cached.requestedComponentGlobalObjectId,
                    componentGlobalObjectId,
                    StringComparison.Ordinal) ||
                !string.Equals(cached.requestedPropertyPath, propertyPath, StringComparison.Ordinal) ||
                !ValuesEqual(cached.requestedValue, value) ||
                !string.Equals(cached.expectedStateEpoch, expectedStateEpoch, StringComparison.Ordinal) ||
                cached.expectedStateRevision != expectedStateRevision)
            {
                throw new ComponentMutationConflictException(
                    "mutationId was already used for component.property.set with different target, property, value, or state preconditions.");
            }
        }

        private static bool ValuesEqual(
            ComponentPropertyValuePayload left,
            ComponentPropertyValuePayload right)
        {
            if (left == null || right == null ||
                !string.Equals(left.kind, right.kind, StringComparison.Ordinal))
            {
                return false;
            }

            switch (left.kind)
            {
                case "boolean":
                    return left.boolValue == right.boolValue;
                case "integer":
                    return left.longValue == right.longValue;
                case "number":
                    return left.doubleValue.Equals(right.doubleValue);
                case "string":
                    return string.Equals(
                        left.stringValue ?? string.Empty,
                        right.stringValue ?? string.Empty,
                        StringComparison.Ordinal);
                case "vector3":
                    return left.vector3Value != null && right.vector3Value != null &&
                        left.vector3Value.x.Equals(right.vector3Value.x) &&
                        left.vector3Value.y.Equals(right.vector3Value.y) &&
                        left.vector3Value.z.Equals(right.vector3Value.z);
                default:
                    return false;
            }
        }

        private static bool NearlyEqual(double left, double right)
        {
            var difference = Math.Abs(left - right);
            if (difference <= NumberTolerance)
            {
                return true;
            }

            var scale = Math.Max(1d, Math.Max(Math.Abs(left), Math.Abs(right)));
            return difference <= NumberTolerance * scale;
        }

        private static bool NearlyEqual(Vector3 left, Vector3 right)
        {
            return Math.Abs(left.x - right.x) <= VectorTolerance &&
                Math.Abs(left.y - right.y) <= VectorTolerance &&
                Math.Abs(left.z - right.z) <= VectorTolerance;
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private sealed class PropertyMutationState
        {
            public string componentGlobalObjectId;
            public string propertyPath;
            public ComponentPropertyValuePayload requestedValue;
            public ComponentPropertyValuePayload originalValue;
            public ComponentSnapshotPayload originalComponent;
            public PropertyReadback readback;
        }

        private sealed class PropertyReadback
        {
            public Component componentObject;
            public ComponentSnapshotPayload component;
            public SerializedProperty serializedProperty;
            public ComponentPropertyPayload property;
        }
    }
}
