import Redis from 'ioredis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // CDN 캐시 비활성화 — 캐시 초기화 후 즉시 반영되도록
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.REDIS_HOST) {
    return res.status(200).json({ cache: {} });
  }

  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 10000,
    commandTimeout: 15000,
    maxRetriesPerRequest: 3,
  });

  try {
    const stored = await redis.get('geo_cache');
    let cache = {};

    if (stored) {
      try {
        cache = JSON.parse(stored);
      } catch (e) {
        console.error('Cache JSON parse error:', e);
        cache = {};
      }
    }

    return res.status(200).json({ cache });
  } catch (error) {
    console.error('Load geocache error:', error);
    return res.status(200).json({ cache: {} });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}
