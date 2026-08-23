import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  ComponentPropertyBridgeServer,
  type ComponentPropertySetOptions,
  type ComponentPropertyValue,
} from "./bridge/component-property-bridge-server.js";
import {
  type ComponentAddOptions,
  type ComponentInspectOptions,
  type ComponentRemoveOptions,
} from "./bridge/editing-bridge-server.js";

const inspectInputSchema = fromJsonSchema({
  type: "object",
  required: ["gameObjectGlobalObjectId"],
  properties: {
    gameObjectGlobalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "GlobalObjectId of the GameObject whose attached Components and visible serialized properties should be inspected.",
    },
    maxComponents: {
      type: "integer",
      minimum: 1,
      maximum: 64,
      default: 32,
      description: "Maximum attached Component entries to return. Missing Script slots count toward this limit.",
    },
    maxPropertiesPerComponent: {
      type: "integer",
      minimum: 1,
      maximum: 256,
      default: 128,
      description:
        "Maximum visible SerializedProperty entries to return per non-missing Component.",
    },
    maxDepth: {
      type: "integer",
      minimum: 0,
      maximum: 8,
      default: 4,
      description:
        "Maximum SerializedProperty depth to include. Deeper visible property subtrees are skipped and reported as truncated.",
    },
  },
  additionalProperties: false,
});

const mutationIdentitySchema = {
  mutationId: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9._:-]+$",
    description:
      "Optional idempotency key. Reuse only for an ambiguous retry of this exact mutation intent. If omitted, the bridge generates one.",
  },
  expectedStateEpoch: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    description: "Required optimistic-concurrency epoch from a recent Unity observation.",
  },
  expectedStateRevision: {
    type: "integer",
    minimum: 1,
    description:
      "Required optimistic-concurrency revision from the same observation. Stale state is rejected before mutation.",
  },
} as const;

const addInputSchema = fromJsonSchema({
  type: "object",
  required: [
    "gameObjectGlobalObjectId",
    "typeName",
    "expectedStateEpoch",
    "expectedStateRevision",
  ],
  properties: {
    gameObjectGlobalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "GlobalObjectId of the active-scene GameObject that should receive the Component.",
    },
    typeName: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact loaded Unity Component full type name or assembly-qualified name, for example UnityEngine.BoxCollider. The first add slice rejects Transform/RectTransform types rather than replacing the object's mandatory Transform.",
    },
    ...mutationIdentitySchema,
  },
  additionalProperties: false,
});

const removeInputSchema = fromJsonSchema({
  type: "object",
  required: ["componentGlobalObjectId", "expectedStateEpoch", "expectedStateRevision"],
  properties: {
    componentGlobalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "GlobalObjectId of the exact Component to remove. This must be a Component identity returned by component inspection/resolution; GameObject IDs are not silently reinterpreted. Transform/RectTransform removal is rejected.",
    },
    ...mutationIdentitySchema,
  },
  additionalProperties: false,
});

const vector3ValueSchema = {
  type: "object",
  required: ["x", "y", "z"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
  additionalProperties: false,
} as const;

const setPropertyInputSchema = fromJsonSchema({
  type: "object",
  required: [
    "componentGlobalObjectId",
    "propertyPath",
    "valueKind",
    "expectedStateEpoch",
    "expectedStateRevision",
  ],
  properties: {
    componentGlobalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "GlobalObjectId of the exact non-Transform Component returned by component inspection/resolution.",
    },
    propertyPath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact visible SerializedProperty path returned by unity_get_components, for example m_IsTrigger or m_Center. Hidden properties and m_Script are not editable through this tool.",
    },
    valueKind: {
      type: "string",
      enum: ["boolean", "integer", "number", "string", "vector3"],
      description:
        "Explicit value representation. It must match the native SerializedProperty type; the bridge does not perform ambiguous coercion.",
    },
    boolValue: {
      type: "boolean",
      description: "Required only when valueKind=boolean.",
    },
    longValue: {
      type: "integer",
      description: "Required only when valueKind=integer. Must fit JavaScript's safe-integer range.",
    },
    doubleValue: {
      type: "number",
      description: "Required only when valueKind=number and must be finite.",
    },
    stringValue: {
      type: "string",
      maxLength: 4096,
      description: "Required only when valueKind=string.",
    },
    vector3Value: {
      ...vector3ValueSchema,
      description: "Required only when valueKind=vector3.",
    },
    ...mutationIdentitySchema,
  },
  additionalProperties: false,
});

export function registerComponentTools(
  server: McpServer,
  bridge: ComponentPropertyBridgeServer,
): void {
  server.registerTool(
    "unity_get_components",
    {
      description:
        "Inspect the Components attached to one GameObject using Unity SerializedObject/SerializedProperty visibility rather than unrestricted reflection. Returns each Component's GlobalObjectId/type metadata, Missing Script slots, bounded visible serialized-property snapshots, object-reference identities when available, and a fresh stateEpoch/stateRevision for later safe edits.",
      inputSchema: inspectInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          gameObjectGlobalObjectId: string;
          maxComponents?: number;
          maxPropertiesPerComponent?: number;
          maxDepth?: number;
        };
        const options: ComponentInspectOptions = {
          gameObjectGlobalObjectId: input.gameObjectGlobalObjectId,
        };
        if (input.maxComponents !== undefined) {
          options.maxComponents = input.maxComponents;
        }
        if (input.maxPropertiesPerComponent !== undefined) {
          options.maxPropertiesPerComponent = input.maxPropertiesPerComponent;
        }
        if (input.maxDepth !== undefined) {
          options.maxDepth = input.maxDepth;
        }

        await preflight(bridge, "component.inspect", "state.revision.v1");
        const result = await bridge.requestInspectComponents(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_add_component",
    {
      description:
        "Add one concrete loaded Unity Component type to an active-scene GameObject. Requires a fresh state token. Unity records the add in Undo, verifies the new Component by GlobalObjectId/type/owner native readback, rolls back and verifies rollback on failed semantic verification, enforces the execution deadline, and protects ambiguous retries with mutationId replay rules. Transform/RectTransform are intentionally excluded from this first slice.",
      inputSchema: addInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          gameObjectGlobalObjectId: string;
          typeName: string;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: ComponentAddOptions = {
          gameObjectGlobalObjectId: input.gameObjectGlobalObjectId,
          typeName: input.typeName,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflight(bridge, "component.add", "state.revision.v1");
        const result = await bridge.requestAddComponent(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_remove_component",
    {
      description:
        "Remove one exact active-scene Component by Component GlobalObjectId with Unity Undo support. Requires a fresh state token. The mutation verifies native target absence, verifies restoration if rollback is required, enforces the execution deadline, and uses mutationId replay rules so an ambiguous retry does not remove a Component that was restored through Undo. Transform/RectTransform removal is rejected.",
      inputSchema: removeInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          componentGlobalObjectId: string;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: ComponentRemoveOptions = {
          componentGlobalObjectId: input.componentGlobalObjectId,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflight(bridge, "component.remove", "state.revision.v1");
        const result = await bridge.requestRemoveComponent(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_set_component_property",
    {
      description:
        "Set one exact visible SerializedProperty on one exact non-Transform Component. Requires the Component GlobalObjectId, a propertyPath returned by unity_get_components, an explicit matching valueKind, and a fresh state token. Supported first-slice types are Boolean, Integer, Float, String, and Vector3. Hidden fields, m_Script, Transform/RectTransform, unsupported property types, and ambiguous type coercions are rejected. Unity uses SerializedObject/SerializedProperty with Undo, native readback, rollback verification, execution-boundary deadlines, and same-mutation replay protection.",
      inputSchema: setPropertyInputSchema,
    },
    async (args) => {
      try {
        const input = args as ComponentPropertyToolInput;
        const value = buildPropertyValue(input);
        const options: ComponentPropertySetOptions = {
          componentGlobalObjectId: input.componentGlobalObjectId,
          propertyPath: input.propertyPath,
          value,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflight(bridge, "component.property.set", "state.revision.v1");
        const result = await bridge.requestSetComponentProperty(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

type ComponentPropertyToolInput = {
  componentGlobalObjectId: string;
  propertyPath: string;
  valueKind: "boolean" | "integer" | "number" | "string" | "vector3";
  boolValue?: boolean;
  longValue?: number;
  doubleValue?: number;
  stringValue?: string;
  vector3Value?: { x: number; y: number; z: number };
  mutationId?: string;
  expectedStateEpoch: string;
  expectedStateRevision: number;
};

function buildPropertyValue(input: ComponentPropertyToolInput): ComponentPropertyValue {
  const extras = {
    bool: input.boolValue !== undefined,
    integer: input.longValue !== undefined,
    number: input.doubleValue !== undefined,
    string: input.stringValue !== undefined,
    vector3: input.vector3Value !== undefined,
  };

  switch (input.valueKind) {
    case "boolean":
      requireOnlyValueField(extras, "bool");
      if (typeof input.boolValue !== "boolean") {
        throw new Error("valueKind=boolean requires boolValue.");
      }
      return { kind: "boolean", boolValue: input.boolValue };
    case "integer":
      requireOnlyValueField(extras, "integer");
      if (!Number.isSafeInteger(input.longValue)) {
        throw new Error("valueKind=integer requires a safe-integer longValue.");
      }
      return { kind: "integer", longValue: input.longValue as number };
    case "number":
      requireOnlyValueField(extras, "number");
      if (typeof input.doubleValue !== "number" || !Number.isFinite(input.doubleValue)) {
        throw new Error("valueKind=number requires a finite doubleValue.");
      }
      return { kind: "number", doubleValue: input.doubleValue };
    case "string":
      requireOnlyValueField(extras, "string");
      if (typeof input.stringValue !== "string") {
        throw new Error("valueKind=string requires stringValue.");
      }
      if (input.stringValue.length > 4096) {
        throw new Error("stringValue must be at most 4096 characters.");
      }
      return { kind: "string", stringValue: input.stringValue };
    case "vector3":
      requireOnlyValueField(extras, "vector3");
      if (
        typeof input.vector3Value !== "object" ||
        input.vector3Value === null ||
        !Number.isFinite(input.vector3Value.x) ||
        !Number.isFinite(input.vector3Value.y) ||
        !Number.isFinite(input.vector3Value.z)
      ) {
        throw new Error("valueKind=vector3 requires vector3Value with finite x/y/z numbers.");
      }
      return { kind: "vector3", vector3Value: input.vector3Value };
  }
}

function requireOnlyValueField(
  supplied: Record<"bool" | "integer" | "number" | "string" | "vector3", boolean>,
  expected: "bool" | "integer" | "number" | "string" | "vector3",
): void {
  const names = Object.entries(supplied)
    .filter(([, present]) => present)
    .map(([name]) => name);
  if (names.length !== 1 || names[0] !== expected) {
    throw new Error(
      `Exactly the value field matching valueKind must be supplied; received: ${names.join(", ") || "none"}.`,
    );
  }
}

async function preflight(
  bridge: ComponentPropertyBridgeServer,
  ...capabilities: string[]
): Promise<void> {
  const status = await bridge.requestEditorStatus();
  for (const capability of capabilities) {
    requireAgentCapability(status, capability);
  }
}

function toolError(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
