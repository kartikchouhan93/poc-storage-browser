// Feature: user-multitenant-assignment, Property 18: Tenant access middleware blocks cross-tenant requests
// Feature: user-multitenant-assignment, Property 19: PLATFORM_ADMIN bypasses tenant check
// Validates: Requirements 11.1, 11.2, 11.3

import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { NextRequest, NextResponse } from "next/server";

// --- Mocks ---
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { withTenantAccess } from "@/lib/middleware/tenant-access";

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockLogAudit = logAudit as ReturnType<typeof vi.fn>;

// Arbitraries
const tenantIdArb = fc.uuid();
const roleArb = fc.constantFrom("TENANT_ADMIN", "TEAMMATE", "TEAM_ADMIN");
const emailArb = fc.emailAddress();

function makeRequest(tenantId?: string, method = "GET"): NextRequest {
  const url = tenantId
    ? `http://localhost/api/test?tenantId=${tenantId}`
    : "http://localhost/api/test";
  return new NextRequest(url, { method });
}

function makeUser(tenantId: string, role: string, email = "user@test.com") {
  return { id: "user-1", email, tenantId, role };
}

const okHandler = vi.fn(async () => NextResponse.json({ ok: true }));

beforeEach(() => {
  vi.clearAllMocks();
  okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
});

describe("Property 18: Tenant access middleware blocks cross-tenant requests", () => {
  it("allows request when tenantId matches user.tenantId", async () => {
    // **Validates: Requirements 11.1**
    await fc.assert(
      fc.asyncProperty(tenantIdArb, roleArb, emailArb, async (tenantId, role, email) => {
        mockGetCurrentUser.mockResolvedValue(makeUser(tenantId, role, email));
        const req = makeRequest(tenantId);
        const res = await withTenantAccess(req, okHandler);
        expect(res.status).toBe(200);
        expect(okHandler).toHaveBeenCalled();
        vi.clearAllMocks();
        okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
      }),
      { numRuns: 100 },
    );
  });

  it("rejects with 403 when tenantId does not match user.tenantId", async () => {
    // **Validates: Requirements 11.2, 11.6**
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        tenantIdArb,
        roleArb,
        emailArb,
        async (userTenantId, requestTenantId, role, email) => {
          // Only test when they differ
          fc.pre(userTenantId !== requestTenantId);

          mockGetCurrentUser.mockResolvedValue(makeUser(userTenantId, role, email));
          const req = makeRequest(requestTenantId);
          const res = await withTenantAccess(req, okHandler);

          expect(res.status).toBe(403);
          expect(okHandler).not.toHaveBeenCalled();
          // Audit log must be called on mismatch
          expect(mockLogAudit).toHaveBeenCalled();
          vi.clearAllMocks();
          okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns 401 when no user session exists", async () => {
    await fc.assert(
      fc.asyncProperty(tenantIdArb, async (tenantId) => {
        mockGetCurrentUser.mockResolvedValue(null);
        const req = makeRequest(tenantId);
        const res = await withTenantAccess(req, okHandler);
        expect(res.status).toBe(401);
        expect(okHandler).not.toHaveBeenCalled();
        vi.clearAllMocks();
        okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
      }),
      { numRuns: 100 },
    );
  });

  it("returns 400 when no tenantId is resolvable and allowSelfTenant is not set", async () => {
    await fc.assert(
      fc.asyncProperty(tenantIdArb, roleArb, async (tenantId, role) => {
        mockGetCurrentUser.mockResolvedValue(makeUser(tenantId, role));
        const req = makeRequest(); // no tenantId in request
        const res = await withTenantAccess(req, okHandler);
        expect(res.status).toBe(400);
        expect(okHandler).not.toHaveBeenCalled();
        vi.clearAllMocks();
        okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 19: PLATFORM_ADMIN bypasses tenant check", () => {
  it("allows PLATFORM_ADMIN regardless of tenantId in request", async () => {
    // **Validates: Requirements 11.3**
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        tenantIdArb,
        emailArb,
        async (userTenantId, requestTenantId, email) => {
          mockGetCurrentUser.mockResolvedValue(makeUser(userTenantId, "PLATFORM_ADMIN", email));
          // Even when tenantIds differ, PLATFORM_ADMIN must pass
          const req = makeRequest(requestTenantId);
          const res = await withTenantAccess(req, okHandler);
          expect(res.status).toBe(200);
          expect(okHandler).toHaveBeenCalled();
          // No audit log for PLATFORM_ADMIN
          expect(mockLogAudit).not.toHaveBeenCalled();
          vi.clearAllMocks();
          okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("allows PLATFORM_ADMIN even with no tenantId in request", async () => {
    await fc.assert(
      fc.asyncProperty(tenantIdArb, emailArb, async (userTenantId, email) => {
        mockGetCurrentUser.mockResolvedValue(makeUser(userTenantId, "PLATFORM_ADMIN", email));
        const req = makeRequest(); // no tenantId
        const res = await withTenantAccess(req, okHandler);
        expect(res.status).toBe(200);
        expect(okHandler).toHaveBeenCalled();
        vi.clearAllMocks();
        okHandler.mockResolvedValue(NextResponse.json({ ok: true }));
      }),
      { numRuns: 100 },
    );
  });
});
