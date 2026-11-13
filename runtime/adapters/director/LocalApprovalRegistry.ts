import { createHash, randomBytes } from "node:crypto";
import type {
  DeviceApproval,
  DevicePermission,
  DevicePermissionBroker,
  MemoryChangeApproval
} from "../../../packages/intelligence/director/DirectorCapabilities";
import type { ToolApprovalRequest, ToolApprovalVerifier } from "../../../packages/intelligence/tooling/ToolDirector";

type MemoryScope = {
  kind: "memory-change";
  taskId: string;
  proposalId: string;
  changeIndex: number;
  changeDigest: string;
};

type ToolScope = {
  kind: "tool-change";
  operation: "activate" | "retire";
  taskId: string;
  toolId: string;
  version: number;
  digest: string;
};

type DeviceScope = {
  kind: "device-action";
  taskId: string;
  permission: DevicePermission;
  resourceId?: string;
  actionDigest: string;
};

export type LocalApprovalScope = MemoryScope | ToolScope | DeviceScope;

interface ApprovalRecord {
  scope: string;
  expiresAt: number;
}

/**
 * Process-local, one-time approval verifier for a trusted host approval UI.
 *
 * grant() is the trust boundary: call it only after an authenticated human
 * explicitly approves the displayed, exact action. Never expose grant() as a
 * model-callable tool or an unauthenticated HTTP endpoint. Grants are volatile
 * and intentionally disappear on process restart.
 */
export class LocalApprovalRegistry implements MemoryChangeApproval, ToolApprovalVerifier, DevicePermissionBroker {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxPending?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxPending = options.maxPending ?? 256;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1_000 || this.ttlMs > 300_000) {
      throw new Error("Approval TTL must be between 1,000 and 300,000 milliseconds");
    }
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 10_000) {
      throw new Error("Approval capacity must be between 1 and 10,000");
    }
  }

  /** Issue an opaque, short-lived reference after a separate human approval. */
  grant(scope: LocalApprovalScope): string {
    const normalized = normalizeScope(scope);
    this.pruneExpired();
    if (this.records.size >= this.maxPending) {
      throw new Error("Approval registry is full; no new approval was issued");
    }
    const approvalRef = randomBytes(32).toString("base64url");
    const key = hashRef(approvalRef);
    this.records.set(key, {
      scope: JSON.stringify(normalized),
      expiresAt: this.now() + this.ttlMs
    });
    return approvalRef;
  }

  verify(input: Parameters<MemoryChangeApproval["verify"]>[0]): boolean;
  verify(input: ToolApprovalRequest): boolean;
  verify(input: DeviceApproval): boolean;
  verify(input: Parameters<MemoryChangeApproval["verify"]>[0] | ToolApprovalRequest | DeviceApproval): boolean {
    if (!input || typeof input !== "object" || typeof input.approvalRef !== "string") return false;
    let scope: LocalApprovalScope;
    try {
      if ("proposalId" in input && "changeIndex" in input && "changeDigest" in input) {
        scope = normalizeScope({
          kind: "memory-change",
          taskId: input.taskId,
          proposalId: input.proposalId,
          changeIndex: input.changeIndex,
          changeDigest: input.changeDigest
        });
      } else if ("operation" in input && "toolId" in input && "version" in input && "digest" in input) {
        scope = normalizeScope({
          kind: "tool-change",
          operation: input.operation,
          taskId: input.taskId,
          toolId: input.toolId,
          version: input.version,
          digest: input.digest
        });
      } else if ("permission" in input && "actionDigest" in input) {
        scope = normalizeScope({
          kind: "device-action",
          taskId: input.taskId,
          permission: input.permission,
          ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
          actionDigest: input.actionDigest
        });
      } else {
        return false;
      }
    } catch {
      return false;
    }

    if (!/^[A-Za-z0-9_-]{43}$/.test(input.approvalRef)) return false;
    const key = hashRef(input.approvalRef);
    const record = this.records.get(key);
    if (!record) return false;
    if (record.expiresAt <= this.now()) {
      this.records.delete(key);
      return false;
    }
    if (record.scope !== JSON.stringify(scope)) return false;

    // No await occurs between checking and deleting, so concurrent callers
    // cannot both consume the same grant in this process.
    this.records.delete(key);
    return true;
  }

  revoke(approvalRef: string): boolean {
    if (typeof approvalRef !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(approvalRef)) return false;
    return this.records.delete(hashRef(approvalRef));
  }

  pruneExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get pendingCount(): number {
    this.pruneExpired();
    return this.records.size;
  }
}

function normalizeScope(scope: LocalApprovalScope): LocalApprovalScope {
  if (!scope || typeof scope !== "object") throw new Error("Approval scope is required");
  const taskId = requireText(scope.taskId, "taskId", 256);
  switch (scope.kind) {
    case "memory-change":
      if (!Number.isSafeInteger(scope.changeIndex) || scope.changeIndex < 0) throw new Error("Invalid memory change index");
      return {
        kind: "memory-change",
        taskId,
        proposalId: requireText(scope.proposalId, "proposalId", 256),
        changeIndex: scope.changeIndex,
        changeDigest: requireDigest(scope.changeDigest, "changeDigest")
      };
    case "tool-change":
      if (scope.operation !== "activate" && scope.operation !== "retire") throw new Error("Invalid tool approval operation");
      if (!Number.isSafeInteger(scope.version) || scope.version < 1) throw new Error("Invalid tool version");
      return {
        kind: "tool-change",
        operation: scope.operation,
        taskId,
        toolId: requireText(scope.toolId, "toolId", 128),
        version: scope.version,
        digest: requireDigest(scope.digest, "digest")
      };
    case "device-action":
      if (!["apps.list", "apps.open", "storage.inspect", "files.read", "files.write", "files.delete"].includes(scope.permission)) {
        throw new Error("Invalid device permission");
      }
      return {
        kind: "device-action",
        taskId,
        permission: scope.permission,
        ...(scope.resourceId === undefined ? {} : { resourceId: requireText(scope.resourceId, "resourceId", 512) }),
        actionDigest: requireDigest(scope.actionDigest, "actionDigest")
      };
    default:
      throw new Error("Unsupported approval scope");
  }
}

function requireText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(name + " must be a non-empty bounded string");
  }
  return value;
}

function requireDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(name + " must be a SHA-256 hex digest");
  }
  return value.toLowerCase();
}

function hashRef(approvalRef: string): string {
  return createHash("sha256").update(approvalRef, "utf8").digest("hex");
}
