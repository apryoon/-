// DART 주소 조회 API — 진단 기능 포함
const DART_BASE = 'https://opendart.fss.or.kr/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ address: null });

  const { corp_name, bizno, _debug = false } = req.body || {};
  const dartKey = process.env.DART_API_KEY;

  if (!dartKey) return res.json({ address: null, error: 'DART_API_KEY not configured' });
  if (!corp_name) return res.json({ address: null, error: 'corp_name required' });

  const cleanBizno = (bizno || '').replace(/[^0-9]/g, '');

  // ── 디버그 모드: DART API 원본 응답 반환 ─────────────────
  if (_debug) {
    const diag = {};

    // 테스트 1: company.json?corp_name (회사명 검색)
    try {
      const u1 = `${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corp_name)}`;
      const r1 = await fetch(u1, { signal: AbortSignal.timeout(8000) });
      const d1 = await r1.json();
      diag.company_json_by_name = {
        status: d1.status, message: d1.message,
        has_corp_code: !!d1.corp_code,
        has_list: Array.isArray(d1.list),
        list_count: d1.list?.length,
        adres: d1.adres,
        bizr_no: d1.bizr_no,
        corp_name: d1.corp_name,
        sample_list: d1.list?.slice(0, 3).map(c => ({corp_code: c.corp_code, corp_name: c.corp_name, bizr_no: c.bizr_no, adres: c.adres})),
      };
    } catch(e) { diag.company_json_by_name = { error: e.message }; }

    // 테스트 2: list.json?corp_name (공시 검색)
    try {
      const u2 = `${DART_BASE}/list.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corp_name)}&bgn_de=20200101&page_count=5`;
      const r2 = await fetch(u2, { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      diag.list_json_by_name = {
        status: d2.status, message: d2.message,
        total_count: d2.total_count,
        sample: d2.list?.slice(0, 3).map(d => ({corp_code: d.corp_code, corp_name: d.corp_name})),
      };
    } catch(e) { diag.list_json_by_name = { error: e.message }; }

    // 테스트 3: 알려진 삼성전자 corp_code로 직접 조회
    try {
      const u3 = `${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_code=00126380`;
      const r3 = await fetch(u3, { signal: AbortSignal.timeout(8000) });
      const d3 = await r3.json();
      diag.samsung_direct = {
        status: d3.status, corp_name: d3.corp_name,
        bizr_no: d3.bizr_no, adres: d3.adres,
        bizno_matches: d3.bizr_no?.replace(/[^0-9]/g, '') === cleanBizno,
      };
    } catch(e) { diag.samsung_direct = { error: e.message }; }

    return res.json({ _debug: true, corp_name, cleanBizno, diag });
  }

  // ── 실제 조회 로직 ─────────────────────────────────────
  try {
    for (const variant of generateVariations(corp_name)) {
      const result = await searchByNameThenVerify(dartKey, variant, cleanBizno);
      if (result) return res.json(result);
    }
    return res.json({ address: null });
  } catch (err) {
    console.error('[dart-address]', err);
    return res.json({ address: null, error: err.message });
  }
}

// company.json?corp_name 검색 → corp_code 수집 → company.json?corp_code로 상세 조회
async function searchByNameThenVerify(dartKey, corpName, cleanBizno) {
  // 방법1: company.json?corp_name으로 회사 목록 검색
  try {
    const url = `${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corpName)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const data = await resp.json();

    if (data.status === '000') {
      // 단일 결과 (corp_name 검색 시 하나만 반환하는 경우)
      if (data.corp_code && data.adres) {
        if (!cleanBizno) return { address: data.adres, corp_name: data.corp_name, bizr_no: data.bizr_no };
        const dartBizno = (data.bizr_no || '').replace(/[^0-9]/g, '');
        if (!dartBizno || dartBizno === cleanBizno) return { address: data.adres, corp_name: data.corp_name, bizr_no: data.bizr_no };
      }
      // 리스트 결과 (여러 회사 반환하는 경우)
      if (Array.isArray(data.list)) {
        for (const c of data.list) {
          if (!c.adres) continue;
          if (!cleanBizno) return { address: c.adres, corp_name: c.corp_name, bizr_no: c.bizr_no };
          const dartBizno = (c.bizr_no || '').replace(/[^0-9]/g, '');
          if (!dartBizno || dartBizno === cleanBizno) return { address: c.adres, corp_name: c.corp_name, bizr_no: c.bizr_no };
        }
      }
    }
  } catch(e) { console.warn('[dart] company.json search error:', e.message); }

  // 방법2: list.json?corp_name으로 공시 검색 → corp_code 수집
  try {
    const url2 = `${DART_BASE}/list.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corpName)}&bgn_de=20200101&page_count=5`;
    const resp2 = await fetch(url2, { signal: AbortSignal.timeout(6000) });
    if (!resp2.ok) return null;
    const data2 = await resp2.json();
    if (data2.status !== '000' || !Array.isArray(data2.list)) return null;

    const corpCodes = [...new Set(data2.list.map(d => d.corp_code))].slice(0, 3);
    for (const corpCode of corpCodes) {
      const info = await fetchCompanyInfo(dartKey, corpCode);
      if (!info?.adres) continue;
      if (!cleanBizno) return { address: info.adres, corp_name: info.corp_name, bizr_no: info.bizr_no };
      const dartBizno = (info.bizr_no || '').replace(/[^0-9]/g, '');
      if (!dartBizno || dartBizno === cleanBizno) return { address: info.adres, corp_name: info.corp_name, bizr_no: info.bizr_no };
    }
  } catch(e) { console.warn('[dart] list.json search error:', e.message); }

  return null;
}

async function fetchCompanyInfo(dartKey, corpCode) {
  try {
    const url = `${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_code=${corpCode}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === '000' ? data : null;
  } catch { return null; }
}

function generateVariations(name) {
  const v = new Set([name]);
  const c1 = name.replace(/주식회사\s*/g,'').replace(/\(주\)\s*/g,'').replace(/㈜\s*/g,'').trim();
  if (c1 !== name && c1) v.add(c1);
  const c2 = name.replace(/\([^)]*\)/g,'').trim();
  if (c2 !== name && c2) v.add(c2);
  const c3 = name.replace(/^(의료법인|학교법인|재단법인|사회복지법인|사단법인)\s*/,'').trim();
  if (c3 !== name && c3) v.add(c3);
  return [...v];
}
