export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.warn('Naver API credentials not configured');
      return res.status(200).json({ results: [] });
    }

    const encodedQuery = encodeURIComponent(query);
    const url = `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodedQuery}`;

    const response = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret
      }
    });

    const result = await response.json();

    const formatted = {
      results: (result.addresses || []).map(addr => ({
        name: addr.roadAddress || addr.jibunAddress || query,
        address: addr.roadAddress || addr.jibunAddress || '',
        lat: parseFloat(addr.y),
        lng: parseFloat(addr.x),
        category: 'naver'
      }))
    };

    return res.status(200).json(formatted);

  } catch (error) {
    console.error('Naver geocode error:', error);
    return res.status(200).json({ results: [] });
  }
}
