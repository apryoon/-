// DART corpCode.xml 다운로드 프록시
// GET /api/dart-proxy
// DART API → ZIP 바이너리를 그대로 반환 (브라우저에서 해제)
// CORS 우회용 프록시 (브라우저에서 DART API 직접 호출 불가)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dartKey = process.env.DART_API_KEY;
  if (!dartKey) return res.status(500).json({ error: 'DART_API_KEY not configured' });

  try {
    const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${dartKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(9000) });

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `DART HTTP ${resp.status}` });
    }

    const buffer = await resp.arrayBuffer();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="corpCode.zip"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[dart-proxy] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
