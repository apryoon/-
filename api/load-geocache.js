import { kv } from '@vercel/kv';

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
    const cache = await kv.get('geo_cache');
    
    if (!cache) {
      return res.status(200).json({ cache: {} });
    }

    return res.status(200).json({ cache });

  } catch (error) {
    console.error('Load geocache error:', error);
    return res.status(500).json({ error: error.message });
  }
}
