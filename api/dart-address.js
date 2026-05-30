// DART 주소 조회 — Redis 캐시 기반
// POST /api/dart-address {corp_name, bizno}
// dart-proxy + 브라우저 파싱으로 미리 구축된 캐시 사용

import { gunzipSync } from 'zlib';
import Redis from 'ioredis';

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CACHE_KEY = 'dart:corp_map_v2';

// 서버리스 인스턴스 메모리 캐시 (Redis 재조회 절약)
let _mem = null, _memAt = 0;
const MEM_TTL = 30 * 60 * 1000;

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

  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    commandTimeout: 8000,
    maxRetriesPerRequest: 2,
  });

  try {
    const corpMap = await loadCorpMap(redis);
    if (!corpMap) {
      return res.json({
        address: null,
        error: 'DART 캐시 없음. 관리자 패널에서 "DART 기업코드 수집" 버튼을 클릭하세요.'
      });
    }

    for (const variant of generateVariations(corp_name)) {
      const key = normName(variant);
      const codes = corpMap[key];
      if (!codes) continue;

      for (const corpCode of codes.split(',').slice(0, 5)) {
        const info = await fetchCompanyInfo(dartKey, corpCode);
        if (!info?.adres) continue;

        if (cleanBizno) {
          const dartBizno = (info.bizr_no || '').replace(/[^0-9]/g, '');
          if (dartBizno && dartBizno !== cleanBizno) continue;
        }

        console.log(`[DART] "${corp_name}" → ${info.adres}`);
        return res.json({ address: info.adres, corp_name: info.corp_name, bizr_no: info.bizr_no, corp_cls: info.corp_cls||'' });
      }
    }

    return res.json({ address: null });
  } catch (err) {
    console.error('[dart-address]', err);
    return res.json({ address: null, error: err.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}

async function loadCorpMap(redis) {
  const now = Date.now();
  if (_mem && now - _memAt < MEM_TTL) return _mem;
  const b64 = await redis.get(CACHE_KEY);
  if (!b64) return null;
  try {
    _mem = JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
    _memAt = now;
    return _mem;
  } catch { return null; }
}

async function fetchCompanyInfo(dartKey, corpCode) {
  try {
    const resp = await fetch(`${DART_BASE}/company.json?crtfc_key=${dartKey}&corp_code=${corpCode}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return null;
    const d = await resp.json();
    return d.status === '000' ? d : null;
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

function normName(name) {
  return (name || '').toLowerCase()
    .replace(/주식회사/g,'').replace(/\(주\)/g,'').replace(/㈜/g,'')
    .replace(/[()（）\[\]\s\.,\-]/g,'');
}
