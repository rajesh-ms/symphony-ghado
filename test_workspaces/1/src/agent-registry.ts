import { randomUUID } from "node:crypto";

import { FileRegistryStore } from "./file-registry-store.js";
import {
  type AgentCardInput,
  type AgentRecord,
  type HeartbeatInput,
  type PaginatedResult,
  type ResolveOptions,
  type ResolveResult,
  type SearchFilters,
} from "./models.js";

class RegistryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends RegistryError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends RegistryError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class NotFoundError extends RegistryError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class AccessDeniedError extends RegistryError {
  constructor(message: string) {
    super(message, 403);
  }
}

export interface AgentRegistryOptions {
  store?: FileRegistryStore;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();

  constructor(private readonly options: AgentRegistryOptions = {}) {
    const storedRecords = this.options.store?.load() ?? [];
    for (const record of storedRecords) {
      this.agents.set(this.keyFor(record.name, record.version), clone(record));
    }
  }

  register(input: AgentCardInput): AgentRecord {
    const record = normalizeRegistration(input);
    const key = this.keyFor(record.name, record.version);

    if (this.agents.has(key)) {
      throw new ConflictError(`Agent ${record.name}@${record.version} is already registered.`);
    }

    this.agents.set(key, record);
    this.persist();
    return clone(record);
  }

  getByName(name: string, requester?: string): AgentRecord[] {
    const normalizedName = normalizeToken(name);
    const matches = this.records()
      .filter((record) => normalizeToken(record.name) === normalizedName)
      .filter((record) => this.isAllowed(record, requester, "view"))
      .sort((left, right) => compareVersions(right.version, left.version));

    return matches.map(clone);
  }

  get(name: string, version: string, requester?: string): AgentRecord {
    const record = this.agents.get(this.keyFor(name, version));

    if (!record) {
      throw new NotFoundError(`Agent ${name}@${version} was not found.`);
    }

    if (!this.isAllowed(record, requester, "view")) {
      throw new AccessDeniedError(`Requester ${requester ?? "anonymous"} cannot view ${name}@${version}.`);
    }

    return clone(record);
  }

  search(filters: SearchFilters = {}): PaginatedResult<AgentRecord> {
    const page = parsePositiveInteger(filters.page, "page", 1);
    const pageSize = parsePositiveInteger(filters.pageSize, "pageSize", 10);
    const action = filters.action ?? "view";

    const filtered = this.records()
      .filter((record) => this.isAllowed(record, filters.requester, action))
      .filter((record) => !filters.tag || includesToken(record.tags, filters.tag))
      .filter((record) => !filters.capability || includesToken(record.capabilities, filters.capability))
      .filter((record) => !filters.useCase || includesToken(record.useCases, filters.useCase))
      .filter((record) => !filters.owner || normalizeToken(record.ownerTeam) === normalizeToken(filters.owner))
      .filter((record) => !filters.status || record.status === filters.status)
      .filter((record) => filters.deprecated === undefined || record.deprecated === filters.deprecated)
      .sort((left, right) => {
        const nameOrder = left.name.localeCompare(right.name);
        return nameOrder !== 0 ? nameOrder : compareVersions(right.version, left.version);
      });

    const total = filtered.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map(clone);

    return { items, total, page, pageSize, totalPages };
  }

  resolve(name: string, options: ResolveOptions = {}): ResolveResult {
    const action = options.action ?? "invoke";
    const allCandidates = this.records()
      .filter((record) => normalizeToken(record.name) === normalizeToken(name))
      .filter((record) => !options.version || record.version === options.version);

    const candidates = allCandidates
      .filter((record) => this.isAllowed(record, options.requester, action))
      .filter((record) => record.status !== "inactive")
      .filter((record) => !record.deprecated)
      .sort((left, right) => compareVersions(right.version, left.version));

    const match = candidates[0];

    if (!match) {
      if (allCandidates.length > 0) {
        throw new AccessDeniedError(`Requester ${options.requester ?? "anonymous"} cannot ${action} ${name}.`);
      }

      throw new NotFoundError(`No callable agent found for ${name}${options.version ? `@${options.version}` : ""}.`);
    }

    return {
      name: match.name,
      version: match.version,
      endpoint: match.endpoint,
      supportedProtocols: [...match.supportedProtocols],
      authRequirements: clone(match.authRequirements),
      inputTypes: [...match.inputTypes],
      outputTypes: [...match.outputTypes],
      status: match.status,
      deprecated: match.deprecated,
    };
  }

  recordHeartbeat(name: string, version: string, heartbeat: HeartbeatInput = {}): AgentRecord {
    const key = this.keyFor(name, version);
    const record = this.agents.get(key);

    if (!record) {
      throw new NotFoundError(`Agent ${name}@${version} was not found.`);
    }

    const timestamp = heartbeat.timestamp ?? new Date().toISOString();
    assertIsoDate(timestamp, "timestamp");

    if (heartbeat.status) {
      validateLifecycleStatus(heartbeat.status, "status");
      record.status = heartbeat.status;
    }

    record.lastHeartbeat = timestamp;
    record.updatedAt = new Date().toISOString();
    this.persist();

    return clone(record);
  }

  private persist(): void {
    this.options.store?.save(this.records());
  }

  private keyFor(name: string, version: string): string {
    return `${normalizeToken(name)}@@${version.trim()}`;
  }

  private records(): AgentRecord[] {
    return [...this.agents.values()];
  }

  private isAllowed(record: AgentRecord, requester: string | undefined, action: "view" | "invoke"): boolean {
    const policy = action === "invoke" ? record.accessPolicy.invokers : record.accessPolicy.viewers;
    const normalizedRequester = requester ? normalizeToken(requester) : undefined;

    if (normalizedRequester && normalizeToken(record.ownerTeam) === normalizedRequester) {
      return true;
    }

    return policy.some((entry) => {
      const normalizedEntry = normalizeToken(entry);
      return normalizedEntry === "*" || (!!normalizedRequester && normalizedEntry === normalizedRequester);
    });
  }
}

function normalizeRegistration(input: AgentCardInput): AgentRecord {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Agent registration payload is required.");
  }

  const name = requireText(input.name, "name");
  const version = requireText(input.version, "version");
  const endpoint = requireUrl(input.endpoint, "endpoint");
  const ownerTeam = requireText(input.ownerTeam, "ownerTeam");
  const supportedProtocols = normalizeStringList(input.supportedProtocols, "supportedProtocols");
  const inputTypes = normalizeStringList(input.inputTypes, "inputTypes");
  const outputTypes = normalizeStringList(input.outputTypes, "outputTypes");
  const capabilities = normalizeStringList(input.capabilities, "capabilities");
  const tags = normalizeStringList(input.tags, "tags");
  const useCases = normalizeStringList(input.useCases, "useCases");
  const authRequirements = normalizeAuth(input.authRequirements);
  const accessPolicy = normalizeAccessPolicy(input.accessPolicy);
  const status = input.status ?? "active";
  const deprecated = input.deprecated ?? false;
  const now = new Date().toISOString();

  validateLifecycleStatus(status, "status");

  if (input.lastHeartbeat) {
    assertIsoDate(input.lastHeartbeat, "lastHeartbeat");
  }

  return {
    id: randomUUID(),
    name,
    version,
    endpoint,
    supportedProtocols,
    inputTypes,
    outputTypes,
    capabilities,
    tags,
    useCases,
    ownerTeam,
    authRequirements,
    status,
    deprecated,
    accessPolicy,
    createdAt: now,
    updatedAt: now,
    ...(input.lastHeartbeat ? { lastHeartbeat: input.lastHeartbeat } : {}),
  };
}

function normalizeAuth(input: AgentCardInput["authRequirements"]): AgentRecord["authRequirements"] {
  if (!input || typeof input !== "object") {
    throw new ValidationError("authRequirements is required.");
  }

  const allowedTypes = new Set(["none", "apiKey", "oauth2", "mtls"]);
  if (!allowedTypes.has(input.type)) {
    throw new ValidationError("authRequirements.type must be one of none, apiKey, oauth2, or mtls.");
  }

  return {
    type: input.type,
    ...(input.audience ? { audience: normalizeStringList(input.audience, "authRequirements.audience") } : {}),
    ...(input.scopes ? { scopes: normalizeStringList(input.scopes, "authRequirements.scopes") } : {}),
  };
}

function normalizeAccessPolicy(input: AgentCardInput["accessPolicy"]): AgentRecord["accessPolicy"] {
  if (!input || typeof input !== "object") {
    throw new ValidationError("accessPolicy is required.");
  }

  const viewers = normalizePrincipalList(input.viewers, "accessPolicy.viewers");
  const invokers = normalizePrincipalList(input.invokers, "accessPolicy.invokers");

  return { viewers, invokers };
}

function normalizePrincipalList(values: string[], field: string): string[] {
  const items = normalizeStringList(values, field);
  if (items.length === 0) {
    throw new ValidationError(`${field} must contain at least one principal or *.`);
  }

  return items;
}

function normalizeStringList(values: string[], field: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ValidationError(`${field} must be a non-empty array.`);
  }

  const normalized = [...new Set(values.map((value) => requireText(value, field)))];

  if (normalized.length === 0) {
    throw new ValidationError(`${field} must contain at least one item.`);
  }

  return normalized;
}

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`);
  }

  return value.trim();
}

function requireUrl(value: string, field: string): string {
  const urlText = requireText(value, field);

  try {
    const url = new URL(urlText);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new ValidationError(`${field} must use http or https.`);
    }

    return url.toString();
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    throw new ValidationError(`${field} must be a valid URL.`);
  }
}

function validateLifecycleStatus(value: string, field: string): void {
  const allowed = new Set(["active", "inactive", "degraded", "deprecated"]);

  if (!allowed.has(value)) {
    throw new ValidationError(`${field} must be one of active, inactive, degraded, or deprecated.`);
  }
}

function parsePositiveInteger(value: number | undefined, field: string, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer.`);
  }

  return value;
}

function includesToken(values: string[], query: string): boolean {
  const normalizedQuery = normalizeToken(query);
  return values.some((value) => normalizeToken(value) === normalizedQuery);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function assertIsoDate(value: string, field: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO-8601 timestamp.`);
  }
}

function compareVersions(left: string, right: string): number {
  const leftRawParts = left.split(".");
  const rightRawParts = right.split(".");
  const leftParts = leftRawParts.map((part) => Number.parseInt(part, 10));
  const rightParts = rightRawParts.map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    const numericDiff = leftPart - rightPart;

    if (!Number.isNaN(numericDiff) && numericDiff !== 0) {
      return numericDiff;
    }

    if (Number.isNaN(leftPart) || Number.isNaN(rightPart)) {
      const lexicalDiff = (leftRawParts[index] ?? "").localeCompare(rightRawParts[index] ?? "");
      if (lexicalDiff !== 0) {
        return lexicalDiff;
      }
    }
  }

  return left.localeCompare(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
