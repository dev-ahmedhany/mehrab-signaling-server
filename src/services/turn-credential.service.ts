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
}

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

export function getIceServerConfig(userId: string): IceServerConfig {
  const turnCredentials = generateTurnCredentials(userId);
  const domain = config.turn.domain;

  return {
    iceServers: [
      {
        urls:'stun:stun.l.google.com:19302',
      },
      {
        urls: `turn:${domain}:3478?transport=udp`,
        username: turnCredentials.username,
        credential: turnCredentials.credential,
      },
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
    ],
  };
}
