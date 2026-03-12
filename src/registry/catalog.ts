export type RegistryEntryType = "agent" | "mcp_server";

interface RegistryEntryBase {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: RegistryEntryType;
  provider: string;
  tags: string[];
  capabilities: string[];
  use_cases: string[];
  featured: boolean;
}

export interface AgentRegistryEntry extends RegistryEntryBase {
  type: "agent";
  interaction_model: string;
}

export interface McpServerRegistryEntry extends RegistryEntryBase {
  type: "mcp_server";
  transport: string;
}

export type RegistryEntry = AgentRegistryEntry | McpServerRegistryEntry;

export interface RegistryCatalog {
  generated_at: string;
  counts: {
    total: number;
    agents: number;
    mcp_servers: number;
  };
  filters: {
    tags: string[];
    capabilities: string[];
  };
  entries: RegistryEntry[];
}

const agentEntries: AgentRegistryEntry[] = [
  {
    id: "agent-codepilot",
    slug: "codepilot",
    name: "CodePilot",
    description: "Builds features, fixes defects, and proposes code changes with repository context.",
    type: "agent",
    provider: "Symphony Labs",
    tags: ["engineering", "typescript", "delivery"],
    capabilities: ["code generation", "refactoring", "test authoring", "code review"],
    use_cases: ["Ship backlog items", "Generate implementation plans", "Reduce review turnaround"],
    featured: true,
    interaction_model: "Autonomous multi-turn coding workflow",
  },
  {
    id: "agent-support-triage",
    slug: "support-triage",
    name: "Support Triage Analyst",
    description: "Categorizes inbound incidents, drafts next actions, and routes work to the right owner.",
    type: "agent",
    provider: "Symphony Labs",
    tags: ["operations", "support", "triage"],
    capabilities: ["classification", "summarization", "workflow routing"],
    use_cases: ["Sort customer issues", "Generate handoff notes", "Prioritize urgent cases"],
    featured: false,
    interaction_model: "Human-in-the-loop case resolution assistant",
  },
  {
    id: "agent-growth-researcher",
    slug: "growth-researcher",
    name: "Growth Researcher",
    description: "Evaluates market signals, competitors, and messaging opportunities for product teams.",
    type: "agent",
    provider: "Symphony Labs",
    tags: ["research", "go-to-market", "product"],
    capabilities: ["competitive analysis", "trend synthesis", "brief generation"],
    use_cases: ["Prepare launch briefs", "Study competitors", "Draft market hypotheses"],
    featured: false,
    interaction_model: "Research copilot with guided prompts",
  },
];

const mcpServerEntries: McpServerRegistryEntry[] = [
  {
    id: "mcp-ado-tracker",
    slug: "ado-tracker",
    name: "Azure DevOps Tracker",
    description: "Exposes work items, comments, and status transitions from Azure DevOps to connected agents.",
    type: "mcp_server",
    provider: "Symphony Labs",
    tags: ["azure-devops", "tracking", "delivery"],
    capabilities: ["issue lookup", "comment sync", "status updates"],
    use_cases: ["Read sprint backlog", "Post implementation updates", "Sync issue state"],
    featured: true,
    transport: "stdio",
  },
  {
    id: "mcp-repo-insights",
    slug: "repo-insights",
    name: "Repository Insights",
    description: "Provides repository metadata, file search, and commit history for coding and review agents.",
    type: "mcp_server",
    provider: "Symphony Labs",
    tags: ["git", "repository", "engineering"],
    capabilities: ["file discovery", "commit history", "diff inspection"],
    use_cases: ["Inspect ownership", "Trace regressions", "Find implementation patterns"],
    featured: true,
    transport: "stdio",
  },
  {
    id: "mcp-knowledge-base",
    slug: "knowledge-base",
    name: "Knowledge Base Search",
    description: "Lets agents search internal documentation, runbooks, and architecture decisions.",
    type: "mcp_server",
    provider: "Symphony Labs",
    tags: ["knowledge", "documentation", "support"],
    capabilities: ["semantic search", "document retrieval", "citation snippets"],
    use_cases: ["Answer operational questions", "Surface runbooks", "Link implementation guidance"],
    featured: false,
    transport: "http+sse",
  },
];

export function getRegistryCatalog(now = new Date()): RegistryCatalog {
  const entries = [...agentEntries, ...mcpServerEntries].sort((left, right) => {
    if (left.featured !== right.featured) {
      return left.featured ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  return {
    generated_at: now.toISOString(),
    counts: {
      total: entries.length,
      agents: agentEntries.length,
      mcp_servers: mcpServerEntries.length,
    },
    filters: {
      tags: uniqueValues(entries.flatMap((entry) => entry.tags)),
      capabilities: uniqueValues(entries.flatMap((entry) => entry.capabilities)),
    },
    entries,
  };
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
