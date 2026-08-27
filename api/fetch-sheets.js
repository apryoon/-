// Google Sheets fetcher - 시트1, 시트2, 진학, 정보공시
// 정보공시 시트 로우데이터(O열 최종취업구분)로 취업률 실시간 계산

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
    const [empResult, mouResult, jinhakResult, infoResult] = await Promise.allSettled([
      fetchSheetByName(sheetId, '시트1'),
      fetchSheetByName(sheetId, '시트2'),
      fetchSheetByName(sheetId, '진학'),
      fetchSheetByName(sheetId, '정보공시'),
    ]);

    const employment = empResult.status === 'fulfilled' ? empResult.value : [];
    const mou        = mouResult.status  === 'fulfilled' ? mouResult.value  : [];

    const PII_COLS = ['학번', '성명', '이름'];
    const jinhak = (jinhakResult.status === 'fulfilled' ? jinhakResult.value : [])
      .map(row => {
        const clean = {};
        for (const k of Object.keys(row)) {
          if (!PII_COLS.includes(k.trim())) clean[k] = row[k];
        }
        return clean;
      });

    // 정보공시 로우데이터 → 취업률 계산
    const infoRaw = infoResult.status === 'fulfilled' ? infoResult.value : [];
    const empRateResult = infoRaw.length > 0 ? calcEmploymentRate(infoRaw) : null;

    if (employment.length === 0 && empResult.status === 'rejected') {
      return res.status(500).json({
        success: false,
        error: '취업 데이터(시트1) 가져오기 실패',
        detail: empResult.reason?.message || ''
      });
    }

    return res.status(200).json({
      success: true,
      data: employment,
      rowCount: employment.length,
      employment: { data: employment, rowCount: employment.length },
      mou:        { data: mou,        rowCount: mou.length },
      jinhak:     { data: jinhak,     rowCount: jinhak.length },
      info: {
        rowCount: infoRaw.length,
        employmentRate: empRateResult,  // summary + details + bakedRows
        rawRows: infoRaw.map(r => {     // 개인정보 제거한 로우데이터 (상세 장표용)
          const { 학번:_a, 성명:_b, 이름:_c, 개인식별키:_d, ...rest } = r;
          return rest;
        })
      },
    });
  } catch (error) {
    console.error('[fetch-sheets] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ─────────────────────────────────────────────
//  취업률 계산 (정보공시 시트 로우데이터 기준)
//  O열(최종취업구분) 값으로 판단
// ─────────────────────────────────────────────
function calcEmploymentRate(rows) {
  const isEmployed = s => !!(s && String(s).trim().startsWith('취업자('));
  const isExcluded = s => {
    if (!s) return false;
    const t = String(s).trim();
    return ['입대자','진학자','제외인정자','취업불가능자'].some(k => t.includes(k));
  };

  // 학과별/학생구분별 집계
  const stats = {};   // key: "year|dept|gubun" → {emp, target}

  for (const r of rows) {
    const year   = (r['정보공시 구분'] || '').trim();
    const dept   = (r['학과명']       || '').trim();
    const gubun  = (r['학생구분']     || '').trim();
    const intl   = (r['외국인유학생여부'] || '').trim();
    const status = (r['최종취업구분'] || '').trim();

    if (!year || !dept || !gubun) continue;

    // 국제학생 통일
    const gubunKey = (intl === '예' || gubun === '외국인') ? '국제학생' : gubun;

    if (isExcluded(status)) continue;   // 취업대상자 제외

    const key = `${year}|${dept}|${gubunKey}`;
    if (!stats[key]) stats[key] = { year, dept, gubun: gubunKey, emp: 0, target: 0 };

    stats[key].target++;
    if (isEmployed(status)) stats[key].emp++;
  }

  // ── summary: 연도별/학생구분별 합계
  const summary = {};
  for (const s of Object.values(stats)) {
    if (!summary[s.year]) summary[s.year] = {};
    if (!summary[s.year][s.gubun]) summary[s.year][s.gubun] = { emp: 0, target: 0 };
    summary[s.year][s.gubun].emp    += s.emp;
    summary[s.year][s.gubun].target += s.target;
  }
  // 전체 합계 & rate 계산
  for (const year of Object.keys(summary)) {
    let totEmp = 0, totTarget = 0;
    for (const [gub, d] of Object.entries(summary[year])) {
      d.rate = d.target > 0 ? parseFloat((d.emp / d.target * 100).toFixed(2)) : 0;
      totEmp    += d.emp;
      totTarget += d.target;
    }
    summary[year]['전체'] = {
      emp: totEmp,
      target: totTarget,
      rate: totTarget > 0 ? parseFloat((totEmp / totTarget * 100).toFixed(2)) : 0
    };
  }

  // ── bakedRows: [yearIdx, deptIdx, gubunIdx, emp, target]
  //    index.html의 EMP_BAKED.rows와 동일한 구조
  const years  = ['2024','2025','2026'];
  const gubuns = ['학령기','성인','위탁','전공심화','국제학생'];
  const depts  = [...new Set(Object.values(stats).map(s => s.dept))].sort((a,b) => a.localeCompare(b,'ko'));

  const yearIdx  = Object.fromEntries(years.map((y,i)  => [y,i]));
  const gubunIdx = Object.fromEntries(gubuns.map((g,i) => [g,i]));
  const deptIdx  = Object.fromEntries(depts.map((d,i)  => [d,i]));

  const bakedRows = [];
  for (const s of Object.values(stats)) {
    if (s.target === 0) continue;
    if (!(s.year in yearIdx) || !(s.dept in deptIdx) || !(s.gubun in gubunIdx)) continue;
    bakedRows.push([yearIdx[s.year], deptIdx[s.dept], gubunIdx[s.gubun], s.emp, s.target]);
  }
  bakedRows.sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);

  const meta = {
    '2024': { basis:'2023-12-31', target:'23년 2월, 22년 8월 졸업생', final:true  },
    '2025': { basis:'2024-12-31', target:'24년 2월, 23년 8월 졸업생', final:true  },
    '2026': { basis:'2025-12-31', target:'25년 2월, 24년 8월 졸업생', final:false },
  };

  return { summary, depts, gubuns, years, meta, bakedRows };
}

// ─────────────────────────────────────────────
//  시트 데이터 가져오기 (gviz CSV)
// ─────────────────────────────────────────────
async function fetchSheetByName(sheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sheet "${sheetName}" fetch failed: ${response.status}`);
  const csv = await response.text();
  if (csv.startsWith('<') || csv.includes('not found')) return [];
  return parseCSV(csv);
}

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
  const lines = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (inQuotes && csv[i+1] === '"') { cur += '""'; i++; }
      else { inQuotes = !inQuotes; cur += ch; }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (cur) lines.push(cur);
      cur = '';
      if (ch === '\r' && csv[i+1] === '\n') i++;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
