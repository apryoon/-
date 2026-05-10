export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    const restKey = process.env.KAKAO_REST_KEY;
    
    if (!restKey) {
      console.warn('Kakao REST API key not configured');
      return res.status(200).json({ documents: [] });
    }

    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `KakaoAK ${restKey}`
      }
    });

    const data = await response.json();
    
    return res.status(200).json(data);

  } catch (error) {
    console.error('Kakao geocode error:', error);
    return res.status(200).json({ documents: [] });
  }
}
