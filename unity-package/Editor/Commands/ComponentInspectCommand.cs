using System;
using System.Collections.Generic;
using System.Globalization;
using UnityAiBridge.Editor.Execution;
using UnityEditor;
using UnityEngine;

namespace UnityAiBridge.Editor.Commands
{
    [Serializable]
    internal sealed class ComponentPropertyPayload
    {
        public string path;
        public string displayName;
        public int depth;
        public string propertyType;
        public bool isArray;
        public int arraySize;
        public bool hasVisibleChildren;
        public string valueKind;
        public string stringValue;
        public long longValue;
        public double doubleValue;
        public bool boolValue;
        public string objectReferenceGlobalObjectId;
        public int objectReferenceInstanceId;
        public string objectReferenceName;
        public string objectReferenceType;
    }

    [Serializable]
    internal sealed class ComponentInspectEntryPayload
    {
        public int index;
        public bool missingScript;
        public string globalObjectId;
        public int instanceId;
        public string typeName;
        public string assemblyQualifiedName;
        public string scriptAssetPath;
        public int returnedPropertyCount;
        public bool truncatedByPropertyLimit;
        public bool truncatedByDepth;
        public ComponentPropertyPayload[] properties;
    }

    [Serializable]
    internal sealed class ComponentInspectPayload
    {
        public GameObjectSnapshotPayload gameObject;
        public int componentCount;
        public int returnedComponentCount;
        public int missingScriptCount;
        public bool truncatedByComponentLimit;
        public int maxComponents;
        public int maxPropertiesPerComponent;
        public int maxDepth;
        public ComponentInspectEntryPayload[] components;
        public string stateEpoch;
        public long stateRevision;
    }

    internal static class ComponentInspectCommand
    {
        public const int DefaultMaxComponents = 32;
        public const int MaximumMaxComponents = 64;
        public const int DefaultMaxPropertiesPerComponent = 128;
        public const int MaximumMaxPropertiesPerComponent = 256;
        public const int DefaultMaxDepth = 4;
        public const int MaximumMaxDepth = 8;

        public static void ValidateArguments(
            string gameObjectGlobalObjectId,
            int maxComponents,
            int maxPropertiesPerComponent,
            int maxDepth)
        {
            ObjectResolverCommand.ValidateArguments(gameObjectGlobalObjectId);
            if (maxComponents < 1 || maxComponents > MaximumMaxComponents)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxComponents),
                    $"maxComponents must be between 1 and {MaximumMaxComponents}.");
            }
            if (maxPropertiesPerComponent < 1 ||
                maxPropertiesPerComponent > MaximumMaxPropertiesPerComponent)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxPropertiesPerComponent),
                    $"maxPropertiesPerComponent must be between 1 and {MaximumMaxPropertiesPerComponent}.");
            }
            if (maxDepth < 0 || maxDepth > MaximumMaxDepth)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(maxDepth),
                    $"maxDepth must be between 0 and {MaximumMaxDepth}.");
            }
        }

        public static ComponentInspectPayload Execute(
            string gameObjectGlobalObjectId,
            int maxComponents,
            int maxPropertiesPerComponent,
            int maxDepth)
        {
            ValidateArguments(
                gameObjectGlobalObjectId,
                maxComponents,
                maxPropertiesPerComponent,
                maxDepth);

            var gameObject = GameObjectSnapshotCommand.ResolveGameObject(
                gameObjectGlobalObjectId,
                out var canonicalGlobalObjectId);
            var gameObjectSnapshot = GameObjectSnapshotCommand.Capture(
                gameObject,
                canonicalGlobalObjectId);

            var nativeComponents = gameObject.GetComponents<Component>();
            var returnedCount = Math.Min(nativeComponents.Length, maxComponents);
            var entries = new ComponentInspectEntryPayload[returnedCount];
            var missingScriptCount = 0;
            for (var index = 0; index < nativeComponents.Length; index++)
            {
                if (nativeComponents[index] == null)
                {
                    missingScriptCount++;
                }
            }

            for (var index = 0; index < returnedCount; index++)
            {
                var component = nativeComponents[index];
                if (component == null)
                {
                    entries[index] = new ComponentInspectEntryPayload
                    {
                        index = index,
                        missingScript = true,
                        globalObjectId = string.Empty,
                        instanceId = 0,
                        typeName = "Missing Script",
                        assemblyQualifiedName = string.Empty,
                        scriptAssetPath = string.Empty,
                        returnedPropertyCount = 0,
                        truncatedByPropertyLimit = false,
                        truncatedByDepth = false,
                        properties = Array.Empty<ComponentPropertyPayload>(),
                    };
                    continue;
                }

                entries[index] = CaptureComponent(
                    component,
                    index,
                    maxPropertiesPerComponent,
                    maxDepth);
            }

            var state = EditorStateRevision.Capture();
            gameObjectSnapshot.stateEpoch = state.epoch;
            gameObjectSnapshot.stateRevision = state.revision;

            return new ComponentInspectPayload
            {
                gameObject = gameObjectSnapshot,
                componentCount = nativeComponents.Length,
                returnedComponentCount = returnedCount,
                missingScriptCount = missingScriptCount,
                truncatedByComponentLimit = nativeComponents.Length > returnedCount,
                maxComponents = maxComponents,
                maxPropertiesPerComponent = maxPropertiesPerComponent,
                maxDepth = maxDepth,
                components = entries,
                stateEpoch = state.epoch,
                stateRevision = state.revision,
            };
        }

        private static ComponentInspectEntryPayload CaptureComponent(
            Component component,
            int index,
            int maxPropertiesPerComponent,
            int maxDepth)
        {
            var type = component.GetType();
            var serializedObject = new SerializedObject(component);
            serializedObject.UpdateIfRequiredOrScript();

            var properties = new List<ComponentPropertyPayload>();
            var iterator = serializedObject.GetIterator();
            var enterChildren = true;
            var truncatedByDepth = false;
            var truncatedByPropertyLimit = false;

            while (iterator.NextVisible(enterChildren))
            {
                enterChildren = true;
                if (iterator.depth > maxDepth)
                {
                    truncatedByDepth = true;
                    enterChildren = false;
                    continue;
                }

                if (properties.Count >= maxPropertiesPerComponent)
                {
                    truncatedByPropertyLimit = true;
                    break;
                }

                properties.Add(CaptureProperty(iterator));
            }

            var globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(component).ToString();
            var scriptAssetPath = string.Empty;
            if (component is MonoBehaviour monoBehaviour)
            {
                var monoScript = MonoScript.FromMonoBehaviour(monoBehaviour);
                if (monoScript != null)
                {
                    scriptAssetPath = AssetDatabase.GetAssetPath(monoScript) ?? string.Empty;
                }
            }

            return new ComponentInspectEntryPayload
            {
                index = index,
                missingScript = false,
                globalObjectId = globalObjectId,
                instanceId = component.GetInstanceID(),
                typeName = type.FullName ?? type.Name,
                assemblyQualifiedName = type.AssemblyQualifiedName ?? string.Empty,
                scriptAssetPath = scriptAssetPath,
                returnedPropertyCount = properties.Count,
                truncatedByPropertyLimit = truncatedByPropertyLimit,
                truncatedByDepth = truncatedByDepth,
                properties = properties.ToArray(),
            };
        }

        internal static ComponentPropertyPayload CaptureProperty(SerializedProperty property)
        {
            if (property == null)
            {
                throw new ArgumentNullException(nameof(property));
            }

            var payload = new ComponentPropertyPayload
            {
                path = property.propertyPath ?? string.Empty,
                displayName = property.displayName ?? string.Empty,
                depth = property.depth,
                propertyType = property.propertyType.ToString(),
                isArray = property.isArray,
                arraySize = property.isArray ? property.arraySize : -1,
                hasVisibleChildren = property.hasVisibleChildren,
                valueKind = "none",
                stringValue = string.Empty,
                longValue = 0,
                doubleValue = 0d,
                boolValue = false,
                objectReferenceGlobalObjectId = string.Empty,
                objectReferenceInstanceId = 0,
                objectReferenceName = string.Empty,
                objectReferenceType = string.Empty,
            };

            switch (property.propertyType)
            {
                case SerializedPropertyType.Integer:
                case SerializedPropertyType.ArraySize:
                case SerializedPropertyType.Character:
                case SerializedPropertyType.LayerMask:
                    payload.valueKind = "integer";
                    payload.longValue = property.longValue;
                    break;

                case SerializedPropertyType.Boolean:
                    payload.valueKind = "boolean";
                    payload.boolValue = property.boolValue;
                    break;

                case SerializedPropertyType.Float:
                    payload.valueKind = "number";
                    payload.doubleValue = property.doubleValue;
                    break;

                case SerializedPropertyType.String:
                    payload.valueKind = "string";
                    payload.stringValue = property.stringValue ?? string.Empty;
                    break;

                case SerializedPropertyType.Enum:
                    payload.valueKind = "enum";
                    payload.longValue = property.enumValueIndex;
                    var names = property.enumDisplayNames;
                    if (names != null && property.enumValueIndex >= 0 && property.enumValueIndex < names.Length)
                    {
                        payload.stringValue = names[property.enumValueIndex] ?? string.Empty;
                    }
                    break;

                case SerializedPropertyType.ObjectReference:
                    CaptureObjectReference(property.objectReferenceValue, payload);
                    break;

                case SerializedPropertyType.ExposedReference:
                    CaptureObjectReference(property.exposedReferenceValue, payload);
                    break;

                case SerializedPropertyType.Vector2:
                    payload.valueKind = "vector2";
                    payload.stringValue = FormatVector2(property.vector2Value);
                    break;

                case SerializedPropertyType.Vector3:
                    payload.valueKind = "vector3";
                    payload.stringValue = FormatVector3(property.vector3Value);
                    break;

                case SerializedPropertyType.Vector4:
                    payload.valueKind = "vector4";
                    payload.stringValue = FormatVector4(property.vector4Value);
                    break;

                case SerializedPropertyType.Quaternion:
                    payload.valueKind = "quaternion";
                    payload.stringValue = FormatQuaternion(property.quaternionValue);
                    break;

                case SerializedPropertyType.Color:
                    payload.valueKind = "color";
                    payload.stringValue = FormatColor(property.colorValue);
                    break;

                case SerializedPropertyType.Vector2Int:
                    payload.valueKind = "vector2int";
                    payload.stringValue = property.vector2IntValue.ToString();
                    break;

                case SerializedPropertyType.Vector3Int:
                    payload.valueKind = "vector3int";
                    payload.stringValue = property.vector3IntValue.ToString();
                    break;

                case SerializedPropertyType.ManagedReference:
                    payload.valueKind = "managedReference";
                    payload.stringValue = property.managedReferenceFullTypename ?? string.Empty;
                    break;

                default:
                    payload.valueKind = property.hasVisibleChildren ? "container" : "unsupported";
                    break;
            }

            return payload;
        }

        private static void CaptureObjectReference(
            UnityEngine.Object value,
            ComponentPropertyPayload payload)
        {
            payload.valueKind = "objectReference";
            if (value == null)
            {
                return;
            }

            payload.objectReferenceInstanceId = value.GetInstanceID();
            payload.objectReferenceName = value.name ?? string.Empty;
            payload.objectReferenceType = value.GetType().FullName ?? value.GetType().Name;
            try
            {
                payload.objectReferenceGlobalObjectId =
                    GlobalObjectId.GetGlobalObjectIdSlow(value).ToString();
            }
            catch
            {
                payload.objectReferenceGlobalObjectId = string.Empty;
            }
        }

        private static string FormatVector2(Vector2 value)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "({0:R},{1:R})",
                value.x,
                value.y);
        }

        private static string FormatVector3(Vector3 value)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "({0:R},{1:R},{2:R})",
                value.x,
                value.y,
                value.z);
        }

        private static string FormatVector4(Vector4 value)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "({0:R},{1:R},{2:R},{3:R})",
                value.x,
                value.y,
                value.z,
                value.w);
        }

        private static string FormatQuaternion(Quaternion value)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "({0:R},{1:R},{2:R},{3:R})",
                value.x,
                value.y,
                value.z,
                value.w);
        }

        private static string FormatColor(Color value)
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "({0:R},{1:R},{2:R},{3:R})",
                value.r,
                value.g,
                value.b,
                value.a);
        }
    }
}
