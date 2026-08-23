import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 120_000;
const pollIntervalMs = 300;
const boxColliderType = "UnityEngine.BoxCollider";

const client = new Client({
  name: "unity-ai-bridge-component-property-verifier",
  version: "0.0.1",
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/src/index.js"],
});

try {
  console.log("[Unity AI Bridge] Starting MCP server over stdio...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  for (const required of [
    "unity_get_status",
    "unity_create_game_object",
    "unity_resolve_object",
    "unity_get_components",
    "unity_add_component",
    "unity_set_component_property",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; waiting for Unity Component property capability...");
  await waitForUnityReady();

  const suffix = Date.now();
  const objectName = `MCP_Component_Property_Verify_${suffix}`;
  const createMutationId = `verify-component-property-create-${randomUUID()}`;
  const addMutationId = `verify-component-property-add-${randomUUID()}`;
  const boolMutationId = `verify-component-property-bool-${randomUUID()}`;
  const centerMutationId = `verify-component-property-center-${randomUUID()}`;
  const sizeMutationId = `verify-component-property-size-${randomUUID()}`;

  const create = await client.callTool({
    name: "unity_create_game_object",
    arguments: { name: objectName, mutationId: createMutationId },
  });
  requireToolSuccess(create, "temporary GameObject create");
  const gameObjectGlobalObjectId = requireStringField(create.structuredContent, "globalObjectId");

  const beforeAdd = await resolve(gameObjectGlobalObjectId);
  requireFound(beforeAdd, "pre-add GameObject");

  const add = await client.callTool({
    name: "unity_add_component",
    arguments: {
      gameObjectGlobalObjectId,
      typeName: boxColliderType,
      mutationId: addMutationId,
      expectedStateEpoch: beforeAdd.stateEpoch,
      expectedStateRevision: beforeAdd.stateRevision,
    },
  });
  requireToolSuccess(add, "BoxCollider add");

  let inspect = await inspectComponents(gameObjectGlobalObjectId);
  const collider = requireComponent(inspect, boxColliderType);
  const componentGlobalObjectId = collider.globalObjectId;
  requireProperty(collider, "m_IsTrigger", "Boolean");
  requireProperty(collider, "m_Center", "Vector3");
  requireProperty(collider, "m_Size", "Vector3");

  const boolWrite = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_IsTrigger",
      valueKind: "boolean",
      boolValue: true,
      mutationId: boolMutationId,
      expectedStateEpoch: inspect.stateEpoch,
      expectedStateRevision: inspect.stateRevision,
    },
  });
  requireToolSuccess(boolWrite, "BoxCollider.m_IsTrigger write");
  const boolPayload = requirePropertySetResult(boolWrite.structuredContent, "m_IsTrigger");
  if (!boolPayload.changed || boolPayload.replayed || boolPayload.property.boolValue !== true) {
    throw new Error(`Boolean property write returned unexpected result: ${JSON.stringify(boolWrite.structuredContent)}`);
  }

  const boolReplay = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_IsTrigger",
      valueKind: "boolean",
      boolValue: true,
      mutationId: boolMutationId,
      expectedStateEpoch: inspect.stateEpoch,
      expectedStateRevision: inspect.stateRevision,
    },
  });
  requireToolSuccess(boolReplay, "BoxCollider.m_IsTrigger immediate replay");
  if (!requirePropertySetResult(boolReplay.structuredContent, "m_IsTrigger").replayed) {
    throw new Error("Boolean same-id replay did not return replayed=true.");
  }

  inspect = await inspectComponents(gameObjectGlobalObjectId);
  const boolReadback = requireProperty(requireComponent(inspect, boxColliderType), "m_IsTrigger", "Boolean");
  if (boolReadback.boolValue !== true) {
    throw new Error(`Boolean native inspect readback did not match: ${JSON.stringify(boolReadback)}`);
  }

  const requestedCenter = { x: 1.25, y: -2.5, z: 3.75 };
  const centerWrite = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_Center",
      valueKind: "vector3",
      vector3Value: requestedCenter,
      mutationId: centerMutationId,
      expectedStateEpoch: inspect.stateEpoch,
      expectedStateRevision: inspect.stateRevision,
    },
  });
  requireToolSuccess(centerWrite, "BoxCollider.m_Center write");
  const centerPayload = requirePropertySetResult(centerWrite.structuredContent, "m_Center");
  if (!centerPayload.changed || centerPayload.replayed || !vectorStringMatches(centerPayload.property.stringValue, requestedCenter)) {
    throw new Error(`Center property write returned unexpected readback: ${JSON.stringify(centerWrite.structuredContent)}`);
  }

  inspect = await inspectComponents(gameObjectGlobalObjectId);
  const centerReadback = requireProperty(requireComponent(inspect, boxColliderType), "m_Center", "Vector3");
  if (!vectorStringMatches(centerReadback.stringValue, requestedCenter)) {
    throw new Error(`Center native inspect readback did not match: ${JSON.stringify(centerReadback)}`);
  }

  const originalSize = parseVector3(requireProperty(requireComponent(inspect, boxColliderType), "m_Size", "Vector3").stringValue);
  const requestedSize = { x: 2, y: 3, z: 4 };
  const sizePrecondition = { stateEpoch: inspect.stateEpoch, stateRevision: inspect.stateRevision };
  const sizeWrite = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_Size",
      valueKind: "vector3",
      vector3Value: requestedSize,
      mutationId: sizeMutationId,
      expectedStateEpoch: sizePrecondition.stateEpoch,
      expectedStateRevision: sizePrecondition.stateRevision,
    },
  });
  requireToolSuccess(sizeWrite, "BoxCollider.m_Size write");
  const sizePayload = requirePropertySetResult(sizeWrite.structuredContent, "m_Size");
  if (!sizePayload.changed || sizePayload.replayed || !vectorStringMatches(sizePayload.property.stringValue, requestedSize)) {
    throw new Error(`Size property write returned unexpected readback: ${JSON.stringify(sizeWrite.structuredContent)}`);
  }

  const sizeReplay = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_Size",
      valueKind: "vector3",
      vector3Value: requestedSize,
      mutationId: sizeMutationId,
      expectedStateEpoch: sizePrecondition.stateEpoch,
      expectedStateRevision: sizePrecondition.stateRevision,
    },
  });
  requireToolSuccess(sizeReplay, "BoxCollider.m_Size immediate replay");
  if (!requirePropertySetResult(sizeReplay.structuredContent, "m_Size").replayed) {
    throw new Error("Size same-id replay did not return replayed=true.");
  }

  console.log("[Unity AI Bridge] Component property writes + native readback + immediate replay PASS.");
  console.log("[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo only the BoxCollider m_Size property change.");

  await waitForPropertyVector(gameObjectGlobalObjectId, boxColliderType, "m_Size", originalSize);

  const staleReplay = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_Size",
      valueKind: "vector3",
      vector3Value: requestedSize,
      mutationId: sizeMutationId,
      expectedStateEpoch: sizePrecondition.stateEpoch,
      expectedStateRevision: sizePrecondition.stateRevision,
    },
  });
  if (!staleReplay.isError) {
    throw new Error(`Stale size replay unexpectedly reapplied the Undone property value: ${JSON.stringify(staleReplay.structuredContent)}`);
  }
  const staleReplayError = readToolText(staleReplay);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`Size stale replay returned the wrong error: ${staleReplayError}`);
  }

  const cleanupState = await resolve(gameObjectGlobalObjectId);
  requireFound(cleanupState, "cleanup GameObject");
  const cleanup = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: gameObjectGlobalObjectId,
      mutationId: `verify-component-property-cleanup-${randomUUID()}`,
      expectedStateEpoch: cleanupState.stateEpoch,
      expectedStateRevision: cleanupState.stateRevision,
    },
  });
  requireToolSuccess(cleanup, "temporary GameObject cleanup");
  const afterCleanup = await resolve(gameObjectGlobalObjectId);
  if (afterCleanup.found) {
    throw new Error("Temporary Component property verifier GameObject still resolves after cleanup.");
  }

  console.log("[Unity AI Bridge] Component property edit reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: await readUnityVersion(),
    gameObjectGlobalObjectId,
    componentGlobalObjectId,
    componentType: boxColliderType,
    boolMutationId,
    centerMutationId,
    sizeMutationId,
    boolWriteVerified: true,
    boolReplay: true,
    centerWriteVerified: true,
    sizeWriteVerified: true,
    sizeReplay: true,
    undoRestoredSize: true,
    staleReplayError,
    cleanupDeleted: true,
    temporaryObjectRemoved: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Component property verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityReady(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No status result received.";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError) {
      const record = asRecord(result.structuredContent);
      const capabilities = Array.isArray(record?.capabilities) ? record.capabilities : [];
      if (capabilities.includes("component.property.set")) return;
      last = `Agent capabilities did not include component.property.set: ${JSON.stringify(capabilities)}`;
    } else {
      last = readToolText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for current Unity Component property capability. Last observation: ${last}`);
}

async function readUnityVersion(): Promise<string> {
  const result = await client.callTool({ name: "unity_get_status", arguments: {} });
  requireToolSuccess(result, "final status");
  return requireStringField(result.structuredContent, "unityVersion");
}

async function resolve(globalObjectId: string): Promise<ResolveResult> {
  const result = await client.callTool({
    name: "unity_resolve_object",
    arguments: { globalObjectId },
  });
  requireToolSuccess(result, "unity_resolve_object");
  const record = asRecord(result.structuredContent);
  if (
    record === null ||
    typeof record.found !== "boolean" ||
    typeof record.stateEpoch !== "string" ||
    typeof record.stateRevision !== "number" ||
    !Number.isSafeInteger(record.stateRevision)
  ) {
    throw new Error(`Resolver returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return {
    found: record.found,
    stateEpoch: record.stateEpoch,
    stateRevision: record.stateRevision,
  };
}

async function inspectComponents(gameObjectGlobalObjectId: string): Promise<InspectResult> {
  const result = await client.callTool({
    name: "unity_get_components",
    arguments: {
      gameObjectGlobalObjectId,
      maxComponents: 16,
      maxPropertiesPerComponent: 128,
      maxDepth: 3,
    },
  });
  requireToolSuccess(result, "unity_get_components");
  const record = asRecord(result.structuredContent);
  if (
    record === null ||
    typeof record.stateEpoch !== "string" ||
    typeof record.stateRevision !== "number" ||
    !Number.isSafeInteger(record.stateRevision) ||
    !Array.isArray(record.components)
  ) {
    throw new Error(`Component inspection returned invalid structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }

  const components: ComponentResult[] = record.components.map((value) => {
    const component = asRecord(value);
    if (
      component === null ||
      typeof component.globalObjectId !== "string" ||
      typeof component.typeName !== "string" ||
      !Array.isArray(component.properties)
    ) {
      throw new Error(`Invalid Component entry: ${JSON.stringify(value)}`);
    }
    const properties = component.properties.map((propertyValue) => {
      const property = asRecord(propertyValue);
      if (
        property === null ||
        typeof property.path !== "string" ||
        typeof property.propertyType !== "string" ||
        typeof property.stringValue !== "string" ||
        typeof property.boolValue !== "boolean"
      ) {
        throw new Error(`Invalid Component property entry: ${JSON.stringify(propertyValue)}`);
      }
      return {
        path: property.path,
        propertyType: property.propertyType,
        stringValue: property.stringValue,
        boolValue: property.boolValue,
      };
    });
    return {
      globalObjectId: component.globalObjectId,
      typeName: component.typeName,
      properties,
    };
  });

  return {
    stateEpoch: record.stateEpoch,
    stateRevision: record.stateRevision,
    components,
  };
}

async function waitForPropertyVector(
  gameObjectGlobalObjectId: string,
  componentType: string,
  propertyPath: string,
  expected: Vector3,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No property observation.";
  while (Date.now() < deadline) {
    const inspect = await inspectComponents(gameObjectGlobalObjectId);
    const component = requireComponent(inspect, componentType);
    const property = requireProperty(component, propertyPath, "Vector3");
    last = property.stringValue;
    if (vectorStringMatches(property.stringValue, expected)) return;
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for ${propertyPath}=${formatVector(expected)} after Undo. Last observation: ${last}`);
}

function requireComponent(inspect: InspectResult, typeName: string): ComponentResult {
  const component = inspect.components.find((entry) => entry.typeName === typeName);
  if (component === undefined || component.globalObjectId.length === 0) {
    throw new Error(`Component ${typeName} was not found: ${JSON.stringify(inspect)}`);
  }
  return component;
}

function requireProperty(component: ComponentResult, path: string, type: string): PropertyResult {
  const property = component.properties.find((entry) => entry.path === path);
  if (property === undefined) {
    throw new Error(`Property ${path} was not found on ${component.typeName}. Paths: ${component.properties.map((entry) => entry.path).join(", ")}`);
  }
  if (property.propertyType !== type) {
    throw new Error(`Property ${path} expected type ${type} but Unity reported ${property.propertyType}.`);
  }
  return property;
}

function requirePropertySetResult(value: unknown, path: string): PropertySetResult {
  const record = asRecord(value);
  const property = asRecord(record?.property);
  if (
    record === null ||
    property === null ||
    typeof record.replayed !== "boolean" ||
    typeof record.changed !== "boolean" ||
    typeof property.path !== "string" ||
    property.path !== path ||
    typeof property.stringValue !== "string" ||
    typeof property.boolValue !== "boolean"
  ) {
    throw new Error(`Invalid component property set structuredContent: ${JSON.stringify(value)}`);
  }
  return {
    replayed: record.replayed,
    changed: record.changed,
    property: {
      path: property.path,
      stringValue: property.stringValue,
      boolValue: property.boolValue,
    },
  };
}

function requireFound(result: ResolveResult, label: string): void {
  if (!result.found || result.stateEpoch.length === 0 || result.stateRevision <= 0) {
    throw new Error(`${label} did not resolve to a live state: ${JSON.stringify(result)}`);
  }
}

function requireToolSuccess(result: { isError?: boolean; content: Array<{ type: string; text?: string }> }, label: string): void {
  if (result.isError) {
    throw new Error(`${label} failed: ${readToolText(result)}`);
  }
}

function requireStringField(value: unknown, field: string): string {
  const record = asRecord(value);
  const result = record?.[field];
  if (typeof result !== "string" || result.length === 0) {
    throw new Error(`Expected non-empty ${field}: ${JSON.stringify(value)}`);
  }
  return result;
}

function parseVector3(value: string): Vector3 {
  const match = /^\(\s*([^,]+),\s*([^,]+),\s*([^\)]+)\s*\)$/.exec(value);
  if (match === null) {
    throw new Error(`Could not parse Unity Vector3 property string '${value}'.`);
  }
  const vector = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
    throw new Error(`Unity Vector3 property string was non-finite: '${value}'.`);
  }
  return vector;
}

function vectorStringMatches(value: string, expected: Vector3): boolean {
  const actual = parseVector3(value);
  return Math.abs(actual.x - expected.x) <= 0.0001 &&
    Math.abs(actual.y - expected.y) <= 0.0001 &&
    Math.abs(actual.z - expected.z) <= 0.0001;
}

function formatVector(value: Vector3): string {
  return `(${value.x},${value.y},${value.z})`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

type ResolveResult = {
  found: boolean;
  stateEpoch: string;
  stateRevision: number;
};

type Vector3 = { x: number; y: number; z: number };

type PropertyResult = {
  path: string;
  propertyType: string;
  stringValue: string;
  boolValue: boolean;
};

type ComponentResult = {
  globalObjectId: string;
  typeName: string;
  properties: PropertyResult[];
};

type InspectResult = {
  stateEpoch: string;
  stateRevision: number;
  components: ComponentResult[];
};

type PropertySetResult = {
  replayed: boolean;
  changed: boolean;
  property: {
    path: string;
    stringValue: string;
    boolValue: boolean;
  };
};
