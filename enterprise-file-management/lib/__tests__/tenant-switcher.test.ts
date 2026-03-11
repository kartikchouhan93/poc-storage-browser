import { describe, it, expect } from "vitest";

// Pure logic extracted from TenantSwitcher component
// Component returns null when tenants.length <= 1 (see components/tenant-switcher.tsx)

function shouldShowSwitcher(tenants: any[]): boolean {
  return tenants.length > 1;
}

function getActiveTenantName(
  tenants: { tenantId: string; tenantName: string }[],
  activeTenantId: string | null
): string | undefined {
  return tenants.find((t) => t.tenantId === activeTenantId)?.tenantName;
}

describe("shouldShowSwitcher", () => {
  it("returns false for 0 tenants", () => expect(shouldShowSwitcher([])).toBe(false));
  it("returns false for 1 tenant", () => expect(shouldShowSwitcher([{ tenantId: "t1" }])).toBe(false));
  it("returns true for 2 tenants", () => expect(shouldShowSwitcher([{ tenantId: "t1" }, { tenantId: "t2" }])).toBe(true));
  it("returns true for 5 tenants", () =>
    expect(shouldShowSwitcher([1, 2, 3, 4, 5].map((i) => ({ tenantId: `t${i}` })))).toBe(true));
});

describe("getActiveTenantName", () => {
  const tenants = [
    { tenantId: "t1", tenantName: "Acme" },
    { tenantId: "t2", tenantName: "Beta Inc" },
  ];

  it("returns the name of the active tenant", () =>
    expect(getActiveTenantName(tenants, "t1")).toBe("Acme"));

  it("returns the correct name when second tenant is active", () =>
    expect(getActiveTenantName(tenants, "t2")).toBe("Beta Inc"));

  it("returns undefined when activeTenantId doesn't match any tenant", () =>
    expect(getActiveTenantName(tenants, "t-unknown")).toBeUndefined());

  it("returns undefined when activeTenantId is null", () =>
    expect(getActiveTenantName(tenants, null)).toBeUndefined());
});
