import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { logAudit } from '@/lib/audit';

export interface TenantAccessOptions {
  /**
   * Custom extractor for tenantId. Called after query-string and body extraction.
   * Return null to fall through to the 400 response (or allowSelfTenant fallback).
   */
  extractTenantId?: (req: NextRequest) => string | null;
  /**
   * When true and no tenantId is found in the request, fall back to user.tenantId.
   * Use this for routes that self-scope by the authenticated user's tenant
   * (e.g. GET /api/buckets, GET /api/files).
   */
  allowSelfTenant?: boolean;
}

/**
 * Middleware wrapper that enforces tenant isolation on API routes.
 *
 * Resolution order for tenantId:
 *   1. Query string (?tenantId=xxx)
 *   2. Request body ({ tenantId: "xxx" }) — POST/PUT/PATCH only
 *   3. Custom extractor via options.extractTenantId
 *
 * Behaviour:
 *   - Unauthenticated → 401
 *   - PLATFORM_ADMIN → bypass, call handler
 *   - tenantId matches user.tenantId → call handler
 *   - tenantId mismatch → 403 + AuditLog security event
 *   - No tenantId resolvable → 400
 */
export async function withTenantAccess(
  req: NextRequest,
  handler: (req: NextRequest, user: any) => Promise<NextResponse>,
  options?: TenantAccessOptions,
): Promise<NextResponse> {
  // Resolve the active user (reads cookie / JWT)
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 11.3: PLATFORM_ADMIN bypasses tenant check entirely
  if (user.role === 'PLATFORM_ADMIN') {
    return handler(req, user);
  }

  const url = new URL(req.url);

  // 11.2: Extract tenantId — query string first
  let tenantId: string | null = url.searchParams.get('tenantId');

  // Then request body (POST / PUT / PATCH)
  if (!tenantId && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
    try {
      const cloned = req.clone();
      const body = await cloned.json().catch(() => null);
      if (body?.tenantId) tenantId = body.tenantId as string;
    } catch {
      // ignore parse errors
    }
  }

  // Finally, custom extractor
  if (!tenantId && options?.extractTenantId) {
    tenantId = options.extractTenantId(req);
  }

  // allowSelfTenant: fall back to user's own tenantId for self-scoped routes
  if (!tenantId && options?.allowSelfTenant) {
    tenantId = user.tenantId as string;
  }

  // 11.5: No tenantId resolvable → 400
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  // 11.4: Tenant mismatch → 403 + AuditLog security event
  if (tenantId !== user.tenantId) {
    logAudit({
      userId: user.id,
      action: 'IP_ACCESS_DENIED' as any, // reusing closest available action; cast needed
      resource: url.pathname,
      status: 'FAILED',
      details: {
        event: 'TENANT_ACCESS_DENIED',
        requestedTenantId: tenantId,
        userTenantId: user.tenantId,
        email: user.email,
        path: url.pathname,
      },
    });
    return NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 });
  }

  return handler(req, user);
}
