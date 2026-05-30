// DART 주소 조회 API
// POST /api/dart-address {corp_name, bizno}
//
// 방식: list.json?corp_name=NAME (최근 3개월) → corp_code → company.json → 주소

const DART_BASE = 'https://opendart.fss.or.kr/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ address: null });

  const { corp_name, bizno } = req.body || {};
  const dartKey = process.env.DART_API_KEY;

  if (!dartKey) return res.json({ address: null, error: 'DART_API_KEY not configured' });
  if (!corp_name) return res.json({ address: null, error: 'corp_name required' });

  const cleanBizno = (bizno || '').replace(/[^0-9]/g, '');

  // DART 제한: corp_code 없이 검색 시 최근 3개월만 허용
  // 동적으로 오늘 기준 3개월 전 날짜 계산
  const now = new Date();
  const bgn = new Date(now);
  bgn.setMonth(bgn.getMonth() - 3);
  const bgn_de = bgn.toISOString().slice(0,10).replace(/-/g,''); // e.g. "20260228"
  const end_de = now.toISOString().slice(0,10).replace(/-/g,'');  // e.g. "20260530"

  try {
    for (const variant of generateVariations(corp_name)) {
      const result = await searchCompany(dartKey, variant, cleanBizno, bgn_de, end_de);
      if (result) return res.json(result);
    }
    return res.json({ address: null });
  } catch (err) {
    console.error('[dart-address]', err);
    return res.json({ address: null, error: err.message });
  }
}

// list.json?corp_name으로 공시 검색 → corp_codes → company.json 상세 조회
async function searchCompany(dartKey, corpName, cleanBizno, bgn_de, end_de) {
  try {
    // DART list.json: corp_code 없이 검색 시 최근 3개월 이내만 허용
    const url = `${DART_BASE}/list.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corpName)}&bgn_de=${bgn_de}&end_de=${end_de}&page_count=10`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return null;

    const data = await resp.json();
    // 013 = 조회된 데이터 없음 (정상적으로 없는 것)
    if (data.status !== '000') {
      console.warn(`[dart] list.json status=${data.status} "${corpName}": ${data.message}`);
      return null;
    }
    if (!Array.isArray(data.list) || data.list.length === 0) return null;

    // 중복 제거된 corp_code 목록 (최대 5개)
    const corpCodes = [...new Set(data.list.map(d => d.corp_code))].slice(0, 5);

    for (const corpCode of corpCodes) {
      const info = await fetchCompanyInfo(dartKey, corpCode);
      if (!info || !info.adres) continue;

      // 사업자번호 검증 (없으면 첫 번째 결과 사용)
      if (cleanBizno) {
        const dartBizno = (info.bizr_no || '').replace(/[^0-9]/g, '');
        if (dartBizno && dartBizno !== cleanBizno) {
          console.log(`[dart] bizno mismatch: dart=${dartBizno} input=${cleanBizno}`);
          continue;
        }
      }

      console.log(`[dart] "${corpName}" → ${info.adres}`);
      return { address: info.adres, corp_name: info.corp_name, bizr_no: info.bizr_no, ceo_nm: info.ceo_nm };
    }

    return null;
  } catch(e) {
    console.warn(`[dart] searchCompany error "${corpName}":`, e.message);
    return null;
  }
}

// company.json?corp_code= 로 기업 상세정보 조회
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

// 회사명 변형 생성 (검색 정확도 향상)
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
