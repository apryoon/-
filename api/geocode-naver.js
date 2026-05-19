// Naver Developers Local Search API
// Returns coordinates and address for company name search
//
// Env vars required:
//   NAVER_CLIENT_ID     - Client ID from developers.naver.com
//   NAVER_CLIENT_SECRET - Client Secret from developers.naver.com
//
// The app must have "검색" API enabled.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', results: [] });
  }

  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query required', results: [] });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[geocode-naver] Missing NAVER_CLIENT_ID or NAVER_CLIENT_SECRET');
    return res.status(500).json({
      error: 'Naver credentials not configured',
      hint: 'Check NAVER_CLIENT_ID and NAVER_CLIENT_SECRET in Vercel env vars',
      results: []
    });
  }

  try {
    const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5`;
    const response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[geocode-naver] Naver API ${response.status}:`, errorText);

      let hint = '';
      if (response.status === 401) hint = 'Client ID/Secret invalid - check Vercel env vars';
      else if (response.status === 403) hint = '"검색" API not enabled - go to developers.naver.com, open your app, check 사용 API > 검색';
      else if (response.status === 429) hint = 'Daily quota exceeded (25,000/day) - wait until midnight KST';

      return res.status(response.status).json({
        error: `Naver API returned ${response.status}`,
        detail: errorText,
        hint,
        results: []
      });
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return res.status(200).json({
        results: [],
        total: data.total || 0,
        hint: 'API works but found no results for this query'
      });
    }

    // mapx, mapy are integers. Divide by 10^7 to get WGS84 lat/lng.
    const results = data.items.map(item => ({
      title: (item.title || '').replace(/<\/?b>/g, ''), // strip Naver's <b> highlights
      address: item.roadAddress || item.address || '',
      lat: parseInt(item.mapy, 10) / 10000000,
      lng: parseInt(item.mapx, 10) / 10000000,
      category: item.category || '',
    })).filter(r => {
      // Validate coordinates fall within Korean range
      return !isNaN(r.lat) && !isNaN(r.lng) &&
             r.lat >= 33 && r.lat <= 38.5 &&
             r.lng >= 124 && r.lng <= 132;
    });

    return res.status(200).json({ results, total: data.total });
  } catch (error) {
    console.error('[geocode-naver] Unexpected error:', error);
    return res.status(500).json({
      error: error.message,
      results: []
    });
  }
}
