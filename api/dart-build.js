// DART corpCode.xml 다운로드 → Redis 캐시 빌드 (관리자 전용)
// POST /api/dart-build {password}
// 처음 1회 또는 갱신이 필요할 때 실행. 약 5-10초 소요.

import { inflateRawSync, gzipSync } from 'zlib';
import Redis from 'ioredis';

const DART_BASE = 'https://opendart.fss.or.kr/api';
export const CACHE_KEY = 'dart:corp_map_v2';
export const CACHE_TTL = 7 * 24 * 60 * 60; // 7일

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { password } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: '인증 실패' });
  }

  const dartKey = process.env.DART_API_KEY;
  if (!dartKey) return res.status(500).json({ success: false, error: 'DART_API_KEY 미설정' });

  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    commandTimeout: 15000,
    maxRetriesPerRequest: 2,
  });

  try {
    // 1. DART corpCode.xml (ZIP) 다운로드
    console.log('[dart-build] Downloading corpCode.xml...');
    const url = `${DART_BASE}/corpCode.xml?crtfc_key=${dartKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`DART 다운로드 실패: HTTP ${resp.status}`);

    // 2. ZIP에서 XML 추출
    const zipBuf = Buffer.from(await resp.arrayBuffer());
    const xmlStr = extractFirstFileFromZip(zipBuf);
    console.log(`[dart-build] XML size: ${(xmlStr.length / 1024 / 1024).toFixed(1)}MB`);

    // 3. XML 파싱 → {정규화된이름: "corpCode1,corpCode2"} 맵
    const corpMap = parseCorpCodesXml(xmlStr);
    const count = Object.keys(corpMap).length;
    console.log(`[dart-build] Parsed ${count} companies`);

    // 4. GZIP 압축 후 Redis 저장 (용량 절약)
    const jsonStr = JSON.stringify(corpMap);
    const compressed = gzipSync(Buffer.from(jsonStr, 'utf8'));
    const b64 = compressed.toString('base64');
    console.log(`[dart-build] Storing ${(b64.length / 1024 / 1024).toFixed(1)}MB in Redis...`);

    await redis.set(CACHE_KEY, b64, 'EX', CACHE_TTL);

    return res.status(200).json({
      success: true,
      count,
      originalSize: `${(jsonStr.length / 1024 / 1024).toFixed(1)}MB`,
      compressedSize: `${(b64.length / 1024 / 1024).toFixed(1)}MB`,
      message: `✓ ${count.toLocaleString()}개 기업 캐시 완료`,
    });

  } catch (err) {
    console.error('[dart-build] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}

// ZIP에서 첫 번째 파일의 내용을 문자열로 반환
function extractFirstFileFromZip(buf) {
  for (let i = 0; i < buf.length - 4; i++) {
    // 로컬 파일 헤더 시그니처: PK 0x03 0x04
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
      const comp   = buf.readUInt16LE(i + 8);
      const cSize  = buf.readUInt32LE(i + 18);
      const fnLen  = buf.readUInt16LE(i + 26);
      const exLen  = buf.readUInt16LE(i + 28);
      const start  = i + 30 + fnLen + exLen;
      const data   = buf.slice(start, start + cSize);
      if (comp === 8) return inflateRawSync(data).toString('utf8');
      if (comp === 0) return data.toString('utf8');
      throw new Error(`지원하지 않는 압축 방식: ${comp}`);
    }
  }
  throw new Error('ZIP 파일 헤더를 찾을 수 없음');
}

// CORPCODE.xml 파싱 → {normalizedName: "corpCode[,corpCode2...]"}
function parseCorpCodesXml(xml) {
  const map = {};
  const parts = xml.split('<list>');
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const cs = p.indexOf('<corp_code>') + 11;
    const ce = p.indexOf('</corp_code>');
    const ns = p.indexOf('<corp_name>') + 11;
    const ne = p.indexOf('</corp_name>');
    if (cs < 11 || ns < 11 || ce < 0 || ne < 0) continue;
    const code = p.substring(cs, ce).trim();
    const name = p.substring(ns, ne).trim();
    if (!code || !name) continue;
    const key = normName(name);
    map[key] = map[key] ? map[key] + ',' + code : code;
  }
  return map;
}

export function normName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/주식회사/g, '').replace(/\(주\)/g, '').replace(/㈜/g, '')
    .replace(/[()（）\[\]\s\.,\-]/g, '');
}
