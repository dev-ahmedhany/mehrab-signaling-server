import crypto from 'crypto';
import { config } from '../config';

export interface TurnCredentials {
  username: string;
  credential: string;
  ttl: number;
  uris: string[];
}

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

export function generateTurnCredentials(userId: string): TurnCredentials {
  const ttl = config.turn.credentialTTL;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${userId}`;

  const hmac = crypto.createHmac('sha1', config.turn.secret);
  hmac.update(username);
  const credential = hmac.digest('base64');

  const domain = config.turn.domain;

  return {
    username,
    credential,
    ttl,
    uris: [
      `stun:${domain}:3478`,
      `turn:${domain}:3478?transport=udp`,
      `turn:${domain}:80?transport=tcp`,
      `turns:${domain}:443?transport=tcp`,
    ],
  };
}

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
 * Get ICE server config using both turn.ahmedhany.dev (faster) and Cloudflare (fallback).
 *
 * @param userId - User ID for credential generation
 * @returns ICE configuration with multiple TURN servers
 */
export async function getIceServerConfig(userId: string): Promise<IceServerConfig> {
  const turnCredentials = generateTurnCredentials(userId);
  const domain = config.turn.domain;

  // Start with STUN and our own TURN server (faster)
  const iceServers: IceServerConfig['iceServers'] = [
    // STUN for P2P discovery
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
    // Our own TURN server - prioritized first (faster connection)
    {
      urls: `turn:${domain}:80?transport=tcp`,
      username: turnCredentials.username,
      credential: turnCredentials.credential,
    },
    {
      urls: `turns:${domain}:443?transport=tcp`,
      username: turnCredentials.username,
      credential: turnCredentials.credential,
    },
  ];

  // Add Cloudflare as fallback
  const cloudflareServers = await getCloudflareIceServers();
  if (cloudflareServers) {
    iceServers.push(...cloudflareServers);
    console.log(`[TURN] Using ${domain} + Cloudflare for user ${userId}`);
  } else {
    console.log(`[TURN] Using ${domain} only for user ${userId}`);
  }

  return {
    iceServers,
  };
}
