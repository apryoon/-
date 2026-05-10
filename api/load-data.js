import { kv } from '@vercel/kv';

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
    const data = await kv.get('dashboard_data');
    
    if (!data) {
      return res.status(404).json({ error: 'No data found' });
    }

    return res.status(200).json({ data });

  } catch (error) {
    console.error('Load data error:', error);
    return res.status(500).json({ error: error.message });
  }
}
