import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },

  turn: {
    secret: process.env.TURN_SECRET || '',
    domain: process.env.TURN_DOMAIN || 'turn.ahmedhany.dev',
    credentialTTL: parseInt(process.env.TURN_CREDENTIAL_TTL || '3600', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },

  livekit: {
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
    host: process.env.LIVEKIT_HOST || '',
    r2: {
      accessKey: process.env.LIVEKIT_R2_ACCESS_KEY || '',
      secretKey: process.env.LIVEKIT_R2_SECRET_KEY || '',
      bucket: process.env.LIVEKIT_R2_BUCKET || '',
      endpoint: process.env.LIVEKIT_R2_ENDPOINT || '',
    },
  },
};

export function validateConfig(): void {
  const requiredEnvVars = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'TURN_SECRET',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_HOST',
    'LIVEKIT_R2_ACCESS_KEY',
    'LIVEKIT_R2_SECRET_KEY',
    'LIVEKIT_R2_BUCKET',
    'LIVEKIT_R2_ENDPOINT',
  ];

  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
  }
}
