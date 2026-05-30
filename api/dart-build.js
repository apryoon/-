// DART corpCode.xml 다운로드 → 파싱 → Redis 저장
// POST /api/dart-build {password}

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
    // 1. ZIP 다운로드
    const resp = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${dartKey}`);
    if (!resp.ok) throw new Error(`DART HTTP ${resp.status}`);
    const zipBuf = Buffer.from(await resp.arrayBuffer());
    console.log(`[dart-build] ZIP size: ${zipBuf.length} bytes`);

    // 2. ZIP 해제 (Central Directory 기반 — bit3 플래그 문제 완전 해결)
    const xml = extractFromZipCentralDir(zipBuf);
    console.log(`[dart-build] XML size: ${xml.length} chars`);

    // 3. XML 파싱
    const corpMap = parseCorpCodesXml(xml);
    const count = Object.keys(corpMap).length;
    console.log(`[dart-build] Parsed: ${count} companies`);

    // 4. GZIP 압축 후 Redis 저장
    const json = JSON.stringify(corpMap);
    const compressed = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
    await redis.set(CACHE_KEY, compressed, 'EX', 7 * 24 * 60 * 60);

    return res.json({
      success: true,
      count,
      size: `${(compressed.length / 1024).toFixed(0)}KB`,
      message: `✅ ${count.toLocaleString()}개 기업 캐시 완료`,
    });
  } catch (err) {
    console.error('[dart-build] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}

/**
 * ZIP Central Directory를 이용한 안전한 파일 추출
 * - Local File Header의 compressed size가 0인 경우(bit3 flag)도 처리
 * - EOCD → Central Directory → Local Header 순으로 신뢰할 수 있는 크기 사용
 */
function extractFromZipCentralDir(buf) {
  // 1. EOCD(End of Central Directory) 찾기 — 파일 끝에서부터 역방향 탐색
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf[i]===0x50 && buf[i+1]===0x4B && buf[i+2]===0x05 && buf[i+3]===0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD(End of Central Directory)를 찾을 수 없습니다');

  // 2. Central Directory 위치와 크기
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf[cdOffset]!==0x50 || buf[cdOffset+1]!==0x4B ||
      buf[cdOffset+2]!==0x01 || buf[cdOffset+3]!==0x02) {
    throw new Error('Central Directory 시그니처 오류');
  }

  // 3. Central Directory 첫 번째 항목에서 정확한 compressed size와 local header offset 읽기
  const compression    = buf.readUInt16LE(cdOffset + 10);
  const compressedSize = buf.readUInt32LE(cdOffset + 20); // 항상 정확한 값
  const localOffset    = buf.readUInt32LE(cdOffset + 42); // local file header 위치

  console.log(`[dart-build] compression=${compression}, compressedSize=${compressedSize}`);

  if (compressedSize === 0) throw new Error('compressedSize가 0 (ZIP64 포맷일 수 있음)');

  // 4. Local File Header에서 실제 데이터 시작 위치 계산
  const fnLen  = buf.readUInt16LE(localOffset + 26);
  const exLen  = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fnLen + exLen;

  // 5. 압축 데이터 추출 및 해제
  const compressedData = buf.slice(dataStart, dataStart + compressedSize);
  if (compressedData.length < compressedSize) {
    throw new Error(`데이터 부족: 필요 ${compressedSize}, 실제 ${compressedData.length}`);
  }

  if (compression === 8) return inflateRawSync(compressedData).toString('utf8');
  if (compression === 0) return compressedData.toString('utf8');
  throw new Error(`지원하지 않는 압축 방식: ${compression}`);
}

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
