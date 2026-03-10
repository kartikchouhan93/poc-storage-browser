import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: {
    tenant: { findUnique: vi.fn() },
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: { count: vi.fn() },
    resourcePolicy: { count: vi.fn() },
    teamMembership: { count: vi.fn() },
    botIdentity: { count: vi.fn() },
    share: { count: vi.fn() },
    bucket: { count: vi.fn() },
    fileObject: { count: vi.fn() },
    multipartUpload: { count: vi.fn() },
  },
}));

import { getCurrentUser } from "@/lib/session";
import prisma from "@/lib/prisma";
import { POST } from "@/app/api/admin/users/assign-tenant/route";
import { DELETE } from "@/app/api/admin/users/[userId]/route";
import { GET } from "@/app/api/admin/users/assignments/route";
import { Prisma } from "@/lib/generated/prisma/client";

const makeAdmin = () => ({ id: "admin-id", role: "PLATFORM_ADMIN", email: "admin@example.com" });
const makeTeammate = () => ({ id: "user-id", role: "TEAMMATE", email: "user@example.com" });

function makeRequest(method: string, body?: object, url = "http://localhost/api/admin/users/assign-tenant") {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : {},
  });
}

beforeEach(() => vi.clearAllMocks());

// ─── POST /api/admin/users/assign-tenant ───────────────────────────────────

describe("POST /api/admin/users/assign-tenant", () => {
  it("returns 403 when caller is not PLATFORM_ADMIN", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeTeammate() as any);
    const res = await POST(makeRequest("POST", { email: "a@b.com", tenantId: "t1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when email is missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    const res = await POST(makeRequest("POST", { tenantId: "t1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when tenantId is missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    const res = await POST(makeRequest("POST", { email: "a@b.com" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when tenant doesn't exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    const res = await POST(makeRequest("POST", { email: "a@b.com", tenantId: "no-such-tenant" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tenant/i);
  });

  it("returns 201 on success", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: "t1" } as any);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "new-user", email: "a@b.com", tenantId: "t1", role: "TEAMMATE" } as any);
    const res = await POST(makeRequest("POST", { email: "a@b.com", tenantId: "t1" }));
    expect(res.status).toBe(201);
  });

  it("returns 409 on P2002 duplicate assignment", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: "t1" } as any);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    vi.mocked(prisma.user.create).mockRejectedValue(p2002);
    const res = await POST(makeRequest("POST", { email: "a@b.com", tenantId: "t1" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already assigned/i);
  });
});

// ─── DELETE /api/admin/users/[userId] ─────────────────────────────────────

const makeDeleteRequest = (userId: string) =>
  new NextRequest(`http://localhost/api/admin/users/${userId}`, { method: "DELETE" });

const makeDeleteParams = (userId: string) => ({ params: Promise.resolve({ userId }) });

// Zero-out all FK counts
const zeroFKCounts = () => {
  vi.mocked(prisma.auditLog.count).mockResolvedValue(0);
  vi.mocked(prisma.resourcePolicy.count).mockResolvedValue(0);
  vi.mocked(prisma.teamMembership.count).mockResolvedValue(0);
  vi.mocked(prisma.botIdentity.count).mockResolvedValue(0);
  vi.mocked(prisma.share.count).mockResolvedValue(0);
  vi.mocked(prisma.bucket.count).mockResolvedValue(0);
  vi.mocked(prisma.fileObject.count).mockResolvedValue(0);
  vi.mocked(prisma.multipartUpload.count).mockResolvedValue(0);
};

describe("DELETE /api/admin/users/[userId]", () => {
  it("returns 403 when not PLATFORM_ADMIN", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeTeammate() as any);
    const res = await DELETE(makeDeleteRequest("uid1"), makeDeleteParams("uid1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when userId not found", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest("uid1"), makeDeleteParams("uid1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when it's the last assignment (siblingCount === 1)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "uid1", email: "a@b.com" } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    const res = await DELETE(makeDeleteRequest("uid1"), makeDeleteParams("uid1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/last/i);
  });

  it("returns 409 when FK references exist (auditLogs > 0)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "uid1", email: "a@b.com" } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(2);
    zeroFKCounts();
    vi.mocked(prisma.auditLog.count).mockResolvedValue(3);
    const res = await DELETE(makeDeleteRequest("uid1"), makeDeleteParams("uid1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/AuditLog/);
  });

  it("returns 200 on successful deletion", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "uid1", email: "a@b.com" } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(2);
    zeroFKCounts();
    vi.mocked(prisma.user.delete).mockResolvedValue({} as any);
    const res = await DELETE(makeDeleteRequest("uid1"), makeDeleteParams("uid1"));
    expect(res.status).toBe(200);
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "uid1" } });
  });
});

// ─── GET /api/admin/users/assignments ─────────────────────────────────────

describe("GET /api/admin/users/assignments", () => {
  it("returns 403 when not PLATFORM_ADMIN", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeTeammate() as any);
    const req = new NextRequest("http://localhost/api/admin/users/assignments?email=a@b.com");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when email param missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    const req = new NextRequest("http://localhost/api/admin/users/assignments");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns array of assignments on success", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(makeAdmin() as any);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "a@b.com", tenantId: "t1", role: "TEAMMATE", name: "Alice", isActive: true, tenant: { id: "t1", name: "Acme" } },
      { id: "u2", email: "a@b.com", tenantId: "t2", role: "TENANT_ADMIN", name: "Alice", isActive: true, tenant: { id: "t2", name: "Beta" } },
    ] as any);
    const req = new NextRequest("http://localhost/api/admin/users/assignments?email=a@b.com");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ userId: "u1", tenantId: "t1", tenantName: "Acme", role: "TEAMMATE" });
    expect(body[1]).toMatchObject({ userId: "u2", tenantId: "t2", tenantName: "Beta", role: "TENANT_ADMIN" });
  });
});
