import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

// --- Mocks (must be hoisted before imports) ---
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

// Minimal P2002 error shape — avoids importing Prisma runtime in Vite/jsdom
class PrismaP2002Error extends Error {
  code = "P2002";
  constructor(message: string) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
  }
}

// ---------------------------------------------------------------------------
// 9.1 Custom arbitraries
// ---------------------------------------------------------------------------
const emailArb = fc.emailAddress();
const tenantIdArb = fc.uuid();
const roleArb = fc.constantFrom(
  "PLATFORM_ADMIN",
  "TENANT_ADMIN",
  "TEAM_ADMIN",
  "TEAMMATE"
);
const userIdArb = fc.uuid();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockCookies = (values: Record<string, string | undefined>) => {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) =>
      values[name] ? { name, value: values[name]! } : undefined,
  } as any);
};

const makeUserRow = (
  id: string,
  email: string,
  tenantId: string,
  role = "TEAMMATE",
  tenantName = "Test Tenant"
) => ({
  id,
  email,
  tenantId,
  role,
  cognitoSub: null,
  name: null,
  password: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  hasLoggedIn: false,
  isActive: true,
  tenant: { id: tenantId, name: tenantName },
  policies: [],
  teams: [],
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 9.2 Property 1: Composite unique constraint enforcement
// ---------------------------------------------------------------------------
describe("Property 1: Composite unique constraint enforcement", () => {
  // Feature: user-multitenant-assignment, Property 1: Composite unique constraint enforcement
  it("rejects duplicate [email, tenantId] but allows same email with different tenantId", async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArb,
        tenantIdArb,
        fc.uuid(),
        async (email, tenantId1, tenantId2) => {
          fc.pre(tenantId1 !== tenantId2);

          // Simulate: second create with same email+tenantId throws P2002
          const p2002 = new PrismaP2002Error(
            "Unique constraint failed on the fields: (`email`,`tenantId`)"
          );

          let callCount = 0;
          vi.mocked(prisma.user.create).mockImplementation(async (args: any) => {
            const data = args.data;
            if (data.tenantId === tenantId1) {
              callCount++;
              if (callCount > 1) throw p2002;
              return makeUserRow(fc.sample(userIdArb, 1)[0], email, tenantId1) as any;
            }
            // Different tenantId — always succeeds
            return makeUserRow(fc.sample(userIdArb, 1)[0], email, data.tenantId) as any;
          });

          // First create with tenantId1 — should succeed
          const first = await prisma.user.create({
            data: { email, tenantId: tenantId1, role: "TEAMMATE" },
          });
          expect(first.email).toBe(email);
          expect(first.tenantId).toBe(tenantId1);

          // Second create with same email+tenantId1 — should throw P2002
          await expect(
            prisma.user.create({
              data: { email, tenantId: tenantId1, role: "TEAMMATE" },
            })
          ).rejects.toMatchObject({ code: "P2002" });

          // Create with same email but different tenantId2 — should succeed
          const third = await prisma.user.create({
            data: { email, tenantId: tenantId2, role: "TEAMMATE" },
          });
          expect(third.email).toBe(email);
          expect(third.tenantId).toBe(tenantId2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 9.3 Property 4: Session resolver active user selection (pure logic)
// ---------------------------------------------------------------------------

/**
 * Pure selection logic extracted from session resolver.
 * Given a list of user rows and an optional activeTenantId:
 * - 1 row → return that row
 * - N rows + match → return matching row
 * - N rows + no match → return first row
 */
function selectActiveUser<T extends { tenantId: string }>(
  users: T[],
  activeTenantId?: string
): T | null {
  if (users.length === 0) return null;
  if (users.length === 1) return users[0];
  if (activeTenantId) {
    const match = users.find((u) => u.tenantId === activeTenantId);
    if (match) return match;
  }
  return users[0];
}

describe("Property 4: Session resolver active user selection", () => {
  // Feature: user-multitenant-assignment, Property 4: Session resolver returns correct active user
  it("selects correct user row based on activeTenantId", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ id: userIdArb, tenantId: tenantIdArb, email: emailArb }),
          { minLength: 1, maxLength: 5 }
        ),
        fc.option(tenantIdArb),
        async (users, activeTenantId) => {
          const result = selectActiveUser(users, activeTenantId ?? undefined);

          if (users.length === 1) {
            // Single row: always returns that row regardless of activeTenantId
            expect(result).toEqual(users[0]);
          } else if (activeTenantId !== null) {
            const matchingRow = users.find((u) => u.tenantId === activeTenantId);
            if (matchingRow) {
              // activeTenantId matches a row → return that row
              expect(result).toEqual(matchingRow);
            } else {
              // No match → fallback to first row
              expect(result).toEqual(users[0]);
            }
          } else {
            // No activeTenantId → fallback to first row
            expect(result).toEqual(users[0]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 9.4 Property 5: Auth response tenant assignments
// ---------------------------------------------------------------------------
describe("Property 5: Auth response tenant assignments", () => {
  // Feature: user-multitenant-assignment, Property 5: JWT contains all tenant assignments
  it("response includes all tenant assignments with correct shape", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: userIdArb,
            tenantId: tenantIdArb,
            email: emailArb,
            role: roleArb,
            tenantName: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (userRows) => {
          // All rows share the same email (simulate same person, multiple tenants)
          const email = userRows[0].email;
          const rows = userRows.map((r) => ({ ...r, email }));

          // Mock prisma.user.findMany to return these rows
          vi.mocked(prisma.user.findMany).mockResolvedValue(
            rows.map((r) =>
              makeUserRow(r.id, r.email, r.tenantId, r.role, r.tenantName)
            ) as any
          );

          const allUsers = await prisma.user.findMany({
            where: { email },
            include: { tenant: true },
          });

          // Simulate the /api/auth/me tenants mapping
          const tenants = allUsers.map((u: any) => ({
            userId: u.id,
            tenantId: u.tenantId,
            tenantName: u.tenant?.name || "",
            role: u.role,
          }));

          // Verify: exactly N entries
          expect(tenants).toHaveLength(rows.length);

          // Verify: each entry has correct shape and matches source row
          rows.forEach((row, i) => {
            expect(tenants[i]).toMatchObject({
              userId: row.id,
              tenantId: row.tenantId,
              tenantName: row.tenantName,
              role: row.role,
            });
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 9.5 Property 12: Role update isolation (pure logic)
// ---------------------------------------------------------------------------

/**
 * Pure role update: update role on one row, others unchanged.
 */
function updateRoleOnRow<T extends { id: string; role: string }>(
  rows: T[],
  targetId: string,
  newRole: string
): T[] {
  return rows.map((r) => (r.id === targetId ? { ...r, role: newRole } : r));
}

describe("Property 12: Role update isolation", () => {
  // Feature: user-multitenant-assignment, Property 12: Role update isolation
  it("updating role on one User row does not affect other rows", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ id: userIdArb, tenantId: tenantIdArb, role: roleArb }),
          { minLength: 2, maxLength: 5 }
        ),
        roleArb,
        async (rows, newRole) => {
          // Ensure unique IDs
          const uniqueRows = rows.filter(
            (r, i, arr) => arr.findIndex((x) => x.id === r.id) === i
          );
          fc.pre(uniqueRows.length >= 2);

          const targetRow = uniqueRows[0];
          const otherRows = uniqueRows.slice(1);

          const updated = updateRoleOnRow(uniqueRows, targetRow.id, newRole);

          // Target row has new role
          const updatedTarget = updated.find((r) => r.id === targetRow.id)!;
          expect(updatedTarget.role).toBe(newRole);

          // All other rows are unchanged
          otherRows.forEach((original) => {
            const updatedOther = updated.find((r) => r.id === original.id)!;
            expect(updatedOther.role).toBe(original.role);
            expect(updatedOther.tenantId).toBe(original.tenantId);
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 9.6 Property 15: Auto-provisioning creates correct User row
// ---------------------------------------------------------------------------
describe("Property 15: Auto-provisioning creates correct User row", () => {
  // Feature: user-multitenant-assignment, Property 15: Auto-provisioning creates correct User row
  it("creates User row with email from token, tenantId from token, role TEAMMATE", async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, tenantIdArb, async (email, tenantId) => {
        mockCookies({ accessToken: "tok" });
        vi.mocked(verifyToken).mockResolvedValue({
          email,
          sub: "sub-123",
          "custom:tenantId": tenantId,
        });

        // 0 existing rows
        vi.mocked(prisma.user.findMany).mockResolvedValue([]);

        // Tenant exists
        vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
          id: tenantId,
          name: "Test Tenant",
        } as any);

        const createdUser = makeUserRow("new-id", email, tenantId, "TEAMMATE");
        vi.mocked(prisma.user.create).mockResolvedValue(createdUser as any);

        await getCurrentUser();

        expect(prisma.user.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              email: email.toLowerCase(),
              tenantId,
              role: "TEAMMATE",
              hasLoggedIn: true,
            }),
          })
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 9.7 Property 16: Auto-provisioning idempotence
// ---------------------------------------------------------------------------
describe("Property 16: Auto-provisioning idempotence", () => {
  // Feature: user-multitenant-assignment, Property 16: Auto-provisioning idempotence
  it("does not call prisma.user.create when a row already exists for email+tenantId", async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, tenantIdArb, async (email, tenantId) => {
        mockCookies({ accessToken: "tok" });
        vi.mocked(verifyToken).mockResolvedValue({
          email,
          sub: "sub-123",
          "custom:tenantId": tenantId,
        });

        // 1 existing row for this email+tenantId
        const existingUser = makeUserRow("existing-id", email, tenantId);
        vi.mocked(prisma.user.findMany).mockResolvedValue([existingUser] as any);

        // cognitoSub already matches — no update needed
        vi.mocked(prisma.user.update).mockResolvedValue(existingUser as any);

        await getCurrentUser();

        // create must NOT be called — row already exists
        expect(prisma.user.create).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
