import { gzipSync, gunzipSync } from 'zlib';
import Redis from 'ioredis';

const CACHE_KEY = 'dart:corp_map_v2';
const CACHE_TTL = 7 * 24 * 60 * 60;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const { password, corpMap, append = false } = req.body || {};

  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ success: false, error: '인증 실패' });
  if (!corpMap || typeof corpMap !== 'object')
    return res.status(400).json({ success: false, error: '유효하지 않은 데이터' });

  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    connectTimeout: 5000,
    commandTimeout: 15000,
    maxRetriesPerRequest: 2,
  });

  try {
    let merged = corpMap;

    // append 모드: 기존 캐시에 병합
    if (append) {
      const existing = await redis.get(CACHE_KEY);
      if (existing) {
        try {
          const prev = JSON.parse(gunzipSync(Buffer.from(existing, 'base64')).toString('utf8'));
          merged = { ...prev, ...corpMap };
        } catch (_) { merged = corpMap; }
      }
    }

    const json = JSON.stringify(merged);
    const compressed = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
    await redis.set(CACHE_KEY, compressed, 'EX', CACHE_TTL);

    const count = Object.keys(merged).length;
    return res.json({
      success: true,
      count,
      originalSize: `${(json.length/1024/1024).toFixed(1)}MB`,
      compressedSize: `${(compressed.length/1024).toFixed(0)}KB`,
    });
  } catch (err) {
    console.error('[dart-save-corp-map]', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    try { redis.disconnect(); } catch (_) {}
  }
}
