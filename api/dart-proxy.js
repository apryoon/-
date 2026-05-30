// DART corpCode.xml 다운로드 프록시 — Vercel Edge Runtime
// GET /api/dart-proxy
// Edge Function: 스트리밍 지원, 타임아웃 30초 (일반 함수 10초보다 여유)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const dartKey = process.env.DART_API_KEY;
  if (!dartKey) {
    return new Response(JSON.stringify({ error: 'DART_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${dartKey}`;
    const dartResp = await fetch(url);

    if (!dartResp.ok) {
      return new Response(
        JSON.stringify({ error: `DART HTTP ${dartResp.status}` }),
        { status: dartResp.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // ZIP 스트림을 브라우저로 직접 전달 (버퍼링 없음 → 빠름)
    return new Response(dartResp.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="corpCode.zip"',
        ...corsHeaders,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
}
