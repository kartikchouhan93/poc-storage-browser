import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/token", () => ({ verifyToken: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

import { cookies } from "next/headers";
import { verifyToken } from "@/lib/token";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

const mockCookies = (values: Record<string, string | undefined>) => {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (values[name] ? { name, value: values[name]! } : undefined),
  } as any);
};

const makeUser = (id: string, tenantId: string, cognitoSub = "sub-123") => ({
  id,
  email: "user@example.com",
  tenantId,
  cognitoSub,
  role: "TEAMMATE",
  tenant: { id: tenantId, name: `Tenant ${tenantId}` },
  policies: [],
  teams: [],
});

beforeEach(() => vi.clearAllMocks());

// ─── Scenario 1: User with 2 tenant assignments ────────────────────────────

describe("user with 2 tenant assignments", () => {
  const userA = makeUser("uid-a", "tenant-a");
  const userB = makeUser("uid-b", "tenant-b");

  beforeEach(() => {
    mockCookies({ accessToken: "valid-token" });
    vi.mocked(verifyToken).mockResolvedValue({ email: "user@example.com", sub: "sub-123" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([userA, userB] as any);
  });

  it("returns tenant-a row when activeTenantId=tenant-a", async () => {
    const result = await getCurrentUser("tenant-a");
    expect((result as any).tenantId).toBe("tenant-a");
    expect((result as any).id).toBe("uid-a");
  });

  it("returns tenant-b row when activeTenantId=tenant-b", async () => {
    const result = await getCurrentUser("tenant-b");
    expect((result as any).tenantId).toBe("tenant-b");
    expect((result as any).id).toBe("uid-b");
  });

  it("falls back to first row when activeTenantId doesn't match", async () => {
    const result = await getCurrentUser("tenant-unknown");
    expect((result as any).tenantId).toBe("tenant-a");
  });

  it("reads activeTenantId from cookie when not passed as param", async () => {
    mockCookies({ accessToken: "valid-token", "x-active-tenant-id": "tenant-b" });
    const result = await getCurrentUser();
    expect((result as any).tenantId).toBe("tenant-b");
  });
});

// ─── Scenario 2: New user — auto-provisioned on first login ───────────────

describe("new user with tenantId in token (auto-provision)", () => {
  it("creates a new User row with TEAMMATE role and returns it", async () => {
    mockCookies({ accessToken: "valid-token" });
    vi.mocked(verifyToken).mockResolvedValue({
      email: "newuser@example.com",
      sub: "sub-new",
      "custom:tenantId": "tenant-x",
    });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: "tenant-x" } as any);
    const created = makeUser("uid-new", "tenant-x", "sub-new");
    vi.mocked(prisma.user.create).mockResolvedValue(created as any);

    const result = await getCurrentUser();

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "newuser@example.com",
          tenantId: "tenant-x",
          role: "TEAMMATE",
          hasLoggedIn: true,
        }),
      })
    );
    expect((result as any).id).toBe("uid-new");
    expect((result as any).tenantId).toBe("tenant-x");
  });
});

// ─── Scenario 3: Token without tenantId and 0 rows → null ─────────────────

describe("token without tenantId and 0 rows", () => {
  it("returns null — no session possible", async () => {
    mockCookies({ accessToken: "valid-token" });
    vi.mocked(verifyToken).mockResolvedValue({ email: "ghost@example.com", sub: "sub-ghost" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    const result = await getCurrentUser();
    expect(result).toBeNull();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
