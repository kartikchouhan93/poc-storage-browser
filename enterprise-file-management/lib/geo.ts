const PRIVATE_IP_RE =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3})$|^(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$|^(192\.168\.\d{1,3}\.\d{1,3})$|^(127\.\d{1,3}\.\d{1,3}\.\d{1,3})$|^(::1)$|^(fc|fd)/i;

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RE.test(ip.trim());
}

export async function resolveGeo(
  ip: string,
): Promise<{ country: string | null; region: string | null }> {
  const nullResult = { country: null, region: null };

  if (!ip || typeof ip !== "string") return nullResult;

  const trimmed = ip.trim();
  if (!trimmed) return nullResult;

  if (isPrivateIp(trimmed)) return nullResult;

  try {
    // Use ip-api.com for fresh, external geo-resolution
    // Note: This is an unauthenticated HTTP call; for high volume, a pro key or local DB is better.
    const response = await fetch(
      `http://ip-api.com/json/${trimmed}?fields=status,country,regionName`,
    );

    if (!response.ok) return nullResult;

    const data = (await response.json()) as any;
    if (data.status === "success") {
      return {
        country: data.country || null,
        region: data.regionName || null,
      };
    }
    return nullResult;
  } catch (err) {
    console.error(`[GeoResolver] Failed for IP ${trimmed}:`, err);
    return nullResult;
  }
}
