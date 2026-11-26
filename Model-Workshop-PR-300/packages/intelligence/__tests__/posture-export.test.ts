import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PostureExportError,
  renderPostureReport,
  reviewPostureText
} from "../security/posture/postureExport";
import {
  DisabledReadOnlyCloud,
  ReadOnlyCloudClient,
  ReadOnlyCloudError,
  allowlistedGetUrl
} from "../security/posture/readOnlyCloud";

const JSON_EXPORT = JSON.stringify({
  source: "mixed",
  applications: [
    { id: "app-1", displayName: "Billing sync", appPermissions: ["Directory.Read.All", "Directory.ReadWrite.All"] }
  ],
  directoryRoles: [
    { id: "role-1", displayName: "Global Administrator", memberTypes: ["user", "servicePrincipal"] }
  ],
  storageAccounts: [
    { id: "st-1", name: "logs", allowBlobPublicAccess: true, supportsHttpsTrafficOnly: false }
  ],
  roleAssignments: [
    { id: "ra-1", roleName: "Owner", scope: "/subscriptions/11111111-1111-1111-1111-111111111111" },
    { id: "ra-2", roleName: "Reader", scope: "/subscriptions/11111111-1111-1111-1111-111111111111" }
  ]
});

describe("static posture exports", () => {
  it("reports misconfigurations from JSON and marks the review unauthorized", () => {
    const report = reviewPostureText(JSON_EXPORT, "json");
    expect(report.authorized).toBe(false);
    expect(report.reviewed.applications).toBe(1);
    const titles = report.findings.map(finding => finding.title);
    expect(titles).toContain("Application holds a high-privilege Graph application permission");
    expect(titles).toContain("A service principal is a member of a privileged directory role");
    expect(titles).toContain("Storage account allows public blob access");
    expect(titles).toContain("Storage account accepts non-HTTPS traffic");
    expect(titles).toContain("Wide role is assigned at subscription scope");
    expect(titles.some(title => title.includes("Reader"))).toBe(false);
    expect(renderPostureReport(report)).toContain("authorized: false");
    expect(renderPostureReport(report)).not.toMatch(/exploit|payload|attack/i);
  });

  it("reads the same checks from a CSV export", () => {
    const csv = [
      "recordType,id,name,detail,flag",
      "application,app-1,Billing sync,Directory.ReadWrite.All,present",
      "directoryRole,role-1,Global Administrator,servicePrincipal,member",
      "storage,st-1,logs,allowBlobPublicAccess,true",
      "storage,st-1,logs,supportsHttpsTrafficOnly,false",
      "roleAssignment,ra-1,Owner,/subscriptions/11111111-1111-1111-1111-111111111111,assignment"
    ].join("\n");
    const report = reviewPostureText(csv, "csv");
    expect(report.findings).toHaveLength(5);
    expect(report.authorized).toBe(false);
  });

  it("rejects code-like text, spreadsheet formulas, and a bad header", () => {
    expect(() => reviewPostureText(JSON.stringify({
      source: "graph",
      applications: [{ id: "app-1", appPermissions: ["payload = 1"] }]
    }), "json")).toThrow(PostureExportError);
    expect(() => reviewPostureText("recordType,id,name,detail,flag\napplication,=cmd,Name,Directory.Read.All,present", "csv"))
      .toThrow(/formula/);
    expect(() => reviewPostureText("a,b\n1,2", "csv")).toThrow(/header/);
  });

  it("returns an empty finding list for a clean export", () => {
    const report = reviewPostureText(JSON.stringify({
      source: "arm",
      storageAccounts: [{ id: "st-1", allowBlobPublicAccess: false, supportsHttpsTrafficOnly: true }]
    }), "json");
    expect(report.findings).toEqual([]);
    expect(report.authorized).toBe(false);
  });
});

describe("read-only cloud client", () => {
  it("stays off and does not call fetch", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await expect(new DisabledReadOnlyCloud().get("/v1.0/organization")).rejects.toThrow(/static JSON or CSV/);
    expect(() => new ReadOnlyCloudClient({
      enabled: false as never,
      service: "graph",
      baseUrl: "https://graph.microsoft.com",
      fetchImpl
    })).toThrow(ReadOnlyCloudError);
    expect(called).toBe(false);
  });

  it("issues a single GET for an allowlisted Graph path", async () => {
    let seenMethod = "";
    let seenUrl = "";
    const client = new ReadOnlyCloudClient({
      enabled: true,
      service: "graph",
      baseUrl: "https://graph.microsoft.com",
      accessToken: "host-token",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seenMethod = init?.method ?? "";
        seenUrl = String(url);
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer host-token");
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }) as typeof fetch
    });
    await client.get("/v1.0/organization?$select=id&$top=10");
    expect(seenMethod).toBe("GET");
    expect(seenUrl).toBe("https://graph.microsoft.com/v1.0/organization?$select=id&$top=10");
    expect("post" in client).toBe(false);
  });

  it("rejects writes, filters, and non-audit paths before any request", () => {
    const base = "https://graph.microsoft.com";
    expect(() => allowlistedGetUrl("graph", base, "/v1.0/users/1/resetPassword")).toThrow(/read-only/);
    expect(() => allowlistedGetUrl("graph", base, "/v1.0/organization?$filter=name")).toThrow(/\$select and \$top/);
    expect(() => allowlistedGetUrl("graph", base, "/v1.0/organization?$top=500")).toThrow(/\$top/);
    expect(() => allowlistedGetUrl("arm", "https://management.azure.com", "/subscriptions/11111111-1111-1111-1111-111111111111/providers/Microsoft.Compute/virtualMachines/vm/runCommand")).toThrow(/read-only|allowlist/);
    expect(allowlistedGetUrl("arm", "https://management.azure.com", "/subscriptions/11111111-1111-1111-1111-111111111111/providers/Microsoft.Storage/storageAccounts")).toContain("storageAccounts");
  });

  it("is not referenced by the consumer web server", () => {
    const server = readFileSync(path.join(process.cwd(), "apps/web/server.mjs"), "utf8");
    expect(server).not.toContain("ReadOnlyCloudClient");
    expect(server).not.toContain("reviewPostureText");
    expect(server).not.toContain("graph.microsoft.com");
  });
});
