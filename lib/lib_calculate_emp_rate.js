/**
 * 정보공시 시트 데이터에서 취업률 계산
 * 
 * 사용법:
 * const result = calculateEmploymentRate(sheetData);
 */

export function calculateEmploymentRate(rows) {
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
    console.error('[calculateEmploymentRate] 필수 컬럼 미발견');
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
