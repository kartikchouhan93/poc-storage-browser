import prisma from "@/lib/prisma";

export type AuditAction =
  | "FILE_UPLOAD"
  | "FILE_UPLOAD_INITIATED"
  | "FILE_DOWNLOAD"
  | "FILE_READ"
  | "FILE_DELETE"
  | "FILE_SHARED"
  | "FOLDER_CREATE"
  | "MULTIPART_UPLOAD_INITIATED"
  | "TEAM_CREATED"
  | "TEAM_UPDATED"
  | "TEAM_DELETED"
  | "TEAM_MEMBER_ADDED"
  | "TEAM_MEMBER_REMOVED"
  | "PERMISSION_ADDED"
  | "PERMISSION_REMOVED"
  | "LOGIN"
  | "LOGOUT";

export type AuditStatus = "SUCCESS" | "FAILED";

export interface AuditParams {
  userId: string;
  action: AuditAction;
  resource: string;       // e.g. "FileObject", "Team", "ResourcePolicy"
  resourceId?: string;    // the actual record id (optional)
  details?: Record<string, unknown>;
  status: AuditStatus;
}

/**
 * Fire-and-forget audit log writer.
 * Call this WITHOUT await so it never blocks the HTTP response.
 *
 * Example:
 *   void logAudit({ userId, action: "FILE_UPLOAD", resource: "FileObject", details: { name, key }, status: "SUCCESS" });
 */
export function logAudit(params: AuditParams): void {
  const { userId, action, resource, resourceId, details, status } = params;

  // Run asynchronously in the background — never blocks the caller
  prisma.auditLog
    .create({
      data: {
        userId,
        action,
        resource: resourceId ? `${resource}:${resourceId}` : resource,
        details: details ? JSON.stringify(details) : null,
        status,
        createdBy: userId,
        updatedBy: userId,
      },
    })
    .catch((err) => {
      // Silent fail — audit must never crash the main request
      console.error("[audit] Failed to write audit log:", err);
    });
}
