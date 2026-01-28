export interface IceServerConfig {
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  iceTransportPolicy?: 'all' | 'relay';
}

// Cache for Cloudflare ICE servers (valid for 3 hours)
let cloudflareCache: { servers: IceServerConfig['iceServers']; expiresAt: number } | null = null;

/**
 * Fetch Cloudflare ICE servers.
 */
async function getCloudflareIceServers(): Promise<IceServerConfig['iceServers'] | null> {
  const now = Date.now();

  // Check cache first
  if (cloudflareCache && cloudflareCache.expiresAt > now) {
    console.log('[TURN] Using cached Cloudflare ICE servers');
    return cloudflareCache.servers;
  }

  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const turnKey = process.env.CLOUDFLARE_TURN_KEY;

  if (!apiToken || !turnKey) {
    console.warn('[TURN] Cloudflare credentials not configured, skipping');
    return null;
  }

  try {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKey}/credentials/generate-ice-servers`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }),
    });

    if (!response.ok) {
      console.warn(`[TURN] Cloudflare fetch failed: ${response.statusText}`);
      return null;
    }

    const data = await response.json() as { iceServers: IceServerConfig['iceServers'] };

    // Cache the result for 3 hours
    cloudflareCache = { servers: data.iceServers, expiresAt: now + 10800 * 1000 };
    console.log('[TURN] Fetched and cached new Cloudflare ICE servers');

    return data.iceServers;
  } catch (error) {
    console.warn('[TURN] Cloudflare fetch error:', error);
    return null;
  }
}

/**
 * Get ICE server config using Cloudflare TURN servers only.
 *
 * @param userId - User ID for credential generation
 * @returns ICE configuration with STUN and Cloudflare TURN servers
 */
export async function getIceServerConfig(userId: string): Promise<IceServerConfig> {
  // Start with STUN for P2P discovery
  const iceServers: IceServerConfig['iceServers'] = [
    // STUN for P2P discovery
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
  ];

  // Add Cloudflare TURN servers
  const cloudflareServers = await getCloudflareIceServers();
  if (cloudflareServers) {
    iceServers.push(...cloudflareServers);
    console.log(`[TURN] Using Cloudflare TURN servers for user ${userId}`);
  } else {
    console.log(`[TURN] No Cloudflare TURN servers available for user ${userId}`);
  }

  return {
    iceServers,
  };
}
