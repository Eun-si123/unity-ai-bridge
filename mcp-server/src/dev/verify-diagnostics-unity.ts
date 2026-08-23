import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const timeoutMs = process.argv.includes("--require-compiler-error") ? 60_000 : 30_000;
const pollIntervalMs = 500;
const requireCompilerError = process.argv.includes("--require-compiler-error");

const client = new Client({
  name: "unity-ai-bridge-diagnostics-verifier",
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
  if (!tools.some((tool) => tool.name === "unity_get_status")) {
    throw new Error("MCP server did not advertise unity_get_status.");
  }
  if (!tools.some((tool) => tool.name === "unity_get_diagnostics")) {
    throw new Error("MCP server did not advertise unity_get_diagnostics.");
  }

  console.log("[Unity AI Bridge] MCP handshake PASS; diagnostics tool is advertised.");
  console.log(`[Unity AI Bridge] Waiting up to ${timeoutMs / 1000}s for Unity to connect...`);
  await waitForUnityReady();

  if (requireCompilerError) {
    console.log(
      "[Unity AI Bridge] Waiting for a compiler ERROR captured by Unity CompilationPipeline. Trigger one temporary C# compile error in the open Unity project now.",
    );
    const diagnostics = await waitForCompilerError();
    console.log("[Unity AI Bridge] Compiler diagnostic capture PASS:");
    console.log(JSON.stringify(diagnostics, null, 2));
  } else {
    const result = await client.callTool({
      name: "unity_get_diagnostics",
      arguments: {
        maxEntries: 100,
        minimumSeverity: "warning",
      },
    });

    if (result.isError) {
      throw new Error(`unity_get_diagnostics failed: ${readToolText(result)}`);
    }

    const diagnostics = result.structuredContent;
    if (!isDiagnosticsPayload(diagnostics)) {
      throw new Error(
        `unity_get_diagnostics returned invalid structuredContent: ${JSON.stringify(diagnostics)}`,
      );
    }

    console.log("[Unity AI Bridge] Live diagnostics read PASS:");
    console.log(JSON.stringify(diagnostics, null, 2));
    console.log(
      "[Unity AI Bridge] NOTE: this proves the live bounded diagnostics path. Run verify:compiler-error while intentionally triggering one temporary C# compiler error to verify message/file/line capture end-to-end.",
    );
  }

  process.exitCode = 0;
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[Unity AI Bridge] Diagnostics verification FAILED:\n${message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

async function waitForUnityReady(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No Unity status result received.";

  while (Date.now() < deadline) {
    const status = await client.callTool({
      name: "unity_get_status",
      arguments: {},
    });

    if (!status.isError) {
      return;
    }

    lastError = readToolText(status);
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for Unity connection. Last tool error: ${lastError}`);
}

async function waitForCompilerError(): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostics: unknown;

  while (Date.now() < deadline) {
    const result = await client.callTool({
      name: "unity_get_diagnostics",
      arguments: {
        maxEntries: 200,
        minimumSeverity: "warning",
      },
    });

    if (!result.isError) {
      lastDiagnostics = result.structuredContent;
      if (!isDiagnosticsPayload(lastDiagnostics)) {
        throw new Error(
          `unity_get_diagnostics returned invalid structuredContent: ${JSON.stringify(lastDiagnostics)}`,
        );
      }

      const compilation = lastDiagnostics.latestCompilation as Record<string, unknown>;
      const messages = compilation.messages as unknown[];
      if (messages.some(isCompilerError)) {
        return lastDiagnostics;
      }
    }

    await delay(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for a captured compiler error. Last diagnostics: ${JSON.stringify(lastDiagnostics)}`,
  );
}

function isCompilerError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (value as Record<string, unknown>).severity === "error";
}

function readToolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((block) => block.type === "text");
  return text?.text ?? "tool returned isError=true without text";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDiagnosticsPayload(value: unknown): value is Record<string, unknown> & {
  latestCompilation: Record<string, unknown> & { messages: unknown[] };
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.consoleCounts !== "object" ||
    candidate.consoleCounts === null ||
    typeof candidate.isCompiling !== "boolean" ||
    typeof candidate.captureStartedUnixMs !== "number" ||
    typeof candidate.minimumSeverity !== "string" ||
    typeof candidate.maxEntries !== "number" ||
    typeof candidate.consoleEntryCoverage !== "string" ||
    typeof candidate.compilerCoverage !== "string" ||
    typeof candidate.consoleEntriesTruncated !== "boolean" ||
    typeof candidate.compilerMessagesTruncated !== "boolean" ||
    !Array.isArray(candidate.recentConsoleEntries) ||
    typeof candidate.latestCompilation !== "object" ||
    candidate.latestCompilation === null
  ) {
    return false;
  }

  const counts = candidate.consoleCounts as Record<string, unknown>;
  const compilation = candidate.latestCompilation as Record<string, unknown>;
  return (
    isNonNegativeInteger(counts.errors) &&
    isNonNegativeInteger(counts.warnings) &&
    isNonNegativeInteger(counts.logs) &&
    isNonNegativeInteger(compilation.sequence) &&
    isNonNegativeInteger(compilation.completedUnixMs) &&
    typeof compilation.truncated === "boolean" &&
    Array.isArray(compilation.messages)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
