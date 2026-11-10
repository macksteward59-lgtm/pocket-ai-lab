/**
 * Defensive posture review of an export an administrator already produced.
 *
 * This module parses JSON or CSV. It does not call Microsoft Graph, Azure
 * Resource Manager, or any other network API, and it does not run a scan.
 * Findings are recommendations. `authorized` is always false.
 */

const MAX_CHARS = 1_000_000;
const MAX_ITEMS = 500;
const CODE_LIKE = [/\bfunction\b[^.]*\(/i, /=>\s*{/, /<script/i, /\bexec\(/i, /\bpayload\s*=/i];
const FORMULA_PREFIX = /^[=+@-]/;

const HIGH_PRIVILEGE_APP_PERMISSIONS = new Set([
  "Directory.ReadWrite.All",
  "RoleManagement.ReadWrite.Directory",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "RoleAssignmentSchedule.ReadWrite.Directory"
]);

const PRIVILEGED_DIRECTORY_ROLES = new Set([
  "Global Administrator",
  "Privileged Role Administrator",
  "Privileged Authentication Administrator"
]);

const WIDE_ROLE_NAMES = new Set(["Owner", "User Access Administrator"]);
const SUBSCRIPTION_SCOPE = /^\/subscriptions\/[0-9a-fA-F-]{36}$/;

export class PostureExportError extends Error {}

export interface ApplicationRecord {
  id: string;
  displayName?: string;
  appPermissions: string[];
}

export interface DirectoryRoleRecord {
  id?: string;
  displayName: string;
  memberTypes: string[];
}

export interface StorageAccountRecord {
  id: string;
  name?: string;
  allowBlobPublicAccess?: boolean;
  supportsHttpsTrafficOnly?: boolean;
}

export interface RoleAssignmentRecord {
  id?: string;
  roleName: string;
  scope: string;
  principalType?: string;
}

export interface PostureExport {
  source: "graph" | "arm" | "mixed" | "csv";
  applications: ApplicationRecord[];
  directoryRoles: DirectoryRoleRecord[];
  storageAccounts: StorageAccountRecord[];
  roleAssignments: RoleAssignmentRecord[];
}

export interface PostureFinding {
  id: string;
  severity: "low" | "medium" | "high";
  resource: string;
  title: string;
  recommendation: string;
}

export interface PostureReport {
  findings: PostureFinding[];
  reviewed: {
    applications: number;
    directoryRoles: number;
    storageAccounts: number;
    roleAssignments: number;
  };
  /** Always false. A finding is not an authorization. */
  authorized: false;
}

export function reviewPostureText(input: string, format: "json" | "csv"): PostureReport {
  if (typeof input !== "string") throw new PostureExportError("Export must be text");
  if (input.length === 0) throw new PostureExportError("Export is empty");
  if (input.length > MAX_CHARS) throw new PostureExportError("Export exceeds the size limit");
  const document = format === "json" ? parseJsonExport(input) : parseCsvExport(input);
  return reviewPostureExport(document);
}

export function reviewPostureExport(document: PostureExport): PostureReport {
  const findings: PostureFinding[] = [];
  for (const app of document.applications) {
    for (const permission of app.appPermissions) {
      if (!HIGH_PRIVILEGE_APP_PERMISSIONS.has(permission)) continue;
      findings.push({
        id: "app-permission-" + app.id + "-" + permission,
        severity: "high",
        resource: app.displayName ? app.displayName + " (" + app.id + ")" : app.id,
        title: "Application holds a high-privilege Graph application permission",
        recommendation: "Remove " + permission + " unless a written admin requirement still needs it, and prefer a narrower read permission."
      });
    }
  }
  for (const role of document.directoryRoles) {
    if (!PRIVILEGED_DIRECTORY_ROLES.has(role.displayName)) continue;
    if (!role.memberTypes.some(kind => kind.toLowerCase() === "serviceprincipal")) continue;
    findings.push({
      id: "directory-role-" + (role.id ?? role.displayName),
      severity: "high",
      resource: role.displayName,
      title: "A service principal is a member of a privileged directory role",
      recommendation: "Remove the service principal from " + role.displayName + " and assign a narrower role to a user-administered identity."
    });
  }
  for (const account of document.storageAccounts) {
    const label = account.name ? account.name + " (" + account.id + ")" : account.id;
    if (account.allowBlobPublicAccess === true) {
      findings.push({
        id: "storage-public-" + account.id,
        severity: "high",
        resource: label,
        title: "Storage account allows public blob access",
        recommendation: "Set allowBlobPublicAccess to false unless this account is an intentional public website container."
      });
    }
    if (account.supportsHttpsTrafficOnly === false) {
      findings.push({
        id: "storage-https-" + account.id,
        severity: "medium",
        resource: label,
        title: "Storage account accepts non-HTTPS traffic",
        recommendation: "Set supportsHttpsTrafficOnly to true."
      });
    }
  }
  for (const assignment of document.roleAssignments) {
    if (!WIDE_ROLE_NAMES.has(assignment.roleName)) continue;
    if (!SUBSCRIPTION_SCOPE.test(assignment.scope)) continue;
    findings.push({
      id: "role-" + (assignment.id ?? assignment.scope + "-" + assignment.roleName),
      severity: "high",
      resource: assignment.roleName + " at " + assignment.scope,
      title: "Wide role is assigned at subscription scope",
      recommendation: "Replace " + assignment.roleName + " with a narrower role on the resource group or resource that needs it."
    });
  }
  return {
    findings,
    reviewed: {
      applications: document.applications.length,
      directoryRoles: document.directoryRoles.length,
      storageAccounts: document.storageAccounts.length,
      roleAssignments: document.roleAssignments.length
    },
    authorized: false
  };
}

export function renderPostureReport(report: PostureReport): string {
  const lines = ["# Posture review", "", "authorized: false", ""];
  if (report.findings.length === 0) {
    lines.push("No misconfigurations matched the static rules.");
  } else {
    lines.push("| Severity | Resource | Recommendation |");
    lines.push("|---|---|---|");
    for (const finding of report.findings) {
      lines.push("| " + finding.severity + " | " + finding.resource + " | " + finding.recommendation + " |");
    }
  }
  return lines.join("\n");
}

function parseJsonExport(input: string): PostureExport {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new PostureExportError("JSON export is not valid JSON");
  }
  if (!isRecord(value)) throw new PostureExportError("JSON export must be an object");
  rejectCode(JSON.stringify(value));
  const source = value.source;
  if (source !== "graph" && source !== "arm" && source !== "mixed") {
    throw new PostureExportError("JSON export source must be graph, arm, or mixed");
  }
  return {
    source,
    applications: arrayOf(value.applications, "applications").map(parseApplication),
    directoryRoles: arrayOf(value.directoryRoles, "directoryRoles").map(parseDirectoryRole),
    storageAccounts: arrayOf(value.storageAccounts, "storageAccounts").map(parseStorage),
    roleAssignments: arrayOf(value.roleAssignments, "roleAssignments").map(parseAssignment)
  };
}

function parseCsvExport(input: string): PostureExport {
  const rows = parseCsv(input);
  if (rows.length < 2) throw new PostureExportError("CSV export needs a header and one row");
  const header = rows[0].map(cell => cell.trim());
  const expected = ["recordType", "id", "name", "detail", "flag"];
  if (header.length !== expected.length || expected.some((name, index) => header[index] !== name)) {
    throw new PostureExportError("CSV header must be recordType,id,name,detail,flag");
  }
  const document: PostureExport = {
    source: "csv",
    applications: [],
    directoryRoles: [],
    storageAccounts: [],
    roleAssignments: []
  };
  const storage = new Map<string, StorageAccountRecord>();
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0] === "") continue;
    if (row.length !== 5) throw new PostureExportError("CSV row must have five columns");
    const [recordType, id, name, detail, flag] = row.map(cell => {
      const text = cell.trim();
      if (FORMULA_PREFIX.test(text)) throw new PostureExportError("CSV cell looks like a spreadsheet formula");
      rejectCode(text);
      return text;
    });
    if (!id) throw new PostureExportError("CSV id is required");
    if (recordType === "storage") {
      const account = storage.get(id) ?? { id, name: name || undefined };
      if (detail === "allowBlobPublicAccess") account.allowBlobPublicAccess = parseBool(flag);
      else if (detail === "supportsHttpsTrafficOnly") account.supportsHttpsTrafficOnly = parseBool(flag);
      else throw new PostureExportError("Unknown storage field: " + detail);
      storage.set(id, account);
    } else if (recordType === "application") {
      if (!detail) throw new PostureExportError("Application permission name is required");
      if (flag !== "present") throw new PostureExportError("Application flag must be present");
      const existing = document.applications.find(app => app.id === id);
      if (existing) existing.appPermissions.push(detail);
      else document.applications.push({ id, displayName: name || undefined, appPermissions: [detail] });
    } else if (recordType === "directoryRole") {
      if (!name) throw new PostureExportError("Directory role name is required");
      if (flag !== "member") throw new PostureExportError("Directory role flag must be member");
      document.directoryRoles.push({ id, displayName: name, memberTypes: [detail] });
    } else if (recordType === "roleAssignment") {
      if (!name || !detail) throw new PostureExportError("Role assignment needs a role name and a scope");
      if (flag !== "assignment") throw new PostureExportError("Role assignment flag must be assignment");
      document.roleAssignments.push({ id, roleName: name, scope: detail });
    } else {
      throw new PostureExportError("Unknown CSV recordType: " + recordType);
    }
  }
  document.storageAccounts = [...storage.values()];
  assertCounts(document);
  return document;
}

function parseApplication(value: unknown): ApplicationRecord {
  const record = recordOf(value, "application");
  const permissions = arrayOf(record.appPermissions, "appPermissions").map(item => {
    if (typeof item !== "string" || !item.trim()) throw new PostureExportError("Application permission must be text");
    return item.trim();
  });
  return { id: requiredId(record, "application"), displayName: optionalText(record.displayName), appPermissions: permissions };
}

function parseDirectoryRole(value: unknown): DirectoryRoleRecord {
  const record = recordOf(value, "directoryRole");
  const displayName = optionalText(record.displayName);
  if (!displayName) throw new PostureExportError("Directory role displayName is required");
  const memberTypes = arrayOf(record.memberTypes, "memberTypes").map(item => {
    if (typeof item !== "string" || !item.trim()) throw new PostureExportError("memberTypes entries must be text");
    return item.trim();
  });
  return { id: optionalText(record.id), displayName, memberTypes };
}

function parseStorage(value: unknown): StorageAccountRecord {
  const record = recordOf(value, "storageAccount");
  return {
    id: requiredId(record, "storageAccount"),
    name: optionalText(record.name),
    allowBlobPublicAccess: optionalBool(record.allowBlobPublicAccess, "allowBlobPublicAccess"),
    supportsHttpsTrafficOnly: optionalBool(record.supportsHttpsTrafficOnly, "supportsHttpsTrafficOnly")
  };
}

function parseAssignment(value: unknown): RoleAssignmentRecord {
  const record = recordOf(value, "roleAssignment");
  const roleName = optionalText(record.roleName);
  const scope = optionalText(record.scope);
  if (!roleName || !scope) throw new PostureExportError("Role assignment needs roleName and scope");
  return { id: optionalText(record.id), roleName, scope, principalType: optionalText(record.principalType) };
}

function arrayOf(value: unknown, name: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PostureExportError(name + " must be an array");
  if (value.length > MAX_ITEMS) throw new PostureExportError(name + " exceeds the item limit");
  return value;
}

function assertCounts(document: PostureExport): void {
  for (const [name, items] of Object.entries({
    applications: document.applications,
    directoryRoles: document.directoryRoles,
    storageAccounts: document.storageAccounts,
    roleAssignments: document.roleAssignments
  })) {
    if (items.length > MAX_ITEMS) throw new PostureExportError(name + " exceeds the item limit");
  }
}

function requiredId(record: Record<string, unknown>, name: string): string {
  const id = optionalText(record.id);
  if (!id) throw new PostureExportError(name + " id is required");
  return id;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new PostureExportError("Expected text");
  rejectCode(value);
  return value.trim();
}

function optionalBool(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new PostureExportError(name + " must be a boolean");
  return value;
}

function parseBool(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new PostureExportError("Boolean flag must be true or false");
}

function recordOf(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PostureExportError(name + " must be an object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectCode(text: string): void {
  if (CODE_LIKE.some(pattern => pattern.test(text))) {
    throw new PostureExportError("Export contains code-like text and was rejected");
  }
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === "\"") {
        if (input[i + 1] === "\"") {
          cell += "\"";
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (quoted) throw new PostureExportError("CSV has an unterminated quote");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
