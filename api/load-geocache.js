import { getRedisClient } from './redis-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const redis = getRedisClient();
    let cache = null;
    
    if (redis) {
      const stored = await redis.get('geo_cache');
      if (stored) {
        cache = JSON.parse(stored);
        console.log('Geocache loaded from Redis');
      }
    } else {
      console.warn('Redis not available');
    }
    
    if (!cache) {
      return res.status(200).json({ cache: {} });
    }

    return res.status(200).json({ cache });

  } catch (error) {
    console.error('Load geocache error:', error);
    return res.status(200).json({ cache: {} });
  }
}
