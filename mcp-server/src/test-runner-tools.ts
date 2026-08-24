import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  PrefabPropertyBridgeServer,
  type TestRunStartOptions,
} from "./bridge/prefab-property-bridge-server.js";
import {
  requestStartPlayModeTests,
  requestTestRunAnyMode,
} from "./bridge/playmode-test-runner-bridge.js";

const commonTestNamesProperty = {
  type: "array",
  maxItems: 64,
  uniqueItems: true,
  items: {
    type: "string",
    minLength: 1,
    maxLength: 512,
  },
  description:
    "Optional exact full NUnit/Unity test names. Omit to run the selected assembly. Regex/group/category filtering is intentionally excluded from the bounded slice.",
} as const;

const commonMutationIdProperty = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9._:-]+$",
  description:
    "Optional idempotency key for scheduling this exact run. Reuse the same mutationId only to retry/read back the same mode/assembly/test selection; a same-id retry never schedules a second run.",
} as const;

const startEditModeTestsInputSchema = fromJsonSchema({
  type: "object",
  required: ["assemblyName"],
  properties: {
    assemblyName: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Exact Unity EditMode test assembly name without the .dll extension, for example EunSung.UnityAiBridge.Editor.Tests. The bounded slice does not allow an implicit project-wide run.",
    },
    testNames: commonTestNamesProperty,
    mutationId: commonMutationIdProperty,
  },
  additionalProperties: false,
});

const startPlayModeTestsInputSchema = fromJsonSchema({
  type: "object",
  required: ["assemblyName"],
  properties: {
    assemblyName: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Exact Unity PlayMode test assembly name without the .dll extension, for example EunSung.UnityAiBridge.PlayMode.Tests. Unity Test Framework owns the Edit-to-Play-to-Edit lifecycle for this run.",
    },
    testNames: commonTestNamesProperty,
    mutationId: commonMutationIdProperty,
  },
  additionalProperties: false,
});

const getTestRunInputSchema = fromJsonSchema({
  type: "object",
  required: ["mutationId"],
  properties: {
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Run mutationId returned by unity_start_editmode_tests or unity_start_playmode_tests. Test-run journals are current-Editor-session state and do not survive a full Editor restart.",
    },
  },
  additionalProperties: false,
});

export function registerTestRunnerTools(
  server: McpServer,
  bridge: PrefabPropertyBridgeServer,
): void {
  server.registerTool(
    "unity_start_editmode_tests",
    {
      description:
        "Schedule one bounded Unity EditMode Test Framework run for an explicit test assembly, optionally narrowed to exact test names. This operational action can execute arbitrary behavior contained in the selected tests, so project/scene dirty state is reported conservatively. The call returns quickly with a mutationId/runGuid; poll unity_get_test_run for asynchronous completion. Same-mutation retries are readback-only and never schedule the run twice.",
      inputSchema: startEditModeTestsInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          assemblyName: string;
          testNames?: string[];
          mutationId?: string;
        };
        const options = buildStartOptions(input);

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "test.run.editMode.start");
        requireAgentCapability(status, "test.run.get");

        const result = await bridge.requestStartEditModeTests(options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_start_playmode_tests",
    {
      description:
        "Schedule one bounded Unity PlayMode Test Framework run from stable Edit Mode for an explicit PlayMode test assembly, optionally narrowed to exact test names. Unity Test Framework owns the Play Mode lifecycle and may trigger domain reload/reconnect. The call uses same-mutation reconciliation for ambiguous start delivery and returns a mutationId/runGuid; poll unity_get_test_run through temporary reconnects until terminal completion.",
      inputSchema: startPlayModeTestsInputSchema,
    },
    async (args) => {
      try {
        const input = args as {
          assemblyName: string;
          testNames?: string[];
          mutationId?: string;
        };
        const options = buildStartOptions(input);

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "test.run.playMode.start");
        requireAgentCapability(status, "test.run.get");

        const result = await requestStartPlayModeTests(bridge, options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unity_get_test_run",
    {
      description:
        "Read the current or terminal structured result for a Unity AI Bridge-owned EditMode or PlayMode test run. Returns scheduled/running/completed/error status, mode, Unity run GUID, aggregate counts/duration, and up to 100 bounded non-passed leaf-test details. This does not start or repeat tests.",
      inputSchema: getTestRunInputSchema,
    },
    async (args) => {
      try {
        const input = args as { mutationId: string };
        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "test.run.get");

        const result = await requestTestRunAnyMode(bridge, input.mutationId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function buildStartOptions(input: {
  assemblyName: string;
  testNames?: string[];
  mutationId?: string;
}): TestRunStartOptions {
  const options: TestRunStartOptions = {
    assemblyName: input.assemblyName,
  };
  if (input.testNames !== undefined) options.testNames = input.testNames;
  if (input.mutationId !== undefined) options.mutationId = input.mutationId;
  return options;
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
