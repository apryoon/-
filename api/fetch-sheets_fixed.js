// Google Sheets fetcher - reads 시트1, 시트2, 진학, 정보공시
// Uses public CSV export via gviz, no API key needed (sheet must be public)

// 정보공시 취업률 계산 함수 (내장)
function calculateEmploymentRate(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  // 헤더 파싱
  const headers = rows[0];
  const colMap = {
    year: headers.indexOf('정보공시 구분'),
    dept: headers.indexOf('학과명'),
    gubun: headers.indexOf('학생구분'),
    finalStatus: headers.indexOf('최종취업구분')
  };

  // 필수 컬럼 확인
  if (Object.values(colMap).some(i => i === -1)) {
    console.error('[calculateEmploymentRate] 필수 컬럼 미발견', colMap, headers);
    return null;
  }

  // 취업 판단
  const isEmployed = (status) => {
    if (!status) return false;
    return String(status).trim().startsWith('취업자(');
  };

  // 제외 판단
  const isExcluded = (status) => {
    if (!status) return false;
    const s = String(status).trim();
    return ['입대자', '진학자', '제외인정자', '취업불가능자'].some(k => s.includes(k));
  };

  // 데이터 집계
  const stats = {};
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const year = String(row[colMap.year] || '').trim();
    const dept = String(row[colMap.dept] || '').trim();
    const gubun = String(row[colMap.gubun] || '').trim();
    const finalStatus = row[colMap.finalStatus];

    if (!year || !dept || !gubun) continue;

    const key = `${year}|${dept}|${gubun}`;
    if (!stats[key]) {
      stats[key] = { year, dept, gubun, employed: 0, target: 0 };
    }

    // 제외 대상 스킵
    if (isExcluded(finalStatus)) continue;

    stats[key].target++;
    if (isEmployed(finalStatus)) {
      stats[key].employed++;
    }
  }

  // 결과 정리
  const result = {
    summary: {},
    details: {}
  };

  // 상세 데이터
  Object.values(stats).forEach(stat => {
    const rate = stat.target > 0 ? (stat.employed / stat.target * 100).toFixed(2) : 0;
    
    if (!result.details[stat.year]) result.details[stat.year] = {};
    if (!result.details[stat.year][stat.dept]) result.details[stat.year][stat.dept] = {};
    
    result.details[stat.year][stat.dept][stat.gubun] = {
      employed: stat.employed,
      target: stat.target,
      rate: parseFloat(rate)
    };
  });

  // 연도별/학생구분별 요약
  const yearGubunStats = {};
  Object.values(stats).forEach(stat => {
    const key = `${stat.year}|${stat.gubun}`;
    if (!yearGubunStats[key]) {
      yearGubunStats[key] = { year: stat.year, gubun: stat.gubun, employed: 0, target: 0 };
    }
    yearGubunStats[key].employed += stat.employed;
    yearGubunStats[key].target += stat.target;
  });

  // 학생구분별 취업률
  Object.values(yearGubunStats).forEach(stat => {
    const rate = stat.target > 0 ? (stat.employed / stat.target * 100).toFixed(2) : 0;
    
    if (!result.summary[stat.year]) result.summary[stat.year] = {};
    result.summary[stat.year][stat.gubun] = {
      employed: stat.employed,
      target: stat.target,
      rate: parseFloat(rate)
    };
  });

  // 전체 취업률
  Object.keys(result.summary).forEach(year => {
    let totalEmployed = 0;
    let totalTarget = 0;
    
    Object.values(result.summary[year]).forEach(stat => {
      totalEmployed += stat.employed;
      totalTarget += stat.target;
    });
    
    const overallRate = totalTarget > 0 ? (totalEmployed / totalTarget * 100).toFixed(2) : 0;
    result.summary[year]['전체'] = {
      employed: totalEmployed,
      target: totalTarget,
      rate: parseFloat(overallRate)
    };
  });

  return result;
}

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
    // 4개 시트 동시에 가져오기 (취업 + MOU + 진학 + 정보공시)
    const [empResult, mouResult, jinhakResult, infoResult] = await Promise.allSettled([
      fetchSheetByName(sheetId, '시트1'),
      fetchSheetByName(sheetId, '시트2'),
      fetchSheetByName(sheetId, '진학'),
      fetchSheetByName(sheetId, '정보공시'),
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

    // 정보공시 데이터: 개인정보 제거 + 취업률 계산
    let infoRaw = infoResult.status === 'fulfilled' ? infoResult.value : [];
    
    // 정보공시 데이터 개인정보 제거
    const infoData = infoRaw.map(row => {
      const clean = {};
      for (const k of Object.keys(row)) {
        if (!PII_COLS.includes(k.trim())) clean[k] = row[k];
      }
      return clean;
    });

    // 취업률 계산 (정보공시 시트 원본 데이터 사용)
    let empRateResult = null;
    if (infoRaw.length > 0) {
      // CSV 파싱된 데이터를 2D 배열로 변환 (calculateEmploymentRate 함수는 2D 배열 기대)
      const headers = Object.keys(infoRaw[0]);
      const dataArray = [headers, ...infoRaw.map(row => headers.map(h => row[h] || ''))];
      empRateResult = calculateEmploymentRate(dataArray);
      console.log('[fetch-sheets] 취업률 계산 완료:', empRateResult?.summary);
    }

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
      // 새 필드: 모든 시트 데이터
      employment: { data: employment, rowCount: employment.length },
      mou: { data: mou, rowCount: mou.length },
      jinhak: { data: jinhak, rowCount: jinhak.length },
      // 정보공시 데이터 및 취업률 계산 결과
      info: { 
        data: infoData, 
        rowCount: infoData.length,
        employmentRate: empRateResult
      },
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
