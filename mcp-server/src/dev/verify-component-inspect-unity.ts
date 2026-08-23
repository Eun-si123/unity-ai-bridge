import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({
  name: "unity-ai-bridge-component-inspect-verifier",
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
    "unity_get_components",
    "unity_resolve_object",
    "unity_delete_game_object",
  ]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  const status = await waitForComponentInspectCapability();
  const name = `MCP_Component_Inspect_Verify_${Date.now()}`;
  const create = await callStructured("unity_create_game_object", {
    name,
    mutationId: `verify-component-create-${randomUUID()}`,
  });
  const gameObjectGlobalObjectId = readString(create, "globalObjectId");

  const inspect = await callStructured("unity_get_components", {
    gameObjectGlobalObjectId,
    maxComponents: 8,
    maxPropertiesPerComponent: 64,
    maxDepth: 4,
  });

  assertEqual(readNestedString(inspect, ["gameObject", "globalObjectId"]), gameObjectGlobalObjectId,
    "component inspection returned a different GameObject identity");
  const components = readArray(inspect, "components");
  const transform = components.find((entry) =>
    isRecord(entry) && entry.typeName === "UnityEngine.Transform" && entry.missingScript === false,
  );
  if (!isRecord(transform)) {
    throw new Error("component.inspect did not return the native UnityEngine.Transform component.");
  }

  const componentGlobalObjectId = readString(transform, "globalObjectId");
  const properties = readArray(transform, "properties");
  const propertyPaths = properties
    .filter(isRecord)
    .map((property) => String(property.path));
  for (const requiredProperty of ["m_LocalPosition", "m_LocalRotation", "m_LocalScale"]) {
    if (!propertyPaths.includes(requiredProperty)) {
      throw new Error(
        `Transform serialized snapshot did not include ${requiredProperty}. Returned: ${propertyPaths.join(", ")}`,
      );
    }
  }

  const resolvedComponent = await callStructured("unity_resolve_object", {
    globalObjectId: componentGlobalObjectId,
  });
  if (resolvedComponent.found !== true || resolvedComponent.isComponent !== true) {
    throw new Error("Resolver did not re-resolve the inspected Transform as a Component.");
  }
  assertEqual(
    readString(resolvedComponent, "owningGameObjectGlobalObjectId"),
    gameObjectGlobalObjectId,
    "resolved Component owner did not match the inspected GameObject",
  );

  const deleteResult = await callStructured("unity_delete_game_object", {
    globalObjectId: gameObjectGlobalObjectId,
    mutationId: `verify-component-cleanup-${randomUUID()}`,
    expectedStateEpoch: readString(inspect, "stateEpoch"),
    expectedStateRevision: readPositiveInteger(inspect, "stateRevision"),
  });
  if (deleteResult.deleted !== true) {
    throw new Error("Component verifier cleanup did not delete the temporary GameObject.");
  }

  const afterDelete = await callStructured("unity_resolve_object", {
    globalObjectId: gameObjectGlobalObjectId,
  });
  if (afterDelete.found !== false) {
    throw new Error("Temporary component verifier GameObject still resolves after cleanup.");
  }

  console.log("[Unity AI Bridge] Component inspection reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: status.unityVersion,
    gameObjectGlobalObjectId,
    componentGlobalObjectId,
    componentCount: inspect.componentCount,
    transformPropertyPaths: propertyPaths,
    componentResolved: true,
    ownerMatches: true,
    cleanupDeleted: true,
    temporaryObjectRemoved: true,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Component inspection verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForComponentInspectCapability(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  let last = "No status returned.";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError && isRecord(result.structuredContent)) {
      const capabilities = result.structuredContent.capabilities;
      if (Array.isArray(capabilities) && capabilities.includes("component.inspect")) {
        return result.structuredContent;
      }
      last = JSON.stringify(result.structuredContent);
    } else {
      last = readToolText(result);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for component.inspect capability. Last observation: ${last}`);
}

async function callStructured(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError || !isRecord(result.structuredContent)) {
    throw new Error(`${name} failed: ${readToolText(result)}`);
  }
  return result.structuredContent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} was not a non-empty string.`);
  }
  return value;
}

function readNestedString(record: Record<string, unknown>, path: string[]): string {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) {
      throw new Error(`${path.join(".")} was missing.`);
    }
    current = current[segment];
  }
  if (typeof current !== "string" || current.length === 0) {
    throw new Error(`${path.join(".")} was not a non-empty string.`);
  }
  return current;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} was not a positive safe integer.`);
  }
  return value;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} was not an array.`);
  }
  return value;
}

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${expected}, actual=${actual}`);
  }
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((block) => block.type === "text")?.text ?? "tool returned no text";
}
