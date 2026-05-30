// DART corpCode.xml 다운로드 프록시 (서울 리전에서 실행 → 빠름)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dartKey = process.env.DART_API_KEY;
  if (!dartKey) {
    return res.status(500).json({ error: 'DART_API_KEY not configured' });
  }

  try {
    const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${dartKey}`;
    const dartResp = await fetch(url);

    if (!dartResp.ok) {
      return res.status(dartResp.status).json({ error: `DART HTTP ${dartResp.status}` });
    }

    const buffer = Buffer.from(await dartResp.arrayBuffer());
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="corpCode.zip"');
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);

  } catch (err) {
    console.error('[dart-proxy]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
