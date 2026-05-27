// DART (금융감독원 전자공시) API를 통해 사업자등록번호로 주소 조회
//
// 흐름:
//   1. 회사명으로 DART 검색 → 기업 리스트 반환
//   2. 사업자등록번호(bizr_no)로 일치하는 기업 선택
//   3. 해당 기업의 adres(주소) 반환
//
// 필요 환경변수: DART_API_KEY (https://opendart.fss.or.kr/ 에서 발급)
//
// DART API 커버리지:
//   ✅ 코스피/코스닥 상장사
//   ✅ 외부감사 대상 기업 (매출 80억+ 등)
//   ❌ 소규모 법인, 비상장 복지기관, 어린이집 등

const DART_API_BASE = 'https://opendart.fss.or.kr/api';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ address: null, error: 'Method not allowed' });
  }

  const { corp_name, bizno } = req.body || {};
  const dartKey = process.env.DART_API_KEY;

  if (!dartKey) {
    return res.status(200).json({
      address: null,
      error: 'DART_API_KEY not configured'
    });
  }

  if (!corp_name && !bizno) {
    return res.status(400).json({ address: null, error: 'corp_name or bizno required' });
  }

  // 사업자등록번호 정규화 (숫자만, 10자리)
  const cleanBizno = (bizno || '').replace(/[^0-9]/g, '');

  try {
    let address = null;
    let matchedCompany = null;

    // ── 전략 1: 회사명으로 DART 검색 후 사업자번호로 검증 ──────────────
    if (corp_name) {
      const result = await searchByName(dartKey, corp_name, cleanBizno);
      if (result) {
        address = result.adres;
        matchedCompany = result;
      }
    }

    // ── 전략 2: 회사명 변형 시도 (괄호, 주식회사 제거 등) ───────────────
    if (!address && corp_name) {
      const variations = generateVariations(corp_name);
      for (const variant of variations) {
        if (variant === corp_name) continue; // 이미 시도한 것 건너뜀
        const result = await searchByName(dartKey, variant, cleanBizno);
        if (result) {
          address = result.adres;
          matchedCompany = result;
          break;
        }
      }
    }

    if (!address) {
      return res.status(200).json({ address: null });
    }

    return res.status(200).json({
      address,
      corp_name: matchedCompany?.corp_name || '',
      bizr_no: matchedCompany?.bizr_no || '',
      ceo_nm: matchedCompany?.ceo_nm || '',
    });

  } catch (error) {
    console.error('[dart-address] Error:', error);
    return res.status(200).json({ address: null, error: error.message });
  }
}

// DART 기업 검색 (corp_name 파라미터) + 사업자번호 검증
async function searchByName(dartKey, corpName, cleanBizno) {
  try {
    const url = `${DART_API_BASE}/company.json?crtfc_key=${dartKey}&corp_name=${encodeURIComponent(corpName)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!resp.ok) {
      console.warn(`[dart-address] DART API HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();

    if (data.status !== '000') {
      // 013: 조회된 데이터가 없음 → 정상적으로 null 반환
      if (data.status !== '013') {
        console.warn(`[dart-address] DART status ${data.status}: ${data.message}`);
      }
      return null;
    }

    // 응답 형식 1: list 배열로 반환되는 경우
    if (Array.isArray(data.list)) {
      return findBestMatch(data.list, cleanBizno);
    }

    // 응답 형식 2: 단일 기업 정보로 반환되는 경우
    if (data.corp_code && data.adres) {
      if (cleanBizno) {
        const dartBizno = normBizno(data.bizr_no);
        if (dartBizno !== cleanBizno) return null; // 사업자번호 불일치
      }
      return data;
    }

    return null;
  } catch (err) {
    // timeout 등 일시적 오류는 조용히 무시
    console.warn('[dart-address] searchByName error:', err.message);
    return null;
  }
}

// 후보 기업 목록에서 사업자번호 일치 또는 최적 매칭 선택
function findBestMatch(list, cleanBizno) {
  if (!list || list.length === 0) return null;

  if (cleanBizno) {
    // 1순위: 사업자번호 정확 일치
    const exact = list.find(c => normBizno(c.bizr_no) === cleanBizno);
    if (exact?.adres) return exact;
  }

  // 사업자번호 없으면 주소 있는 첫 번째 결과
  const first = list.find(c => c.adres);
  return first || null;
}

// 사업자번호 정규화
function normBizno(bizno) {
  return (bizno || '').replace(/[^0-9]/g, '');
}

// 회사명 변형 생성 (검색 정확도 향상)
function generateVariations(name) {
  const cleaned = name
    .replace(/주식회사\s*/g, '')
    .replace(/\(주\)\s*/g, '')
    .replace(/㈜\s*/g, '')
    .replace(/\s*\(주\)/g, '')
    .replace(/\s*주식회사/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const variations = [name];

  if (cleaned !== name) variations.push(cleaned);

  // 괄호 안 내용 포함된 경우: "ABC(분당점)" → "ABC"
  const withoutParens = name.replace(/\([^)]*\)/g, '').trim();
  if (withoutParens !== name && withoutParens) variations.push(withoutParens);

  // 의료법인/학교법인 등 법인 유형 제거
  const withoutType = name
    .replace(/^(의료법인|학교법인|재단법인|사회복지법인|사단법인)\s*/, '')
    .trim();
  if (withoutType !== name && withoutType) variations.push(withoutType);

  return [...new Set(variations)];
}
