// Google Sheets fetcher - reads both 시트1 (employment) and 시트2 (MOU partners)
// Uses public CSV export via gviz, no API key needed (sheet must be public)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return res.status(500).json({ success: false, error: 'GOOGLE_SHEET_ID not configured' });
  }

  try {
    // 두 시트 동시에 가져오기 (취업 데이터 + MOU 데이터)
    // 시트 이름은 한글이므로 URL 인코딩 필요
    const [empResult, mouResult, jinhakResult] = await Promise.allSettled([
      fetchSheetByName(sheetId, '시트1'),
      fetchSheetByName(sheetId, '시트2'),
      fetchSheetByName(sheetId, '진학'),
    ]);

    const employment = empResult.status === 'fulfilled' ? empResult.value : [];
    const mou = mouResult.status === 'fulfilled' ? mouResult.value : [];
    // 진학 데이터: 개인정보(학번·성명) 제거 후 노출 — 공개 사이트 보호
    const PII_COLS = ['학번', '성명', '이름'];
    const jinhak = (jinhakResult.status === 'fulfilled' ? jinhakResult.value : [])
      .map(row => {
        const clean = {};
        for (const k of Object.keys(row)) {
          if (!PII_COLS.includes(k.trim())) clean[k] = row[k];
        }
        return clean;
      });

    // 취업 데이터가 없으면 에러
    if (employment.length === 0 && empResult.status === 'rejected') {
      return res.status(500).json({
        success: false,
        error: '취업 데이터(시트1) 가져오기 실패',
        detail: empResult.reason?.message || ''
      });
    }

    return res.status(200).json({
      success: true,
      // 하위 호환성: data/rowCount는 기존 코드용 (시트1 데이터)
      data: employment,
      rowCount: employment.length,
      // 새 필드: 두 시트 모두 노출
      employment: { data: employment, rowCount: employment.length },
      mou: { data: mou, rowCount: mou.length },
      jinhak: { data: jinhak, rowCount: jinhak.length },
    });
  } catch (error) {
    console.error('[fetch-sheets] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// gviz CSV export로 시트를 이름으로 가져오기 (공개 시트만 가능, API 키 불필요)
async function fetchSheetByName(sheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sheet "${sheetName}" fetch failed: ${response.status}`);
  }
  const csv = await response.text();
  // 404 페이지가 200으로 반환되는 경우 체크
  if (csv.startsWith('<') || csv.includes('not found')) {
    return [];
  }
  return parseCSV(csv);
}

// CSV 파서 (큰따옴표, 콤마 포함 셀 처리)
function parseCSV(csv) {
  const lines = splitCSVLines(csv);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCSVLine(line);
    const obj = {};
    let hasContent = false;
    headers.forEach((h, idx) => {
      const v = (values[idx] || '').trim();
      obj[h] = v;
      if (v) hasContent = true;
    });
    if (hasContent) rows.push(obj);
  }

  return rows;
}

function splitCSVLines(csv) {
  // CSV 안의 줄바꿈 (인용 부호 내부) 처리
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (cur) lines.push(cur);
      cur = '';
      if (ch === '\r' && csv[i + 1] === '\n') i++;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
