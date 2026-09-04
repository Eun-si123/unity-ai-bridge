import { randomUUID } from "node:crypto";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { PrefabPropertyBridgeServer } from "../bridge/prefab-property-bridge-server.js";
import { requestMutationStatus } from "../bridge/mutation-status-bridge.js";

const unityFacingPort = 5081;
const editorWaitMs = 30_000;
const ambiguousDeliveryTimeoutMs = 1_000;
const normalTimeoutMs = 5_000;
const verifierComponentType = "UnityEngine.BoxCollider";
const verifierPropertyPath = "m_IsTrigger";

class DroppedResultProxy {
  private readonly server: WebSocketServer;
  private armedOperation: string | undefined;
  private readonly requestOperations = new Map<string, string>();
  private readonly dropRequestIds = new Set<string>();
  private readonly droppedOperations = new Set<string>();
  private upstream: WebSocket | undefined;
  private downstream: WebSocket | undefined;

  public constructor(
    private readonly listenPort: number,
    private readonly internalPort: number,
  ) {
    this.server = new WebSocketServer({
      host: "127.0.0.1",
      port: this.listenPort,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    });
    this.server.on("connection", (socket) => this.attachUnity(socket));
  }

  public async start(): Promise<void> {
    if (this.server.address() !== null) return;
    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(
          new Error(
            `Could not start the live reconciliation fault proxy on 127.0.0.1:${this.listenPort}: ${error.message}. ` +
            "Stop any other Unity AI Bridge/MCP server using port 5081 and rerun.",
          ),
        );
      };
      const cleanup = (): void => {
        this.server.off("listening", onListening);
        this.server.off("error", onError);
      };
      this.server.once("listening", onListening);
      this.server.once("error", onError);
    });
  }

  public armDrop(operation: string): void {
    if (this.armedOperation !== undefined) {
      throw new Error(`A proxy fault is already armed for ${this.armedOperation}.`);
    }
    this.armedOperation = operation;
  }

  public wasDropped(operation: string): boolean {
    return this.droppedOperations.has(operation);
  }

  public async stop(): Promise<void> {
    this.upstream?.terminate();
    this.downstream?.terminate();
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private attachUnity(socket: WebSocket): void {
    if (this.upstream !== undefined && this.upstream.readyState !== WebSocket.CLOSED) {
      socket.close(1013, "reconciliation verifier already has a Unity connection");
      return;
    }

    this.upstream = socket;
    const downstream = new WebSocket(`ws://127.0.0.1:${this.internalPort}`);
    this.downstream = downstream;
    const queuedUpstreamMessages: string[] = [];

    socket.on("message", (data) => {
      if (this.shouldDropUnityResult(data)) {
        return;
      }

      const text = data.toString();
      if (downstream.readyState === WebSocket.OPEN) {
        downstream.send(text);
      } else {
        queuedUpstreamMessages.push(text);
      }
    });

    downstream.on("open", () => {
      for (const message of queuedUpstreamMessages.splice(0)) {
        downstream.send(message);
      }
    });

    downstream.on("message", (data) => {
      this.observeBridgeCommand(data);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data.toString());
      }
    });

    socket.on("close", () => downstream.terminate());
    downstream.on("close", () => {
      if (socket.readyState === WebSocket.OPEN) socket.terminate();
    });
  }

  private observeBridgeCommand(data: RawData): void {
    const parsed = parseRecord(data);
    const requestId = parsed?.requestId;
    const operation = parsed?.operation;
    if (typeof requestId !== "string" || typeof operation !== "string") return;

    this.requestOperations.set(requestId, operation);
    if (operation === this.armedOperation) {
      this.dropRequestIds.add(requestId);
      this.armedOperation = undefined;
      console.log(`[Unity AI Bridge] Injecting one lost response for ${operation} requestId=${requestId}.`);
    }
  }

  private shouldDropUnityResult(data: RawData): boolean {
    const parsed = parseRecord(data);
    const requestId = parsed?.requestId;
    if (typeof requestId !== "string" || !this.dropRequestIds.has(requestId)) {
      return false;
    }

    this.dropRequestIds.delete(requestId);
    const operation = this.requestOperations.get(requestId) ?? "unknown";
    this.requestOperations.delete(requestId);
    this.droppedOperations.add(operation);
    console.log(`[Unity AI Bridge] Dropped Unity result for ${operation} requestId=${requestId}.`);
    return true;
  }
}

function parseRecord(data: RawData): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(data.toString());
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const bridge = new PrefabPropertyBridgeServer("127.0.0.1", 0);
  let proxy: DroppedResultProxy | undefined;
  let cleanupGlobalObjectId: string | undefined;
  let cleanupName: string | undefined;

  const bestEffortCleanup = async (): Promise<void> => {
    if (cleanupGlobalObjectId === undefined && cleanupName === undefined) return;

    try {
      const hierarchy = await bridge.requestHierarchy({ maxDepth: 32, maxNodes: 500 }, 2_000);
      let targetId = cleanupGlobalObjectId;
      if (targetId === undefined && cleanupName !== undefined) {
        targetId = hierarchy.nodes.find((node) => node.name === cleanupName)?.globalObjectId;
      }
      if (targetId === undefined) return;

      const result = await bridge.requestDeleteGameObject(
        {
          globalObjectId: targetId,
          mutationId: `verify-reconcile-best-effort-cleanup-${randomUUID()}`,
          expectedStateEpoch: hierarchy.stateEpoch,
          expectedStateRevision: hierarchy.stateRevision,
        },
        2_000,
      );
      if (!result.deleted) {
        console.error(`[Unity AI Bridge] Cleanup warning: delete returned ${JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error(
        `[Unity AI Bridge] Cleanup warning: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  try {
    const internalPort = await bridge.start();
    proxy = new DroppedResultProxy(unityFacingPort, internalPort);
    await proxy.start();

    console.log(
      `[Unity AI Bridge] Reconciliation verifier proxy listening on ws://127.0.0.1:${unityFacingPort} -> internal bridge ${internalPort}.`,
    );
    console.log("[Unity AI Bridge] Waiting for Unity Editor to connect through the fault proxy...");
    const editor = await bridge.waitForEditor(editorWaitMs);

    const status = await bridge.requestEditorStatus(normalTimeoutMs);
    if (status.isCompiling) {
      throw new Error("Unity is compiling. Wait for compilation to finish and rerun the verifier.");
    }

    const initialHierarchy = await bridge.requestHierarchy({ maxDepth: 32, maxNodes: 500 }, normalTimeoutMs);
    if (initialHierarchy.scenePath.length === 0) {
      throw new Error(
        "The active Unity scene is unsaved/temporary. Open or save a persistent scene asset before running verify:mutation-reconciliation.",
      );
    }

    const originalName = `MCP_Reconciliation_${Date.now()}`;
    const updatedName = `${originalName}_Updated`;
    cleanupName = originalName;

    const createMutationId = `verify-reconcile-create-${randomUUID()}`;
    proxy.armDrop("gameObject.create");
    const create = await bridge.requestCreateGameObject(
      {
        name: originalName,
        mutationId: createMutationId,
        expectedStateEpoch: initialHierarchy.stateEpoch,
        expectedStateRevision: initialHierarchy.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    cleanupGlobalObjectId = create.globalObjectId;
    assertRecovered(create.replayed, proxy, "gameObject.create", createMutationId);
    const createStatus = await requestMutationStatus(bridge, createMutationId, normalTimeoutMs);
    assertCompletedStatus(createStatus, "gameObject.create", createMutationId);

    const updateMutationId = `verify-reconcile-update-${randomUUID()}`;
    proxy.armDrop("gameObject.update");
    const update = await bridge.requestUpdateGameObject(
      {
        globalObjectId: create.globalObjectId,
        name: updatedName,
        activeSelf: true,
        mutationId: updateMutationId,
        expectedStateEpoch: create.stateEpoch,
        expectedStateRevision: create.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    cleanupName = updatedName;
    assertRecovered(update.replayed, proxy, "gameObject.update", updateMutationId);
    if (update.gameObject.name !== updatedName || update.gameObject.activeSelf !== true) {
      throw new Error(`gameObject.update replay readback mismatch: ${JSON.stringify(update)}`);
    }
    const updateStatus = await requestMutationStatus(bridge, updateMutationId, normalTimeoutMs);
    assertCompletedStatus(updateStatus, "gameObject.update", updateMutationId);

    const transformBefore = await bridge.requestTransform(create.globalObjectId, normalTimeoutMs);
    const requestedPosition = {
      x: transformBefore.localPosition.x + 1.25,
      y: transformBefore.localPosition.y + 2.5,
      z: transformBefore.localPosition.z - 3.75,
    };
    const transformMutationId = `verify-reconcile-transform-${randomUUID()}`;
    proxy.armDrop("transform.set");
    const transformResult = await bridge.requestSetTransform(
      {
        globalObjectId: create.globalObjectId,
        localPosition: requestedPosition,
        localEulerAngles: transformBefore.localEulerAngles,
        localScale: transformBefore.localScale,
        mutationId: transformMutationId,
        expectedStateEpoch: transformBefore.stateEpoch,
        expectedStateRevision: transformBefore.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    assertRecovered(transformResult.replayed, proxy, "transform.set", transformMutationId);
    const transformStatus = await requestMutationStatus(bridge, transformMutationId, normalTimeoutMs);
    assertCompletedStatus(transformStatus, "transform.set", transformMutationId);

    const transformAfter = await bridge.requestTransform(create.globalObjectId, normalTimeoutMs);
    assertVectorApproximately(transformAfter.localPosition, requestedPosition, "final localPosition");

    const addMutationId = `verify-reconcile-component-add-${randomUUID()}`;
    proxy.armDrop("component.add");
    const added = await bridge.requestAddComponent(
      {
        gameObjectGlobalObjectId: create.globalObjectId,
        typeName: verifierComponentType,
        mutationId: addMutationId,
        expectedStateEpoch: transformAfter.stateEpoch,
        expectedStateRevision: transformAfter.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    assertRecovered(added.replayed, proxy, "component.add", addMutationId);
    if (added.component.typeName !== verifierComponentType) {
      throw new Error(`component.add replay type mismatch: ${JSON.stringify(added)}`);
    }
    const addStatus = await requestMutationStatus(bridge, addMutationId, normalTimeoutMs);
    assertCompletedStatus(addStatus, "component.add", addMutationId);

    const propertyMutationId = `verify-reconcile-component-property-${randomUUID()}`;
    proxy.armDrop("component.property.set");
    const property = await bridge.requestSetComponentProperty(
      {
        componentGlobalObjectId: added.component.globalObjectId,
        propertyPath: verifierPropertyPath,
        value: { kind: "boolean", boolValue: true },
        mutationId: propertyMutationId,
        expectedStateEpoch: added.component.stateEpoch,
        expectedStateRevision: added.component.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    assertRecovered(property.replayed, proxy, "component.property.set", propertyMutationId);
    if (property.property.boolValue !== true) {
      throw new Error(`component.property.set replay readback mismatch: ${JSON.stringify(property)}`);
    }
    const propertyStatus = await requestMutationStatus(bridge, propertyMutationId, normalTimeoutMs);
    assertCompletedStatus(propertyStatus, "component.property.set", propertyMutationId);

    const removeMutationId = `verify-reconcile-component-remove-${randomUUID()}`;
    proxy.armDrop("component.remove");
    const removed = await bridge.requestRemoveComponent(
      {
        componentGlobalObjectId: added.component.globalObjectId,
        mutationId: removeMutationId,
        expectedStateEpoch: property.component.stateEpoch,
        expectedStateRevision: property.component.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    assertRecovered(removed.replayed, proxy, "component.remove", removeMutationId);
    if (!removed.removed) {
      throw new Error(`component.remove replay did not report removed=true: ${JSON.stringify(removed)}`);
    }
    const removeStatus = await requestMutationStatus(bridge, removeMutationId, normalTimeoutMs);
    assertCompletedStatus(removeStatus, "component.remove", removeMutationId);

    const removedComponentReadback = await bridge.requestResolveObject(
      added.component.globalObjectId,
      normalTimeoutMs,
    );
    if (removedComponentReadback.found) {
      throw new Error(
        `Removed verifier Component still resolves after reconciliation: ${JSON.stringify(removedComponentReadback)}`,
      );
    }

    const deleteMutationId = `verify-reconcile-delete-${randomUUID()}`;
    proxy.armDrop("gameObject.delete");
    const deleted = await bridge.requestDeleteGameObject(
      {
        globalObjectId: create.globalObjectId,
        mutationId: deleteMutationId,
        expectedStateEpoch: removed.stateEpoch,
        expectedStateRevision: removed.stateRevision,
      },
      ambiguousDeliveryTimeoutMs,
    );
    assertRecovered(deleted.replayed, proxy, "gameObject.delete", deleteMutationId);
    if (!deleted.deleted) {
      throw new Error(`gameObject.delete replay did not report deleted=true: ${JSON.stringify(deleted)}`);
    }
    const deleteStatus = await requestMutationStatus(bridge, deleteMutationId, normalTimeoutMs);
    assertCompletedStatus(deleteStatus, "gameObject.delete", deleteMutationId);
    cleanupGlobalObjectId = undefined;
    cleanupName = undefined;

    const finalHierarchy = await bridge.requestHierarchy({ maxDepth: 32, maxNodes: 500 }, normalTimeoutMs);
    const remaining = finalHierarchy.nodes.filter(
      (node) => node.globalObjectId === create.globalObjectId || node.name === originalName || node.name === updatedName,
    );
    if (remaining.length !== 0) {
      throw new Error(`Temporary reconciliation verifier object still exists: ${JSON.stringify(remaining)}`);
    }

    console.log("[Unity AI Bridge] Common mutation reconciliation verification PASS:");
    console.log(JSON.stringify({
      unityVersion: status.unityVersion,
      editorId: editor.editorId,
      initialConnectionGeneration: editor.connectionGeneration,
      activeScenePath: initialHierarchy.scenePath,
      injectedFault: "drop_first_success_result_after_unity_execution",
      verifiedOperations: [
        "gameObject.create",
        "gameObject.update",
        "transform.set",
        "component.add",
        "component.property.set",
        "component.remove",
        "gameObject.delete",
      ],
      createMutationId,
      createRecoveredViaSameIdReplay: create.replayed,
      createLifecycleStatus: createStatus.status,
      updateMutationId,
      updateRecoveredViaSameIdReplay: update.replayed,
      updateLifecycleStatus: updateStatus.status,
      transformMutationId,
      transformRecoveredViaSameIdReplay: transformResult.replayed,
      transformLifecycleStatus: transformStatus.status,
      addMutationId,
      addRecoveredViaSameIdReplay: added.replayed,
      addLifecycleStatus: addStatus.status,
      propertyMutationId,
      propertyRecoveredViaSameIdReplay: property.replayed,
      propertyLifecycleStatus: propertyStatus.status,
      removeMutationId,
      removeRecoveredViaSameIdReplay: removed.replayed,
      removeLifecycleStatus: removeStatus.status,
      deleteMutationId,
      deleteRecoveredViaSameIdReplay: deleted.replayed,
      deleteLifecycleStatus: deleteStatus.status,
      createResultDropped: proxy.wasDropped("gameObject.create"),
      updateResultDropped: proxy.wasDropped("gameObject.update"),
      transformResultDropped: proxy.wasDropped("transform.set"),
      addResultDropped: proxy.wasDropped("component.add"),
      propertyResultDropped: proxy.wasDropped("component.property.set"),
      removeResultDropped: proxy.wasDropped("component.remove"),
      deleteResultDropped: proxy.wasDropped("gameObject.delete"),
      finalPositionVerified: true,
      removedComponentStillPresent: false,
      temporaryObjectRemaining: false,
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[Unity AI Bridge] Common mutation reconciliation verification FAILED:\n${message}`);
    process.exitCode = 1;
  } finally {
    await bestEffortCleanup();
    await proxy?.stop();
    await bridge.stop();
  }
}

function assertRecovered(
  replayed: boolean,
  proxy: DroppedResultProxy,
  operation: string,
  mutationId: string,
): void {
  if (!replayed) {
    throw new Error(
      `Expected ${operation} to recover through same-id replay after the injected lost response, but replayed=false mutationId=${mutationId}`,
    );
  }
  if (!proxy.wasDropped(operation)) {
    throw new Error(`The verifier did not actually drop the first ${operation} result.`);
  }
}

function assertCompletedStatus(
  status: { mutationId: string; found: boolean; operation: string; status: string; terminal: boolean },
  operation: string,
  mutationId: string,
): void {
  if (
    !status.found ||
    status.mutationId !== mutationId ||
    status.operation !== operation ||
    status.status !== "completed" ||
    status.terminal !== true
  ) {
    throw new Error(
      `Unexpected reconciled lifecycle for ${operation}/${mutationId}: ${JSON.stringify(status)}`,
    );
  }
}

function assertVectorApproximately(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  label: string,
): void {
  const tolerance = 0.0001;
  if (
    Math.abs(actual.x - expected.x) > tolerance ||
    Math.abs(actual.y - expected.y) > tolerance ||
    Math.abs(actual.z - expected.z) > tolerance
  ) {
    throw new Error(`${label} mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

await main();
