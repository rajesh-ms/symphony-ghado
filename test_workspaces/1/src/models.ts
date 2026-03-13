export type LifecycleStatus = "active" | "inactive" | "degraded" | "deprecated";

export interface AuthRequirement {
  type: "none" | "apiKey" | "oauth2" | "mtls";
  audience?: string[];
  scopes?: string[];
}

export interface AccessPolicy {
  viewers: string[];
  invokers: string[];
}

export interface AgentCardInput {
  name: string;
  version: string;
  endpoint: string;
  supportedProtocols: string[];
  inputTypes: string[];
  outputTypes: string[];
  capabilities: string[];
  tags: string[];
  useCases: string[];
  ownerTeam: string;
  authRequirements: AuthRequirement;
  status?: LifecycleStatus;
  lastHeartbeat?: string;
  deprecated?: boolean;
  accessPolicy: AccessPolicy;
}

export interface AgentRecord extends Omit<AgentCardInput, "status" | "deprecated"> {
  id: string;
  status: LifecycleStatus;
  deprecated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchFilters {
  tag?: string;
  capability?: string;
  useCase?: string;
  owner?: string;
  status?: LifecycleStatus;
  deprecated?: boolean;
  requester?: string;
  action?: "view" | "invoke";
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ResolveOptions {
  version?: string;
  requester?: string;
  action?: "view" | "invoke";
}

export interface ResolveResult {
  name: string;
  version: string;
  endpoint: string;
  supportedProtocols: string[];
  authRequirements: AuthRequirement;
  inputTypes: string[];
  outputTypes: string[];
  status: LifecycleStatus;
  deprecated: boolean;
}

export interface HeartbeatInput {
  timestamp?: string;
  status?: LifecycleStatus;
}
