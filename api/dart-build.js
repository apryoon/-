// DART corpCode.xml 다운로드 → 파싱 → Redis 저장
// POST /api/dart-build {password}
// 서울 리전(icn1)에서 실행: DART까지 왕복 10ms → 전체 3~5초 내 완료

import { inflateRawSync, gzipSync } from 'zlib';
import Redis from 'ioredis';

const DART_BASE = 'https://opendart.fss.or.kr/api';
const CACHE_KEY = 'dart:corp_map_v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { password } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ success: false, error: '인증 실패' });

  const dartKey = process.env.DART_API_KEY;
  if (!dartKey)
    return res.status(500).json({ success: false, error: 'DART_API_KEY not configured' });

  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    commandTimeout: 10000,
  });

  try {
    // 1. ZIP 다운로드 (서울 리전에서 DART까지 ~1초)
    const url = `${DART_BASE}/corpCode.xml?crtfc_key=${dartKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`DART HTTP ${resp.status}`);

    // 2. ZIP 해제
    const zipBuf = Buffer.from(await resp.arrayBuffer());
    const xml = extractFirstFileFromZip(zipBuf);

    // 3. XML 파싱 → {정규화된회사명: "corpCode"} 맵
    const corpMap = parseCorpCodesXml(xml);
    const count = Object.keys(corpMap).length;

    // 4. GZIP 압축 후 Redis 저장
    const json = JSON.stringify(corpMap);
    const compressed = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
    await redis.set(CACHE_KEY, compressed, 'EX', 7 * 24 * 60 * 60);

    return res.json({
      success: true,
      count,
      size: `${(compressed.length / 1024).toFixed(0)}KB`,
      message: `✅ ${count.toLocaleString()}개 기업 캐시 완료`
    });

  } catch (err) {
    console.error('[dart-build]', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}

// ZIP에서 첫 번째 파일 추출
function extractFirstFileFromZip(buf) {
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i]===0x50 && buf[i+1]===0x4B && buf[i+2]===0x03 && buf[i+3]===0x04) {
      const comp  = buf.readUInt16LE(i + 8);
      const cSize = buf.readUInt32LE(i + 18);
      const fnLen = buf.readUInt16LE(i + 26);
      const exLen = buf.readUInt16LE(i + 28);
      const start = i + 30 + fnLen + exLen;
      const data  = buf.slice(start, start + cSize);
      if (comp === 8) return inflateRawSync(data).toString('utf8');
      if (comp === 0) return data.toString('utf8');
      throw new Error(`지원하지 않는 압축: ${comp}`);
    }
  }
  throw new Error('ZIP 헤더 없음');
}

// CORPCODE.xml 파싱
function parseCorpCodesXml(xml) {
  const map = {};
  const parts = xml.split('<list>');
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const cs = p.indexOf('<corp_code>') + 11, ce = p.indexOf('</corp_code>');
    const ns = p.indexOf('<corp_name>') + 11, ne = p.indexOf('</corp_name>');
    if (cs < 11 || ce < 0 || ns < 11 || ne < 0) continue;
    const code = p.substring(cs, ce).trim();
    const name = p.substring(ns, ne).trim();
    if (!code || !name) continue;
    const key = normName(name);
    map[key] = map[key] ? map[key] + ',' + code : code;
  }
  return map;
}

function normName(name) {
  return (name || '').toLowerCase()
    .replace(/주식회사/g,'').replace(/\(주\)/g,'').replace(/㈜/g,'')
    .replace(/[()（）\[\]\s\.,\-]/g,'');
}
