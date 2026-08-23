import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = 60_000;
const pollIntervalMs = 300;

const client = new Client({
  name: "unity-ai-bridge-asset-verifier",
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
  for (const required of ["unity_search_assets", "unity_inspect_asset", "unity_get_status"]) {
    if (!tools.some((tool) => tool.name === required)) {
      throw new Error(`MCP server did not advertise ${required}.`);
    }
  }

  await waitForCapabilities();

  const search = await client.callTool({
    name: "unity_search_assets",
    arguments: {
      filter: "t:Scene",
      searchInFolders: ["Assets"],
      maxResults: 20,
    },
  });
  requireSuccess(search, "scene asset search");
  const searchPayload = parseSearch(search.structuredContent);
  if (searchPayload.assets.length === 0) {
    throw new Error("asset.search did not return any Scene assets under Assets.");
  }
  if (!isSorted(searchPayload.assets.map((asset) => asset.path))) {
    throw new Error("asset.search results were not deterministically path-sorted.");
  }

  const scene = searchPayload.assets.find(
    (asset) => !asset.isFolder && asset.path.toLowerCase().endsWith(".unity"),
  );
  if (scene === undefined) {
    throw new Error(`asset.search returned no .unity Scene asset: ${JSON.stringify(searchPayload)}`);
  }

  const inspect = await client.callTool({
    name: "unity_inspect_asset",
    arguments: { path: scene.path, maxDependencies: 64 },
  });
  requireSuccess(inspect, "scene asset inspect");
  const inspected = parseInspect(inspect.structuredContent);
  if (inspected.guid !== scene.guid || inspected.path !== scene.path) {
    throw new Error(
      `asset.inspect identity did not match search result: ${JSON.stringify({ scene, inspected })}`,
    );
  }
  if (inspected.mainTypeName.length === 0 || inspected.dependencyHash.length === 0) {
    throw new Error(`asset.inspect omitted main type or dependency hash: ${JSON.stringify(inspected)}`);
  }
  if (inspected.returnedDependencyCount > inspected.directDependencyCount) {
    throw new Error("asset.inspect returned more dependencies than its reported total.");
  }

  const secondInspect = await client.callTool({
    name: "unity_inspect_asset",
    arguments: { path: scene.path, maxDependencies: 0 },
  });
  requireSuccess(secondInspect, "repeat scene asset inspect");
  const repeated = parseInspect(secondInspect.structuredContent);
  if (repeated.guid !== inspected.guid || repeated.dependencyHash !== inspected.dependencyHash) {
    throw new Error(
      `Repeated asset.inspect changed GUID/hash without an intervening asset mutation: ${JSON.stringify({ inspected, repeated })}`,
    );
  }
  if (repeated.returnedDependencyCount !== 0 || repeated.directDependencies.length !== 0) {
    throw new Error("maxDependencies=0 did not suppress dependency entries.");
  }

  const folderInspect = await client.callTool({
    name: "unity_inspect_asset",
    arguments: { path: "Assets", maxDependencies: 0 },
  });
  if (!folderInspect.isError) {
    throw new Error("asset.inspect unexpectedly accepted a folder path.");
  }
  const folderError = readText(folderInspect);
  if (!folderError.includes("stale_target/asset_unavailable")) {
    throw new Error(`Folder inspect returned the wrong error: ${folderError}`);
  }

  const status = await client.callTool({ name: "unity_get_status", arguments: {} });
  requireSuccess(status, "final Unity status");
  const statusRecord = asRecord(status.structuredContent);

  console.log("[Unity AI Bridge] Asset search + inspect reliability PASS:");
  console.log(JSON.stringify({
    unityVersion: readString(statusRecord, "unityVersion"),
    filter: searchPayload.filter,
    totalSceneMatches: searchPayload.totalMatches,
    returnedSceneMatches: searchPayload.returnedCount,
    selectedGuid: scene.guid,
    selectedPath: scene.path,
    selectedMainType: inspected.mainTypeName,
    importerType: inspected.importerTypeName,
    dependencyHash: inspected.dependencyHash,
    directDependencyCount: inspected.directDependencyCount,
    repeatedGuidStable: true,
    repeatedHashStable: true,
    zeroDependencyLimitHonored: true,
    folderInspectError: folderError,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Asset verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForCapabilities(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "No status result received.";
  while (Date.now() < deadline) {
    const result = await client.callTool({ name: "unity_get_status", arguments: {} });
    if (!result.isError) {
      const record = asRecord(result.structuredContent);
      const capabilities = Array.isArray(record?.capabilities) ? record.capabilities : [];
      if (capabilities.includes("asset.search") && capabilities.includes("asset.inspect")) {
        return;
      }
      last = JSON.stringify(capabilities);
    } else {
      last = readText(result);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for asset.search/asset.inspect Agent capabilities. Last observation: ${last}`,
  );
}

function parseSearch(value: unknown): SearchPayload {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.filter !== "string" ||
    !Number.isSafeInteger(record.totalMatches) ||
    !Number.isSafeInteger(record.returnedCount) ||
    !Array.isArray(record.assets)
  ) {
    throw new Error(`Invalid asset.search structuredContent: ${JSON.stringify(value)}`);
  }

  const assets = record.assets.map((value) => {
    const asset = asRecord(value);
    if (
      asset === null ||
      typeof asset.guid !== "string" ||
      asset.guid.length === 0 ||
      typeof asset.path !== "string" ||
      asset.path.length === 0 ||
      typeof asset.mainTypeName !== "string" ||
      typeof asset.isFolder !== "boolean"
    ) {
      throw new Error(`Invalid asset.search entry: ${JSON.stringify(value)}`);
    }
    return {
      guid: asset.guid,
      path: asset.path,
      mainTypeName: asset.mainTypeName,
      isFolder: asset.isFolder,
    };
  });

  return {
    filter: record.filter,
    totalMatches: record.totalMatches as number,
    returnedCount: record.returnedCount as number,
    assets,
  };
}

function parseInspect(value: unknown): InspectPayload {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.guid !== "string" ||
    record.guid.length === 0 ||
    typeof record.path !== "string" ||
    typeof record.mainTypeName !== "string" ||
    typeof record.importerTypeName !== "string" ||
    typeof record.dependencyHash !== "string" ||
    record.dependencyHash.length === 0 ||
    !Number.isSafeInteger(record.directDependencyCount) ||
    !Number.isSafeInteger(record.returnedDependencyCount) ||
    !Array.isArray(record.directDependencies)
  ) {
    throw new Error(`Invalid asset.inspect structuredContent: ${JSON.stringify(value)}`);
  }

  return {
    guid: record.guid,
    path: record.path,
    mainTypeName: record.mainTypeName,
    importerTypeName: record.importerTypeName,
    dependencyHash: record.dependencyHash,
    directDependencyCount: record.directDependencyCount as number,
    returnedDependencyCount: record.returnedDependencyCount as number,
    directDependencies: record.directDependencies,
  };
}

function requireSuccess(result: unknown, label: string): void {
  const record = asRecord(result);
  if (record?.isError === true) {
    throw new Error(`${label} failed: ${readText(result)}`);
  }
}

function readText(result: unknown): string {
  const record = asRecord(result);
  const content = record?.content;
  if (!Array.isArray(content)) return "tool returned no text";
  for (const block of content) {
    const blockRecord = asRecord(block);
    if (blockRecord?.type === "text" && typeof blockRecord.text === "string") {
      return blockRecord.text;
    }
  }
  return "tool returned no text";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown> | null, field: string): string {
  const value = record?.[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty ${field}.`);
  }
  return value;
}

function isSorted(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] ?? "").localeCompare(values[index] ?? "") > 0) return false;
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SearchPayload = {
  filter: string;
  totalMatches: number;
  returnedCount: number;
  assets: Array<{
    guid: string;
    path: string;
    mainTypeName: string;
    isFolder: boolean;
  }>;
};

type InspectPayload = {
  guid: string;
  path: string;
  mainTypeName: string;
  importerTypeName: string;
  dependencyHash: string;
  directDependencyCount: number;
  returnedDependencyCount: number;
  directDependencies: unknown[];
};
