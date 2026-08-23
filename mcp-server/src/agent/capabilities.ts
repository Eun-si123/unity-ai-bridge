export interface AgentCapabilitySnapshot {
  agentVersion: string;
  capabilities: string[];
}

export function readAgentCapabilitySnapshot(status: unknown): AgentCapabilitySnapshot {
  if (typeof status !== "object" || status === null) {
    throw new Error(
      "unsupported/agent_capabilities_missing: Connected Unity Agent returned no capability metadata. Reimport or update the Unity AI Bridge package and let Unity finish recompiling.",
    );
  }

  const candidate = status as Record<string, unknown>;
  if (
    typeof candidate.agentVersion !== "string" ||
    candidate.agentVersion.length === 0 ||
    !Array.isArray(candidate.capabilities) ||
    !candidate.capabilities.every(
      (value) => typeof value === "string" && value.length > 0,
    )
  ) {
    throw new Error(
      "unsupported/agent_capabilities_missing: Connected Unity Agent does not advertise agentVersion + capabilities. The loaded Unity assembly is probably older than the MCP server. Reimport or update the Unity AI Bridge package and let Unity finish recompiling.",
    );
  }

  return {
    agentVersion: candidate.agentVersion,
    capabilities: [...candidate.capabilities] as string[],
  };
}

export function requireAgentCapability(
  status: unknown,
  operation: string,
): AgentCapabilitySnapshot {
  const snapshot = readAgentCapabilitySnapshot(status);
  if (!snapshot.capabilities.includes(operation)) {
    throw new Error(
      `unsupported/agent_capability_missing: Connected Unity Agent ${snapshot.agentVersion} does not advertise '${operation}'. Update/reimport the Unity package before retrying this tool.`,
    );
  }

  return snapshot;
}
