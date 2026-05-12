import Redis from 'ioredis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password, data } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';

  if (password !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  if (!process.env.REDIS_HOST) {
    return res.status(500).json({ error: 'Redis not configured' });
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
    await redis.set('dashboard_data', JSON.stringify(data));
    console.log('Data saved to Redis, rowCount:', data.length);

    return res.status(200).json({
      success: true,
      rowCount: data.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Save data error:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}
