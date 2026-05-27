// DART 주소 조회 API
// POST /api/dart-address {corp_name, bizno}
//
// 작동 방식:
//   1. Redis에서 캐시된 회사명→corp_code 맵 로드 (dart-build로 사전 구축 필요)
//   2. 회사명으로 corp_code 검색 (변형 포함)
//   3. DART company.json으로 상세 조회 (주소, 사업자번호 포함)
//   4. 사업자번호로 최종 검증 후 주소 반환

import { gunzipSync } from 'zlib';
import Redis from 'ioredis';

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CACHE_KEY = 'dart:corp_map_v2';

// 서버리스 함수 인스턴스 내 메모리 캐시 (Redis 반복 조회 절약)
let _memCache = null;
let _memCacheAt = 0;
const MEM_TTL = 30 * 60 * 1000; // 30분

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

  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    commandTimeout: 8000,
    maxRetriesPerRequest: 2,
  });

  try {
    // 1. 캐시된 회사명→corp_code 맵 로드
    const corpMap = await loadCorpMap(redis);
    if (!corpMap) {
      return res.json({
        address: null,
        error: 'DART 캐시 미구축. 관리자 패널에서 "DART 캐시 빌드"를 실행하세요.'
      });
    }

    // 2. 회사명 변형으로 corp_code 후보 검색
    const corpCodes = findCorpCodes(corp_name, corpMap);
    if (corpCodes.length === 0) {
      return res.json({ address: null });
    }

    // 3. 각 corp_code로 DART 상세 조회 (최대 5개)
    for (const corpCode of corpCodes.slice(0, 5)) {
      const info = await fetchCompanyInfo(dartKey, corpCode);
      if (!info || !info.adres) continue;

      // 4. 사업자번호 검증
      if (cleanBizno) {
        const dartBizno = (info.bizr_no || '').replace(/[^0-9]/g, '');
        if (dartBizno && dartBizno !== cleanBizno) continue;
      }

      return res.json({
        address: info.adres,
        corp_name: info.corp_name,
        bizr_no: info.bizr_no,
        ceo_nm: info.ceo_nm,
      });
    }

    return res.json({ address: null });

  } catch (err) {
    console.error('[dart-address] Error:', err);
    return res.json({ address: null, error: err.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}

async function loadCorpMap(redis) {
  const now = Date.now();
  if (_memCache && now - _memCacheAt < MEM_TTL) return _memCache;
  const b64 = await redis.get(CACHE_KEY);
  if (!b64) return null;
  try {
    const compressed = Buffer.from(b64, 'base64');
    const jsonStr = gunzipSync(compressed).toString('utf8');
    _memCache = JSON.parse(jsonStr);
    _memCacheAt = now;
    return _memCache;
  } catch (e) {
    console.error('[dart-address] Cache parse error:', e);
    return null;
  }
}

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

function findCorpCodes(name, corpMap) {
  const codes = new Set();
  for (const variant of generateVariations(name)) {
    const key = normName(variant);
    if (corpMap[key]) corpMap[key].split(',').forEach(c => codes.add(c));
  }
  return [...codes];
}

function generateVariations(name) {
  const v = [name];
  const c1 = name.replace(/주식회사\s*/g,'').replace(/\(주\)\s*/g,'').replace(/㈜\s*/g,'').trim();
  if (c1 !== name) v.push(c1);
  const c2 = name.replace(/\([^)]*\)/g,'').trim();
  if (c2 !== name && c2) v.push(c2);
  const c3 = name.replace(/^(의료법인|학교법인|재단법인|사회복지법인|사단법인)\s*/,'').trim();
  if (c3 !== name && c3) v.push(c3);
  return [...new Set(v)];
}

function normName(name) {
  return (name||'').toLowerCase()
    .replace(/주식회사/g,'').replace(/\(주\)/g,'').replace(/㈜/g,'')
    .replace(/[()（）\[\]\s\.,\-]/g,'');
}
