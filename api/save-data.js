import Redis from 'ioredis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { password, data, mouUpdateDate = '' } = req.body || {};

  if (!password || !Array.isArray(data)) {
    return res.status(400).json({ success: false, error: 'Password and data required' });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
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
    const timestamp = new Date().toISOString();
    const payload = {
      data,
      rowCount: data.length,
      updatedAt: timestamp,
      mouUpdateDate: mouUpdateDate || '',
    };

    await redis.set('dashboard_data', JSON.stringify(payload));

    return res.status(200).json({
      success: true,
      rowCount: data.length,
      timestamp,
      mouUpdateDate,
    });
  } catch (error) {
    console.error('[save-data] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}
