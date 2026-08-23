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

  await waitForCapability();

  const objectName = `MCP_Component_Property_Verify_${Date.now()}`;
  const create = await client.callTool({
    name: "unity_create_game_object",
    arguments: {
      name: objectName,
      mutationId: `verify-component-property-create-${randomUUID()}`,
    },
  });
  requireSuccess(create, "temporary GameObject create");
  const gameObjectGlobalObjectId = requireString(create.structuredContent, "globalObjectId");

  const beforeAdd = await resolve(gameObjectGlobalObjectId);
  requireLive(beforeAdd, "pre-add GameObject");
  const add = await client.callTool({
    name: "unity_add_component",
    arguments: {
      gameObjectGlobalObjectId,
      typeName: boxColliderType,
      mutationId: `verify-component-property-add-${randomUUID()}`,
      expectedStateEpoch: beforeAdd.stateEpoch,
      expectedStateRevision: beforeAdd.stateRevision,
    },
  });
  requireSuccess(add, "BoxCollider add");

  let inspection = await inspect(gameObjectGlobalObjectId);
  const collider = requireComponent(inspection, boxColliderType);
  const componentGlobalObjectId = collider.globalObjectId;
  requireProperty(collider, "m_IsTrigger", "Boolean");
  requireProperty(collider, "m_Center", "Vector3");
  requireProperty(collider, "m_Size", "Vector3");

  const boolMutationId = `verify-component-property-bool-${randomUUID()}`;
  const boolWrite = await setProperty({
    componentGlobalObjectId,
    propertyPath: "m_IsTrigger",
    valueKind: "boolean",
    boolValue: true,
    mutationId: boolMutationId,
    state: inspection,
  });
  const boolPayload = requireSetPayload(boolWrite, "m_IsTrigger");
  if (!boolPayload.changed || boolPayload.replayed || boolPayload.boolValue !== true) {
    throw new Error(`Unexpected m_IsTrigger write result: ${JSON.stringify(boolWrite.structuredContent)}`);
  }
  const boolReplay = await setProperty({
    componentGlobalObjectId,
    propertyPath: "m_IsTrigger",
    valueKind: "boolean",
    boolValue: true,
    mutationId: boolMutationId,
    state: inspection,
  });
  if (!requireSetPayload(boolReplay, "m_IsTrigger").replayed) {
    throw new Error("m_IsTrigger immediate same-id replay did not return replayed=true.");
  }

  inspection = await inspect(gameObjectGlobalObjectId);
  if (requireProperty(requireComponent(inspection, boxColliderType), "m_IsTrigger", "Boolean").boolValue !== true) {
    throw new Error("m_IsTrigger native inspection readback did not match true.");
  }

  const center = { x: 1.25, y: -2.5, z: 3.75 };
  const centerMutationId = `verify-component-property-center-${randomUUID()}`;
  const centerWrite = await setProperty({
    componentGlobalObjectId,
    propertyPath: "m_Center",
    valueKind: "vector3",
    vector3Value: center,
    mutationId: centerMutationId,
    state: inspection,
  });
  const centerPayload = requireSetPayload(centerWrite, "m_Center");
  if (!centerPayload.changed || centerPayload.replayed || !matchesVector(centerPayload.stringValue, center)) {
    throw new Error(`Unexpected m_Center write result: ${JSON.stringify(centerWrite.structuredContent)}`);
  }

  inspection = await inspect(gameObjectGlobalObjectId);
  const currentCollider = requireComponent(inspection, boxColliderType);
  if (!matchesVector(requireProperty(currentCollider, "m_Center", "Vector3").stringValue, center)) {
    throw new Error("m_Center native inspection readback did not match requested value.");
  }

  const originalSize = parseVector(requireProperty(currentCollider, "m_Size", "Vector3").stringValue);
  const size = { x: 2, y: 3, z: 4 };
  const sizeMutationId = `verify-component-property-size-${randomUUID()}`;
  const sizeState = { stateEpoch: inspection.stateEpoch, stateRevision: inspection.stateRevision };
  const sizeWrite = await setProperty({
    componentGlobalObjectId,
    propertyPath: "m_Size",
    valueKind: "vector3",
    vector3Value: size,
    mutationId: sizeMutationId,
    state: sizeState,
  });
  const sizePayload = requireSetPayload(sizeWrite, "m_Size");
  if (!sizePayload.changed || sizePayload.replayed || !matchesVector(sizePayload.stringValue, size)) {
    throw new Error(`Unexpected m_Size write result: ${JSON.stringify(sizeWrite.structuredContent)}`);
  }

  const sizeReplay = await setProperty({
    componentGlobalObjectId,
    propertyPath: "m_Size",
    valueKind: "vector3",
    vector3Value: size,
    mutationId: sizeMutationId,
    state: sizeState,
  });
  if (!requireSetPayload(sizeReplay, "m_Size").replayed) {
    throw new Error("m_Size immediate same-id replay did not return replayed=true.");
  }

  console.log("[Unity AI Bridge] Component property writes + native readback + immediate replay PASS.");
  console.log("[Unity AI Bridge] NOW press Ctrl+Z ONCE in Unity to undo only the BoxCollider m_Size property change.");
  await waitForVector(gameObjectGlobalObjectId, "m_Size", originalSize);

  const staleReplay = await client.callTool({
    name: "unity_set_component_property",
    arguments: {
      componentGlobalObjectId,
      propertyPath: "m_Size",
      valueKind: "vector3",
      vector3Value: size,
      mutationId: sizeMutationId,
      expectedStateEpoch: sizeState.stateEpoch,
      expectedStateRevision: sizeState.stateRevision,
    },
  });
  if (!staleReplay.isError) {
    throw new Error("m_Size same-id replay unexpectedly reapplied the Undone value.");
  }
  const staleReplayError = readText(staleReplay);
  if (!staleReplayError.includes("stale_target/mutation_replay_stale")) {
    throw new Error(`m_Size stale replay returned the wrong error: ${staleReplayError}`);
  }

  const cleanupState = await resolve(gameObjectGlobalObjectId);
  requireLive(cleanupState, "cleanup GameObject");
  const cleanup = await client.callTool({
    name: "unity_delete_game_object",
    arguments: {
      globalObjectId: gameObjectGlobalObjectId,
      mutationId: `verify-component-property-cleanup-${randomUUID()}`,
      expectedStateEpoch: cleanupState.stateEpoch,
      expectedStateRevision: cleanupState.stateRevision,
    },
  });
  requireSuccess(cleanup, "temporary GameObject cleanup");
  if ((await resolve(gameObjectGlobalObjectId)).found) {
    throw new Error("Temporary Component property verifier GameObject still resolves after cleanup.");
  }

  const finalStatus = await client.callTool({ name: "unity_get_status", arguments: {} });
  requireSuccess(finalStatus, "final status");

  console.log("[Unity AI Bridge] Component property edit reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: requireString(finalStatus.structuredContent, "unityVersion"),
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

async function waitForCapability(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no status";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError) {
      const status = record(result.structuredContent);
      const capabilities = Array.isArray(status?.capabilities) ? status.capabilities : [];
      if (capabilities.includes("component.property.set")) return;
      last = JSON.stringify(capabilities);
    } else {
      last = readText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for component.property.set capability. Last observation: ${last}`);
}

async function resolve(globalObjectId: string): Promise<LiveState> {
  const result = await client.callTool({ name: "unity_resolve_object", arguments: { globalObjectId } });
  requireSuccess(result, "unity_resolve_object");
  const value = record(result.structuredContent);
  if (value === null || typeof value.found !== "boolean" || typeof value.stateEpoch !== "string" ||
      typeof value.stateRevision !== "number" || !Number.isSafeInteger(value.stateRevision)) {
    throw new Error(`Invalid resolver structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return { found: value.found, stateEpoch: value.stateEpoch, stateRevision: value.stateRevision };
}

async function inspect(gameObjectGlobalObjectId: string): Promise<Inspection> {
  const result = await client.callTool({
    name: "unity_get_components",
    arguments: { gameObjectGlobalObjectId, maxComponents: 16, maxPropertiesPerComponent: 128, maxDepth: 3 },
  });
  requireSuccess(result, "unity_get_components");
  const value = record(result.structuredContent);
  if (value === null || typeof value.stateEpoch !== "string" || typeof value.stateRevision !== "number" ||
      !Number.isSafeInteger(value.stateRevision) || !Array.isArray(value.components)) {
    throw new Error(`Invalid component inspection structuredContent: ${JSON.stringify(result.structuredContent)}`);
  }
  return {
    stateEpoch: value.stateEpoch,
    stateRevision: value.stateRevision,
    components: value.components.map(parseComponent),
  };
}

async function setProperty(input: {
  componentGlobalObjectId: string;
  propertyPath: string;
  valueKind: "boolean" | "vector3";
  boolValue?: boolean;
  vector3Value?: Vector3;
  mutationId: string;
  state: { stateEpoch: string; stateRevision: number };
}) {
  const args: Record<string, unknown> = {
    componentGlobalObjectId: input.componentGlobalObjectId,
    propertyPath: input.propertyPath,
    valueKind: input.valueKind,
    mutationId: input.mutationId,
    expectedStateEpoch: input.state.stateEpoch,
    expectedStateRevision: input.state.stateRevision,
  };
  if (input.valueKind === "boolean") args.boolValue = input.boolValue;
  if (input.valueKind === "vector3") args.vector3Value = input.vector3Value;
  const result = await client.callTool({ name: "unity_set_component_property", arguments: args });
  requireSuccess(result, input.propertyPath);
  return result;
}

async function waitForVector(gameObjectGlobalObjectId: string, path: string, expected: Vector3): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no value";
  while (Date.now() < deadline) {
    const current = await inspect(gameObjectGlobalObjectId);
    const property = requireProperty(requireComponent(current, boxColliderType), path, "Vector3");
    last = property.stringValue;
    if (matchesVector(last, expected)) return;
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for ${path} to restore to ${JSON.stringify(expected)}. Last=${last}`);
}

function parseComponent(value: unknown): ComponentView {
  const component = record(value);
  if (component === null || typeof component.globalObjectId !== "string" ||
      typeof component.typeName !== "string" || !Array.isArray(component.properties)) {
    throw new Error(`Invalid Component entry: ${JSON.stringify(value)}`);
  }
  return {
    globalObjectId: component.globalObjectId,
    typeName: component.typeName,
    properties: component.properties.map((propertyValue) => {
      const property = record(propertyValue);
      if (property === null || typeof property.path !== "string" || typeof property.propertyType !== "string" ||
          typeof property.stringValue !== "string" || typeof property.boolValue !== "boolean") {
        throw new Error(`Invalid property entry: ${JSON.stringify(propertyValue)}`);
      }
      return {
        path: property.path,
        propertyType: property.propertyType,
        stringValue: property.stringValue,
        boolValue: property.boolValue,
      };
    }),
  };
}

function requireComponent(inspection: Inspection, typeName: string): ComponentView {
  const component = inspection.components.find((entry) => entry.typeName === typeName);
  if (component === undefined || component.globalObjectId.length === 0) {
    throw new Error(`Component ${typeName} not found: ${JSON.stringify(inspection)}`);
  }
  return component;
}

function requireProperty(component: ComponentView, path: string, type: string): PropertyView {
  const property = component.properties.find((entry) => entry.path === path);
  if (property === undefined) {
    throw new Error(`Property ${path} not found. Paths=${component.properties.map((entry) => entry.path).join(",")}`);
  }
  if (property.propertyType !== type) {
    throw new Error(`Property ${path} expected ${type}, got ${property.propertyType}.`);
  }
  return property;
}

function requireSetPayload(result: { structuredContent?: unknown }, path: string) {
  const value = record(result.structuredContent);
  const property = record(value?.property);
  if (value === null || property === null || typeof value.changed !== "boolean" ||
      typeof value.replayed !== "boolean" || property.path !== path ||
      typeof property.stringValue !== "string" || typeof property.boolValue !== "boolean") {
    throw new Error(`Invalid component property result: ${JSON.stringify(result.structuredContent)}`);
  }
  return {
    changed: value.changed,
    replayed: value.replayed,
    stringValue: property.stringValue,
    boolValue: property.boolValue,
  };
}

function requireSuccess(result: unknown, label: string): void {
  const value = record(result);
  if (value?.isError === true) {
    throw new Error(`${label} failed: ${readText(result)}`);
  }
}

function requireString(value: unknown, field: string): string {
  const item = record(value)?.[field];
  if (typeof item !== "string" || item.length === 0) {
    throw new Error(`Expected non-empty ${field}: ${JSON.stringify(value)}`);
  }
  return item;
}

function requireLive(value: LiveState, label: string): void {
  if (!value.found || value.stateEpoch.length === 0 || value.stateRevision <= 0) {
    throw new Error(`${label} was not live: ${JSON.stringify(value)}`);
  }
}

function readText(value: unknown): string {
  const content = record(value)?.content;
  if (!Array.isArray(content)) return "tool returned no text";
  for (const block of content) {
    const item = record(block);
    if (item?.type === "text" && typeof item.text === "string") return item.text;
  }
  return "tool returned no text";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function parseVector(value: string): Vector3 {
  const match = /^\(\s*([^,]+),\s*([^,]+),\s*([^\)]+)\s*\)$/.exec(value);
  if (match === null) throw new Error(`Could not parse Unity Vector3 '${value}'.`);
  const result = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y) || !Number.isFinite(result.z)) {
    throw new Error(`Unity Vector3 was non-finite: '${value}'.`);
  }
  return result;
}

function matchesVector(value: string, expected: Vector3): boolean {
  const actual = parseVector(value);
  return Math.abs(actual.x - expected.x) <= 0.0001 &&
    Math.abs(actual.y - expected.y) <= 0.0001 &&
    Math.abs(actual.z - expected.z) <= 0.0001;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

type Vector3 = { x: number; y: number; z: number };
type LiveState = { found: boolean; stateEpoch: string; stateRevision: number };
type PropertyView = { path: string; propertyType: string; stringValue: string; boolValue: boolean };
type ComponentView = { globalObjectId: string; typeName: string; properties: PropertyView[] };
type Inspection = { stateEpoch: string; stateRevision: number; components: ComponentView[] };
