import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";

import { requireAgentCapability } from "./agent/capabilities.js";
import {
  PrefabPropertyBridgeServer,
  type TestRunStartOptions,
} from "./bridge/prefab-property-bridge-server.js";

const startEditModeTestsInputSchema = fromJsonSchema({
  type: "object",
  required: ["assemblyName"],
  properties: {
    assemblyName: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Exact Unity EditMode test assembly name without the .dll extension, for example EunSung.UnityAiBridge.Editor.Tests. The first slice does not allow an implicit project-wide run.",
    },
    testNames: {
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 512,
      },
      description:
        "Optional exact full NUnit/Unity test names. Omit to run the selected assembly. Regex/group/category filtering is intentionally excluded from the first bounded slice.",
    },
    mutationId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      description:
        "Optional idempotency key for scheduling this exact run. Reuse the same mutationId only to retry/read back the same assembly/test selection; a same-id retry never schedules a second run.",
    },
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
        "Run mutationId returned by unity_start_editmode_tests. Test-run journals are current-Editor-session state and do not survive a full Editor restart.",
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
        const options: TestRunStartOptions = {
          assemblyName: input.assemblyName,
        };
        if (input.testNames !== undefined) options.testNames = input.testNames;
        if (input.mutationId !== undefined) options.mutationId = input.mutationId;

        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "test.run.editMode.start");
        requireAgentCapability(status, "test.run.get");

        const result = await bridge.requestStartEditModeTests(options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );

  server.registerTool(
    "unity_get_test_run",
    {
      description:
        "Read the current or terminal structured result for a Unity AI Bridge-owned EditMode test run. Returns scheduled/running/completed/error status, Unity run GUID, aggregate counts/duration, and up to 100 bounded non-passed leaf-test details. This does not start or repeat tests.",
      inputSchema: getTestRunInputSchema,
    },
    async (args) => {
      try {
        const input = args as { mutationId: string };
        const status = await bridge.requestEditorStatus();
        requireAgentCapability(status, "test.run.get");

        const result = await bridge.requestTestRun(input.mutationId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
        };
      }
    },
  );
}
