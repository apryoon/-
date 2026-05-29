// DART 주소 조회 API v3 — 캐시 빌드 불필요, 빠른 직접 검색
// POST /api/dart-address {corp_name, bizno}
//
// 방식:
//   1. list.json?corp_name=NAME → 최근 공시에서 corp_code 수집
//   2. company.json?corp_code=... → 주소 + 사업자번호 조회
//   3. 사업자번호 일치 확인 → 주소 반환
//
// 소요시간: 1~4초 (Hobby 플랜 10초 제한 내에서 동작)

const DART_BASE = 'https://opendart.fss.or.kr/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ address: null, error: 'POST required' });

  const { corp_name, bizno } = req.body || {};
  const dartKey = process.env.DART_API_KEY;

  if (!dartKey) return res.json({ address: null, error: 'DART_API_KEY not configured' });
  if (!corp_name) return res.json({ address: null, error: 'corp_name required' });

  const cleanBizno = (bizno || '').replace(/[^0-9]/g, '');

  try {
    // 회사명 변형 시도 (원본 → 주식회사 제거 → 괄호 제거 → 법인유형 제거)
    for (const variant of generateVariations(corp_name)) {
      const result = await searchCompany(dartKey, variant, cleanBizno);
      if (result) return res.json(result);
    }
    return res.json({ address: null });
  } catch (err) {
    console.error('[dart-address] Error:', err);
    return res.json({ address: null, error: err.message });
  }
}

// list.json으로 회사명 검색 → corp_code 수집 → company.json으로 상세 조회
async function searchCompany(dartKey, corpName, cleanBizno) {
  try {
    // 최근 5년 공시에서 해당 회사명 검색 (page_count=5로 5개만)
    const url = `${DART_BASE}/list.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corpName)}&bgn_de=20200101&page_count=5`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;

    const data = await resp.json();
    // status 000=정상, 013=데이터없음
    if (data.status !== '000' || !Array.isArray(data.list) || data.list.length === 0) return null;

    // 고유 corp_code 수집 (최대 3개)
    const corpCodes = [...new Set(data.list.map(d => d.corp_code))].slice(0, 3);

    // 각 corp_code로 company.json 조회
    for (const corpCode of corpCodes) {
      const info = await fetchCompanyInfo(dartKey, corpCode);
      if (!info || !info.adres) continue;

      // 사업자번호 검증
      if (cleanBizno) {
        const dartBizno = (info.bizr_no || '').replace(/[^0-9]/g, '');
        if (dartBizno && dartBizno !== cleanBizno) continue; // 불일치 → 다음
      }

      console.log(`[DART] "${corpName}" → ${info.adres}`);
      return {
        address: info.adres,
        corp_name: info.corp_name,
        bizr_no: info.bizr_no,
        ceo_nm: info.ceo_nm,
      };
    }
    return null;
  } catch (e) {
    console.warn('[dart-address] searchCompany error:', e.message);
    return null;
  }
}

// DART company.json — 기업 상세 (주소, 사업자번호 포함)
async function fetchCompanyInfo(dartKey, corpCode) {
  try {
    const url = `${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_code=${corpCode}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === '000' ? data : null;
  } catch {
    return null;
  }
}

// 회사명 변형 생성
function generateVariations(name) {
  const v = new Set([name]);
  const c1 = name.replace(/주식회사\s*/g,'').replace(/\(주\)\s*/g,'').replace(/㈜\s*/g,'').trim();
  if (c1 !== name && c1) v.add(c1);
  const c2 = name.replace(/\([^)]*\)/g,'').trim();
  if (c2 !== name && c2) v.add(c2);
  const c3 = name.replace(/^(의료법인|학교법인|재단법인|사회복지법인|사단법인|유한회사)\s*/,'').trim();
  if (c3 !== name && c3) v.add(c3);
  return [...v];
}
