import { NextRequest } from "next/server";

export function extractIpFromRequest(request: NextRequest): string {
  // Get IP from headers (x-forwarded-for, x-real-ip) or fallback
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  // Next.js standard ip property
  const reqAsAny = request as any;
  if (reqAsAny.ip) {
    return reqAsAny.ip;
  }

  return "127.0.0.1"; // Default fallback
}

export function ipToLong(ip: string): number {
  // Return 0 if invalid IP to prevent errors
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return 0;
  return (
    ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  );
}

export function isIpWhitelisted(
  ip: string,
  allowedIpsString: string | null | undefined,
): boolean {
  if (!allowedIpsString || allowedIpsString.trim() === "") {
    return true; // No whitelist defined means allowed
  }

  const allowedIps = allowedIpsString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const targetIpLong = ipToLong(ip);

  for (const block of allowedIps) {
    if (block.includes("/")) {
      const [rangeIp, prefixLengthStr] = block.split("/");
      const prefixLength = parseInt(prefixLengthStr, 10);

      const rangeIpLong = ipToLong(rangeIp);
      const mask = ~((1 << (32 - prefixLength)) - 1) >>> 0;

      if ((targetIpLong & mask) === (rangeIpLong & mask)) {
        return true;
      }
    } else {
      if (ip === block) {
        return true;
      }
    }
  }

  return false;
}

export function validateUserIpAccess(ip: string, user: any): boolean {
  if (user.role === "PLATFORM_ADMIN" || user.role === "TENANT_ADMIN") {
    // Admins are exempt from team-level IP restrictions
    return true;
  }

  // For teammates, check their teams
  if (user.role === "TEAMMATE" && user.teams) {
    const teamsWithWhitelists = user.teams.filter(
      (t: any) =>
        t.team && t.team.allowedIps && t.team.allowedIps.trim() !== "",
    );

    // If none of their teams have an IP whitelist, allow access
    if (teamsWithWhitelists.length === 0) {
      return true;
    }

    // If they have teams with whitelists, they must match AT LEAST ONE team's whitelist
    // to access the platform.
    for (const membership of teamsWithWhitelists) {
      if (isIpWhitelisted(ip, membership.team.allowedIps)) {
        return true;
      }
    }

    // If we get here, they failed all whitelists for the teams that have them
    return false;
  }

  return true;
}
