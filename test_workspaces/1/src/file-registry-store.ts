import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AgentRecord } from "./models.js";

export class FileRegistryStore {
  constructor(private readonly filePath: string) {}

  load(): AgentRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const raw = readFileSync(this.filePath, "utf8");
    if (raw.trim().length === 0) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Registry store ${this.filePath} must contain an array.`);
    }

    return parsed as AgentRecord[];
  }

  save(records: AgentRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(records, null, 2));
    renameSync(tempPath, this.filePath);
  }
}
