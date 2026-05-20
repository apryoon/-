// Kakao Address Search API
// 주소 문자열을 좌표로 정확하게 변환
// (키워드 검색이 아니라 주소 검색 전용 API를 사용)
//
// Env vars required:
//   KAKAO_REST_KEY - Kakao REST API key

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query (q) required' });
  }

  const kakaoKey = process.env.KAKAO_REST_KEY;
  if (!kakaoKey) {
    console.error('[geocode-address] KAKAO_REST_KEY not set');
    return res.status(500).json({
      error: 'KAKAO_REST_KEY not configured',
      documents: []
    });
  }

  try {
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `KakaoAK ${kakaoKey}` }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[geocode-address] Kakao API ${response.status}:`, errorText);
      return res.status(response.status).json({
        error: `Kakao API returned ${response.status}`,
        detail: errorText,
        documents: []
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('[geocode-address] Unexpected error:', error);
    return res.status(500).json({
      error: error.message,
      documents: []
    });
  }
}
