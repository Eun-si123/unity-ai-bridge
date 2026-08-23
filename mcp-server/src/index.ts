import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { requireAgentCapability } from "./agent/capabilities.js";
import { registerAssetTools } from "./asset-tools.js";
import { AssetBridgeServer } from "./bridge/asset-bridge-server.js";
import {
  type DiagnosticsOptions,
  type GameObjectCreateOptions,
  type HierarchyOptions,
  type SceneSaveOptions,
  type TransformSetOptions,
  type Vector3Payload,
} from "./bridge/local-bridge-server.js";
import { registerGameObjectEditTools } from "./gameobject-edit-tools.js";
import { BRIDGE_PROTOCOL_VERSION } from "./protocol/bridge.js";

const bridge = new AssetBridgeServer();
const bridgePort = await bridge.start();
console.error(`[Unity AI Bridge] Local bridge listening on ws://127.0.0.1:${bridgePort}`);

const hierarchyInputSchema = fromJsonSchema({
  type: "object",
  properties: {
    maxDepth: {
      type: "integer",
      minimum: 1,
      maximum: 32,
      default: 8,
      description: "Maximum hierarchy depth to return, counting root GameObjects as depth 0. Allowed range: 1..32.",
    },
    maxNodes: {
      type: "integer",
      minimum: 1,
      maximum: 500,
      default: 200,
      description: "Maximum number of GameObjects to return in preorder. Allowed range: 1..500.",
    },
  },
  additionalProperties: false,
});

const diagnosticsInputSchema = fromJsonSchema({
  type: "object",
  properties: {
    maxEntries: {
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 100,
      description: "Maximum recent Console entries and compiler diagnostics to return after filtering. Allowed range: 1..200.",
    },
    minimumSeverity: {
      type: "string",
      enum: ["error", "warning", "log"],
      default: "warning",
      description: "Minimum severity to return. 'error' returns errors only, 'warning' returns errors and warnings, and 'log' also includes ordinary Console logs.",
    },
  },
  additionalProperties: false,
});

const resolveObjectInputSchema = fromJsonSchema({
  type: "object",
  required: ["globalObjectId"],
  properties: {
    globalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Unity GlobalObjectId string to re-resolve against current native Editor state. A syntactically valid ID may still return found=false when the target no longer exists or its scene is not loaded.",
    },
  },
  additionalProperties: false,
});

const transformGetInputSchema = fromJsonSchema({
  type: "object",
  required: ["globalObjectId"],
  properties: {
    globalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "GlobalObjectId of the GameObject whose Transform should be read. The current slice requires a GameObject target rather than silently switching from a Component to its owner.",
    },
  },
  additionalProperties: false,
});

const vector3Schema = {
  type: "object",
  required: ["x", "y", "z"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" },
  },
  additionalProperties: false,
} as const;

const transformSetInputSchema = fromJsonSchema({
  type: "object",
  required: [
    "globalObjectId",
    "localPosition",
    "localEulerAngles",
    "localScale",
    "expectedStateEpoch",
    "expectedStateRevision",
  ],
  properties: {
    globalObjectId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "GlobalObjectId of the active-scene GameObject to mutate.",
    },
    localPosition: {
      ...vector3Schema,
      description: "Complete local-space position to apply.",
    },
    localEulerAngles: {
      ...vector3Schema,
      description:
        "Complete local-space Euler rotation in degrees. Unity verifies the resulting rotation as a Quaternion so equivalent Euler representations are accepted.",
    },
    localScale: {
      ...vector3Schema,
      description: "Complete local-space scale to apply. Zero and negative components are allowed by this contract.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional idempotency key. Reuse exactly the same mutationId only when retrying this exact transform.set intent after an ambiguous timeout/disconnect. If omitted, the bridge generates one.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Required optimistic-concurrency epoch from the same recent observation as expectedStateRevision.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description:
        "Required optimistic-concurrency revision. The transform mutation is rejected if Unity state advanced after the observation.",
    },
  },
  additionalProperties: false,
});

const createGameObjectInputSchema = fromJsonSchema({
  type: "object",
  required: ["name"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Name for a new empty root GameObject in the active scene. Whitespace-only names are rejected.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional idempotency key. Reuse exactly the same mutationId only when retrying the same create after an ambiguous timeout/disconnect. If omitted, the bridge generates one.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Optional optimistic-concurrency token from a recent status, hierarchy, or object-resolve result. Must be supplied together with expectedStateRevision.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description:
        "Optional optimistic-concurrency revision from the same observation as expectedStateEpoch. The write is rejected if Unity state has advanced.",
    },
  },
  additionalProperties: false,
});

const saveSceneInputSchema = fromJsonSchema({
  type: "object",
  required: ["expectedScenePath", "expectedStateEpoch", "expectedStateRevision"],
  properties: {
    expectedScenePath: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description:
        "Exact active scene asset path from a recent Unity observation, for example Assets/Scenes/SampleScene.unity. The save is rejected if the active scene changed.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional retry identity. Reuse only for an ambiguous retry of this exact save intent. If omitted, the bridge generates one and includes it in ambiguous failure text.",
    },
    expectedStateEpoch: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Required optimistic-concurrency epoch from the same recent observation as expectedStateRevision.",
    },
    expectedStateRevision: {
      type: "integer",
      minimum: 1,
      description:
        "Required optimistic-concurrency revision. The disk save is rejected if Unity state advanced after the observation.",
    },
  },
  additionalProperties: false,
});

async function preflightAgentCapabilities(...capabilities: string[]): Promise<void> {
  const status = await bridge.requestEditorStatus();
  for (const capability of capabilities) {
    requireAgentCapability(status, capability);
  }
}

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await bridge.stop();
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

serveStdio(() => {
  const server = new McpServer({
    name: "unity-ai-bridge",
    version: `0.0.1-bridge-v${BRIDGE_PROTOCOL_VERSION}`,
  });

  registerGameObjectEditTools(server, bridge);
  registerAssetTools(server, bridge);

  server.registerTool(
    "unity_get_status",
    {
      description:
        "Read the connected Unity Editor version, project, active scene, Play Mode state, compilation state, Unity AI Bridge Agent version/capabilities, and current state epoch/revision when supported.",
    },
    async () => {
      try {
        const status = await bridge.requestEditorStatus();
        return {
          content: [{ type: "text", text: JSON.stringify(status) }],
          structuredContent: status,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_get_hierarchy",
    {
      description:
        "Read a bounded preorder snapshot of the active Unity scene hierarchy. Returns a stateEpoch/stateRevision token plus GlobalObjectId, transient instanceId, parent identity, depth, sibling index, child count, and active state. Pass the token to supported write tools when the mutation depends on this snapshot so stale state is rejected instead of silently overwritten.",
      inputSchema: hierarchyInputSchema,
    },
    async (args) => {
      try {
        const input = args as { maxDepth?: number; maxNodes?: number };
        const options: HierarchyOptions = {};
        if (input.maxDepth !== undefined) {
          options.maxDepth = input.maxDepth;
        }
        if (input.maxNodes !== undefined) {
          options.maxNodes = input.maxNodes;
        }

        await preflightAgentCapabilities("scene.hierarchy", "state.revision.v1");
        const hierarchy = await bridge.requestHierarchy(options);
        return {
          content: [{ type: "text", text: JSON.stringify(hierarchy) }],
          structuredContent: hierarchy,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_get_diagnostics",
    {
      description:
        "Read bounded Unity diagnostics using public Unity APIs. Returns current Console error/warning/log counts, recent Console messages captured since the current script-domain load, and the latest compilation messages observed through Unity's CompilationPipeline. The result explicitly reports coverage because public Unity APIs expose current Console counts but not a supported full historical Console-entry iterator.",
      inputSchema: diagnosticsInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          maxEntries?: number;
          minimumSeverity?: "error" | "warning" | "log";
        };
        const options: DiagnosticsOptions = {};
        if (input.maxEntries !== undefined) {
          options.maxEntries = input.maxEntries;
        }
        if (input.minimumSeverity !== undefined) {
          options.minimumSeverity = input.minimumSeverity;
        }

        await preflightAgentCapabilities("editor.diagnostics");
        const diagnostics = await bridge.requestDiagnostics(options);
        return {
          content: [{ type: "text", text: JSON.stringify(diagnostics) }],
          structuredContent: diagnostics,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_resolve_object",
    {
      description:
        "Re-resolve a Unity GlobalObjectId against current native Editor state and return the observation's stateEpoch/stateRevision. Use this before mutations when a target came from an earlier snapshot. Returns found=false instead of inventing a replacement when the target no longer exists.",
      inputSchema: resolveObjectInputSchema,
    },
    async (args) => {
      try {
        const input = args as { globalObjectId: string };
        await preflightAgentCapabilities("object.resolve", "state.revision.v1");
        const result = await bridge.requestResolveObject(input.globalObjectId);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_get_transform",
    {
      description:
        "Read the local and world Transform state of a GameObject identified by GlobalObjectId. Returns native position/rotation/scale readback plus a fresh stateEpoch/stateRevision suitable for the matching transform write tool.",
      inputSchema: transformGetInputSchema,
    },
    async (args) => {
      try {
        const input = args as { globalObjectId: string };
        await preflightAgentCapabilities("transform.get", "state.revision.v1");
        const result = await bridge.requestTransform(input.globalObjectId);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_set_transform",
    {
      description:
        "Set the complete local position, local Euler rotation, and local scale of an active-scene GameObject. Requires a fresh stateEpoch/stateRevision. Unity records Undo, verifies the native Transform after the write (rotation by Quaternion equivalence), rolls back and verifies rollback on failed semantic verification, enforces the command deadline before execution, and protects ambiguous retries with mutationId replay rules.",
      inputSchema: transformSetInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          globalObjectId: string;
          localPosition: Vector3Payload;
          localEulerAngles: Vector3Payload;
          localScale: Vector3Payload;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: TransformSetOptions = {
          globalObjectId: input.globalObjectId,
          localPosition: input.localPosition,
          localEulerAngles: input.localEulerAngles,
          localScale: input.localScale,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflightAgentCapabilities("transform.set", "state.revision.v1");
        const result = await bridge.requestSetTransform(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_create_game_object",
    {
      description:
        "Create one empty root GameObject in the active Unity scene. This is a write operation. When expectedStateEpoch + expectedStateRevision are supplied from a prior observation, Unity checks them atomically in mutation preflight and rejects stale state. Unity registers Undo, verifies the target by native GlobalObjectId readback, reports the post-write state revision, and deduplicates repeated delivery by mutationId.",
      inputSchema: createGameObjectInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          name: string;
          mutationId?: string;
          expectedStateEpoch?: string;
          expectedStateRevision?: number;
        };
        const options: GameObjectCreateOptions = { name: input.name };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }
        if (input.expectedStateEpoch !== undefined) {
          options.expectedStateEpoch = input.expectedStateEpoch;
        }
        if (input.expectedStateRevision !== undefined) {
          options.expectedStateRevision = input.expectedStateRevision;
        }

        await preflightAgentCapabilities("gameObject.create", "state.revision.v1");
        const result = await bridge.requestCreateGameObject(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_save_active_scene",
    {
      description:
        "Explicitly persist the currently active saved Unity scene to its existing .unity file. This is a destructive disk-write operation and has no Unity Undo. It requires the exact scene path plus stateEpoch/stateRevision from a recent observation so a changed scene or stale snapshot is rejected instead of saving newer/unreviewed state. Unsaved scenes with no asset path are rejected rather than opening an interactive Save As dialog.",
      inputSchema: saveSceneInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          expectedScenePath: string;
          mutationId?: string;
          expectedStateEpoch: string;
          expectedStateRevision: number;
        };
        const options: SceneSaveOptions = {
          expectedScenePath: input.expectedScenePath,
          expectedStateEpoch: input.expectedStateEpoch,
          expectedStateRevision: input.expectedStateRevision,
        };
        if (input.mutationId !== undefined) {
          options.mutationId = input.mutationId;
        }

        await preflightAgentCapabilities("scene.save", "state.revision.v1");
        const result = await bridge.requestSaveScene(options);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  return server;
});