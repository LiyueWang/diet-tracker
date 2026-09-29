/**
 * 名称排序：统一走 `localeCompare`（浏览器 ICU，中文按拼音）。
 * 不用 IndexedDB 的 name 索引顺序 —— 那是按字符码点排的，中文用户会觉得"排得莫名其妙"：
 * 比如拼音序里「鸡蛋」在「鸡胸肉」前面，码点序里正好反过来。
 */
export function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

export function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort(compareByName);
}
