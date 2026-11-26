/**
 * Fail-closed delegation gate for specialist tool use.
 *
 * A specialist agent may ask to use a tool. This gate allows the request only
 * when an injected verifier accepts a voucher that covers exactly that agent,
 * task, tool, and scope. This module implements no cryptography, does not read
 * `packages/director` trust material, and does not set `authorized`. With no
 * verifier configured, every request is denied.
 *
 * `allowed` is this gate's own decision. It is not an APEX receipt.
 * This gate decides; it never executes anything.
 */

export interface DelegationVoucher {
  /** Unique id. Each voucher is single-use. */
  voucherId: string;
  agentId: string;
  taskId: string;
  tool: string;
  /** Reference to the approved scope record the voucher was issued against. */
  scopeRef: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface VoucherVerifier {
  verify(voucher: DelegationVoucher): boolean | Promise<boolean>;
}

export interface ToolUseRequest {
  agentId: string;
  taskId: string;
  tool: string;
  scopeRef: string;
}

export interface DelegationDecision {
  allowed: boolean;
  reason: string;
}

export interface DelegationAuditEntry {
  at: string;
  agentId: string;
  taskId: string;
  tool: string;
  scopeRef: string;
  voucherId?: string;
  allowed: boolean;
  reason: string;
}

export interface DelegationGateOptions {
  verifier?: VoucherVerifier;
  /** Injectable clock (ms since epoch) for deterministic tests. */
  now?: () => number;
  /** Longest voucher lifetime accepted. Default 15 minutes. */
  maxVoucherLifetimeMs?: number;
  /** Audit entries retained in memory. Default 1000. */
  maxAuditEntries?: number;
}

export class DelegationGate {
  private readonly verifier?: VoucherVerifier;
  private readonly now: () => number;
  private readonly maxLifetimeMs: number;
  private readonly maxAuditEntries: number;
  /** voucherId -> expiry (ms). Entries are pruned once expired, since an expired voucher is denied anyway. */
  private readonly consumed = new Map<string, number>();
  /** Voucher ids currently being evaluated; closes the race between check and consume. */
  private readonly inFlight = new Set<string>();
  private readonly audit: DelegationAuditEntry[] = [];

  constructor(options: DelegationGateOptions = {}) {
    this.verifier = options.verifier;
    this.now = options.now ?? (() => Date.now());
    this.maxLifetimeMs = options.maxVoucherLifetimeMs ?? 15 * 60 * 1000;
    this.maxAuditEntries = options.maxAuditEntries ?? 1000;
  }

  async authorize(request: ToolUseRequest, voucher?: DelegationVoucher): Promise<DelegationDecision> {
    this.pruneConsumed();
    const voucherId = voucher?.voucherId;
    // Reserve synchronously (before any await) so two concurrent requests
    // presenting the same voucher cannot both pass the single-use check.
    if (voucherId !== undefined && this.inFlight.has(voucherId)) {
      const decision = { allowed: false, reason: "Voucher already in use" };
      this.record(request, voucher, decision);
      return decision;
    }
    if (voucherId !== undefined) this.inFlight.add(voucherId);
    try {
      const decision = await this.evaluate(request, voucher);
      // A voucher is consumed only when it actually authorizes something.
      if (decision.allowed && voucher) this.consumed.set(voucher.voucherId, Date.parse(voucher.expiresAt));
      this.record(request, voucher, decision);
      return decision;
    } finally {
      if (voucherId !== undefined) this.inFlight.delete(voucherId);
    }
  }

  /** Records a denial decided outside the gate (e.g. an agent that is not on the task's team). */
  recordDenial(request: ToolUseRequest, reason: string): DelegationDecision {
    const decision = { allowed: false, reason };
    this.record(request, undefined, decision);
    return decision;
  }

  /** Copy of the audit trail, oldest first. */
  getAuditLog(): DelegationAuditEntry[] {
    return this.audit.map(entry => ({ ...entry }));
  }

  private async evaluate(request: ToolUseRequest, voucher?: DelegationVoucher): Promise<DelegationDecision> {
    const deny = (reason: string): DelegationDecision => ({ allowed: false, reason });

    if (!this.verifier) return deny("No voucher verifier configured (fail closed)");
    if (!request.agentId?.trim() || !request.taskId?.trim() || !request.tool?.trim() || !request.scopeRef?.trim()) {
      return deny("Request must name agent, task, tool, and scope");
    }
    if (!voucher) return deny("A signed delegation voucher is required");
    if (this.consumed.has(voucher.voucherId)) return deny("Voucher already used");

    let signatureValid = false;
    try {
      signatureValid = (await this.verifier.verify(voucher)) === true;
    } catch {
      return deny("Voucher verification failed");
    }
    if (!signatureValid) return deny("Voucher signature is not valid");

    if (voucher.agentId !== request.agentId) return deny("Voucher was issued for a different agent");
    if (voucher.taskId !== request.taskId) return deny("Voucher was issued for a different task");
    if (voucher.tool !== request.tool) return deny("Voucher does not cover this tool");
    if (voucher.scopeRef !== request.scopeRef) return deny("Voucher was issued for a different scope");

    const issued = Date.parse(voucher.issuedAt);
    const expires = Date.parse(voucher.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires)) return deny("Voucher timestamps are invalid");
    const now = this.now();
    if (issued > now) return deny("Voucher is not yet valid");
    if (expires <= now) return deny("Voucher has expired");
    if (expires - issued > this.maxLifetimeMs) return deny("Voucher lifetime exceeds the allowed maximum");

    return { allowed: true, reason: "Voucher verified for this agent, task, tool, and scope" };
  }

  private pruneConsumed(): void {
    const now = this.now();
    for (const [voucherId, expiresAt] of this.consumed) {
      if (expiresAt <= now) this.consumed.delete(voucherId);
    }
  }

  private record(request: ToolUseRequest, voucher: DelegationVoucher | undefined, decision: DelegationDecision): void {
    this.audit.push({
      at: new Date(this.now()).toISOString(),
      agentId: String(request.agentId ?? ""),
      taskId: String(request.taskId ?? ""),
      tool: String(request.tool ?? ""),
      scopeRef: String(request.scopeRef ?? ""),
      voucherId: voucher?.voucherId,
      allowed: decision.allowed,
      reason: decision.reason
    });
    if (this.audit.length > this.maxAuditEntries) {
      this.audit.splice(0, this.audit.length - this.maxAuditEntries);
    }
  }
}
