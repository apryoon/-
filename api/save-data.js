import { getRedisClient } from './redis-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password, data } = req.body;
    
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
    
    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!data) {
      return res.status(400).json({ error: 'Data required' });
    }

    const redis = getRedisClient();
    
    if (redis) {
      await redis.set('dashboard_data', JSON.stringify(data));
      console.log('Data saved to Redis');
    } else {
      console.warn('Redis not available, data not persisted');
    }
    
    const rowCount = Array.isArray(data) ? data.length : 0;
    
    return res.status(200).json({
      success: true,
      rowCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Save data error:', error);
    return res.status(500).json({ error: error.message });
  }
}
