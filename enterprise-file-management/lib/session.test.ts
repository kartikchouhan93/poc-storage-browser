import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/token", () => ({
  verifyToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

import { cookies } from "next/headers";
import { verifyToken } from "@/lib/token";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";

// Helpers
const mockCookies = (values: Record<string, string | undefined>) => {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      values[name] ? { name, value: values[name]! } : undefined,
  } as any);
};

const basePayload = {
  email: "user@example.com",
  sub: "cognito-sub-123",
};

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "user-id-1",
  email: "user@example.com",
  tenantId: "tenant-a",
  cognitoSub: "cognito-sub-123",
  role: "TEAMMATE",
  tenant: { id: "tenant-a", name: "Acme" },
  policies: [],
  teams: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --- No token ---
describe("no accessToken cookie", () => {
  it("returns null", async () => {
    mockCookies({});
    expect(await getCurrentUser()).toBeNull();
  });
});

// --- Token verification fails ---
describe("token verification fails", () => {
  it("returns null", async () => {
    mockCookies({ accessToken: "bad-token" });
    vi.mocked(verifyToken).mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });
});

// --- 0 rows ---
describe("0 User rows", () => {
  it("returns null when no tenantId in token", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue({ email: "user@example.com", sub: "sub" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    expect(await getCurrentUser()).toBeNull();
  });

  it("returns null when tenantId in token but tenant doesn't exist", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue({
      email: "user@example.com",
      sub: "sub",
      "custom:tenantId": "tenant-x",
    });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("auto-provisions user when tenantId in token and tenant exists", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue({
      email: "user@example.com",
      sub: "sub-new",
      "custom:tenantId": "tenant-a",
    });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: "tenant-a" } as any);
    const created = makeUser({ cognitoSub: "sub-new" });
    vi.mocked(prisma.user.create).mockResolvedValue(created as any);

    const result = await getCurrentUser();
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "user@example.com",
          tenantId: "tenant-a",
          role: "TEAMMATE",
          hasLoggedIn: true,
        }),
      })
    );
    // cognitoSub already matches — no update needed
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result).toEqual(created);
  });
});

// --- 1 row ---
describe("1 User row", () => {
  it("returns the single row regardless of activeTenantId param", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue(basePayload);
    const user = makeUser();
    vi.mocked(prisma.user.findMany).mockResolvedValue([user] as any);

    const result = await getCurrentUser("tenant-z");
    expect(result).toEqual(user);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("syncs cognitoSub when it differs from token sub", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue({ email: "user@example.com", sub: "new-sub" });
    const user = makeUser({ cognitoSub: "old-sub" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([user] as any);
    const updated = makeUser({ cognitoSub: "new-sub" });
    vi.mocked(prisma.user.update).mockResolvedValue(updated as any);

    const result = await getCurrentUser();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-id-1" },
        data: { cognitoSub: "new-sub" },
      })
    );
    expect(result).toEqual(updated);
  });
});

// --- N rows ---
describe("N User rows", () => {
  const userA = makeUser({ id: "user-id-1", tenantId: "tenant-a" });
  const userB = makeUser({ id: "user-id-2", tenantId: "tenant-b" });

  it("selects row matching activeTenantId param", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue(basePayload);
    vi.mocked(prisma.user.findMany).mockResolvedValue([userA, userB] as any);

    const result = await getCurrentUser("tenant-b");
    expect((result as any).tenantId).toBe("tenant-b");
  });

  it("falls back to first row when activeTenantId param doesn't match", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue(basePayload);
    vi.mocked(prisma.user.findMany).mockResolvedValue([userA, userB] as any);

    const result = await getCurrentUser("tenant-z");
    expect((result as any).tenantId).toBe("tenant-a");
  });

  it("reads activeTenantId from x-active-tenant-id cookie when param not provided", async () => {
    mockCookies({ accessToken: "tok", "x-active-tenant-id": "tenant-b" });
    vi.mocked(verifyToken).mockResolvedValue(basePayload);
    vi.mocked(prisma.user.findMany).mockResolvedValue([userA, userB] as any);

    const result = await getCurrentUser();
    expect((result as any).tenantId).toBe("tenant-b");
  });

  it("param takes precedence over cookie", async () => {
    mockCookies({ accessToken: "tok", "x-active-tenant-id": "tenant-b" });
    vi.mocked(verifyToken).mockResolvedValue(basePayload);
    vi.mocked(prisma.user.findMany).mockResolvedValue([userA, userB] as any);

    const result = await getCurrentUser("tenant-a");
    expect((result as any).tenantId).toBe("tenant-a");
  });

  it("falls back to first row when no activeTenantId anywhere", async () => {
    mockCookies({ accessToken: "tok" });
    vi.mocked(verifyToken).mockResolvedValue(basePayload);
    vi.mocked(prisma.user.findMany).mockResolvedValue([userA, userB] as any);

    const result = await getCurrentUser();
    expect((result as any).tenantId).toBe("tenant-a");
  });
});
