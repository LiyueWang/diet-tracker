// 日期时间的本地格式化。
// 多个页面都要拼这些字符串，集中在一处，避免各写各的导致格式跑偏
// （AGENTS.md 第六节：日期 YYYY-MM-DD，时间 HH:mm）。

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function nowHhMm(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** 页面顶部展示用，带上星期几 */
export function describeDay(now: Date = new Date()): string {
  return `${todayIso(now)} ${WEEKDAYS[now.getDay()]}`;
}
