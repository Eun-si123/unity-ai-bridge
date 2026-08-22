import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGE_PROTOCOL_VERSION,
  isBridgeProtocolVersion,
} from "../src/protocol/bridge.js";

test("bridge protocol v0 constant is pinned", () => {
  assert.equal(BRIDGE_PROTOCOL_VERSION, "0");
});

test("bridge protocol version guard accepts only v0", () => {
  assert.equal(isBridgeProtocolVersion("0"), true);
  assert.equal(isBridgeProtocolVersion("1"), false);
  assert.equal(isBridgeProtocolVersion(0), false);
});
