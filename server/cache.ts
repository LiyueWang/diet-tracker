// 内存缓存 + 每日调用限流。
// 进程重启后计数与缓存都会清空 —— 第一版是纯本地单进程工具，够用且不引入额外依赖。

type CacheEntry = {
  data: unknown;
  expireAt: number;
};

const cache = new Map<string, CacheEntry>();

const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_CACHE_TTL_HOURS = 24;

let counterDate = todayKey();
let counterUsed = 0;

/** 本地日期（YYYY-MM-DD）：跨天重置要按用户所在时区算，不能用 UTC */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 日期变了就把当日计数清零 */
function ensureToday(): void {
  const today = todayKey();
  if (today !== counterDate) {
    counterDate = today;
    counterUsed = 0;
  }
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * FNV-1a 32 位字符串 hash，转成十六进制。
 * 额外拼上长度：单靠 32 位 hash 在缓存条目变多后碰撞概率不可忽略，
 * 而碰撞会让不同的饮食文本命中同一份解析结果。
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${input.length}`;
}

export function getCacheTtlHours(): number {
  return readEnvNumber('AI_CACHE_TTL_HOURS', DEFAULT_CACHE_TTL_HOURS);
}

export function getDailyLimit(): number {
  return Math.floor(readEnvNumber('AI_DAILY_LIMIT', DEFAULT_DAILY_LIMIT));
}

/** 命中返回数据，未命中或已过期返回 null（过期条目顺手清掉，避免 Map 无限增长） */
export function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expireAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache(key: string, data: unknown, ttlHours: number): void {
  cache.set(key, { data, expireAt: Date.now() + ttlHours * 60 * 60 * 1000 });
}

export function canCall(): boolean {
  ensureToday();
  return counterUsed < getDailyLimit();
}

export function incrementCall(): void {
  ensureToday();
  counterUsed += 1;
}

export function getStatus(): { used: number; limit: number; date: string } {
  ensureToday();
  return { used: counterUsed, limit: getDailyLimit(), date: counterDate };
}
