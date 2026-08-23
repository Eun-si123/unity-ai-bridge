import assert from "node:assert/strict";
import test from "node:test";

import {
  readAgentCapabilitySnapshot,
  requireAgentCapability,
} from "../src/agent/capabilities.js";

const currentStatus = {
  unityVersion: "6000.3.21f1",
  projectName: "CapabilityTest",
  activeScene: "Assets/Scenes/SampleScene.unity",
  isPlaying: false,
  isCompiling: false,
  agentVersion: "0.0.1",
  capabilities: [
    "editor.status",
    "scene.hierarchy",
    "editor.diagnostics",
    "object.resolve",
    "gameObject.create",
  ],
};

test("reads advertised Agent version and capabilities", () => {
  assert.deepEqual(readAgentCapabilitySnapshot(currentStatus), {
    agentVersion: "0.0.1",
    capabilities: currentStatus.capabilities,
  });
});

test("accepts an operation explicitly advertised by the Agent", () => {
  const snapshot = requireAgentCapability(currentStatus, "object.resolve");
  assert.equal(snapshot.agentVersion, "0.0.1");
  assert.ok(snapshot.capabilities.includes("object.resolve"));
});

test("fails clearly when an older Agent has no capability metadata", () => {
  assert.throws(
    () =>
      requireAgentCapability(
        {
          unityVersion: "6000.3.21f1",
          projectName: "LegacyAgent",
          activeScene: "Assets/Scenes/SampleScene.unity",
          isPlaying: false,
          isCompiling: false,
        },
        "object.resolve",
      ),
    /unsupported\/agent_capabilities_missing/,
  );
});

test("fails before use when the Agent does not advertise the requested operation", () => {
  assert.throws(
    () =>
      requireAgentCapability(
        {
          ...currentStatus,
          agentVersion: "0.0.0-legacy",
          capabilities: ["editor.status", "scene.hierarchy"],
        },
        "object.resolve",
      ),
    /unsupported\/agent_capability_missing: Connected Unity Agent 0\.0\.0-legacy does not advertise 'object\.resolve'/,
  );
});

test("does not accept malformed capability arrays", () => {
  assert.throws(
    () =>
      readAgentCapabilitySnapshot({
        ...currentStatus,
        capabilities: ["editor.status", 123],
      }),
    /unsupported\/agent_capabilities_missing/,
  );
});
