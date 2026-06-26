import { getRedisClient } from '../lib/redis-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const redis = getRedisClient();
    let data = null;
    
    if (redis) {
      const stored = await redis.get('dashboard_data');
      if (stored) {
        data = JSON.parse(stored);
        console.log('Data loaded from Redis');
      }
    } else {
      console.warn('Redis not available');
    }
    
    if (!data) {
      return res.status(200).json({ data: [] });
    }

    return res.status(200).json({ data });

  } catch (error) {
    console.error('Load data error:', error);
    return res.status(200).json({ data: [] });
  }
}
