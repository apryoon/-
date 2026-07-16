// NAVER API Hub - Search (지역/Local) API
// Returns coordinates and address for company name search
//
// Env vars required:
//   NAVER_HUB_CLIENT_ID     - Client ID (X-NCP-APIGW-API-KEY-ID) from NAVER API Hub (console.ncloud.com)
//   NAVER_HUB_CLIENT_SECRET - Client Secret (X-NCP-APIGW-API-KEY) from NAVER API Hub
//
// The application must have the "지역" (NAVER Search Local API) product enabled
// under NAVER API HUB > Application (구 개발자센터 NAVER_CLIENT_ID/SECRET과는 다른 키입니다).
//
// Migration note: developers.naver.com 검색 API는 2027-06-30 전면 종료 예정이라
// NAVER API Hub(NCP)로 이관. 엔드포인트/헤더/키가 전부 바뀌었으니 주의.

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

  // 신규 키 (NAVER API Hub). 예전 NAVER_CLIENT_ID/SECRET과는 별개의 키입니다.
  const clientId = process.env.NAVER_HUB_CLIENT_ID;
  const clientSecret = process.env.NAVER_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[geocode-naver] Missing NAVER_HUB_CLIENT_ID or NAVER_HUB_CLIENT_SECRET');
    return res.status(500).json({
      error: 'Naver API Hub credentials not configured',
      hint: 'Check NAVER_HUB_CLIENT_ID and NAVER_HUB_CLIENT_SECRET in Vercel env vars (NAVER API Hub > jobplace > 인증정보)',
      results: []
    });
  }

  try {
    // 구: https://openapi.naver.com/v1/search/local.json
    // 신: https://naverapihub.apigw.ntruss.com/search/v1/local
    const url = `https://naverapihub.apigw.ntruss.com/search/v1/local?query=${encodeURIComponent(query)}&display=5&sort=random`;
    const response = await fetch(url, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[geocode-naver] Naver API Hub ${response.status}:`, errorText);

      let hint = '';
      if (response.status === 401) hint = 'Client ID/Secret invalid - NAVER API Hub 콘솔에서 인증정보 재확인';
      else if (response.status === 403) hint = '"지역"(NAVER Search Local API) 상품이 Application에 등록되어 있는지 확인 (console.ncloud.com > NAVER API HUB > Application)';
      else if (response.status === 429) hint = '호출 한도 초과 (검색 API 통합 월 775,000회 / 초당 50 RPS) - 잠시 후 재시도';

      return res.status(response.status).json({
        error: `Naver API Hub returned ${response.status}`,
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
