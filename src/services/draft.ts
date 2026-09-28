// 未保存内容的本地暂存。
// 用 sessionStorage 而不是 localStorage：草稿只在当前标签页会话里有意义，
// 关掉标签页就该消失，不需要长期驻留，也不会跨标签页互相覆盖。
import type { Meal } from '../db/schema';
import type { AppliedItem } from './nutrition';

export interface DraftData {
  rawText: string;
  items: AppliedItem[];
  mealType: Meal['mealType'];
  time: string;
  parsed: boolean;
  /** ISO 时间：既用于 24 小时过期判断，也方便排查问题时看草稿是什么时候的 */
  savedAt: string;
}

const NEW_DRAFT_KEY = 'draft:record:new';
const EDIT_DRAFT_PREFIX = 'draft:record:edit:';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MEAL_TYPES: ReadonlyArray<Meal['mealType']> = ['breakfast', 'lunch', 'dinner', 'snack'];

export function makeNewDraftKey(): string {
  return NEW_DRAFT_KEY;
}

export function makeEditDraftKey(mealId: string): string {
  return `${EDIT_DRAFT_PREFIX}${mealId}`;
}

/**
 * 结构校验。草稿只会由同版本代码写出，形状不符说明数据被改坏或版本不兼容，
 * 与其带着半个对象进页面（字段 undefined、NaN 混进计算），不如整条丢掉。
 */
function isValidDraft(value: unknown): value is DraftData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const draft = value as Record<string, unknown>;
  if (
    typeof draft.rawText !== 'string' ||
    typeof draft.time !== 'string' ||
    typeof draft.parsed !== 'boolean' ||
    typeof draft.savedAt !== 'string'
  ) {
    return false;
  }
  if (!MEAL_TYPES.includes(draft.mealType as Meal['mealType'])) {
    return false;
  }
  if (!Array.isArray(draft.items)) {
    return false;
  }
  return draft.items.every((item) => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }
    const row = item as Record<string, unknown>;
    return (
      typeof row.name === 'string' &&
      (typeof row.weightG === 'number' || row.weightG === null) &&
      typeof row.proteinG === 'number' &&
      typeof row.carbG === 'number' &&
      typeof row.fatG === 'number' &&
      typeof row.kcal === 'number'
    );
  });
}

export function saveDraft(key: string, data: DraftData): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (cause) {
    // 隐私模式或配额满时 setItem 会抛错；草稿只是保险，不能因为写不进去把页面带崩
    console.warn(`[draft] 草稿写入失败（${key}）:`, cause);
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch (cause) {
    console.warn(`[draft] 草稿清除失败（${key}）:`, cause);
  }
}

/** 读不到、解析失败、结构不符、超过 24 小时，一律返回 null 并顺手清掉 */
export function loadDraft(key: string): DraftData | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(key);
  } catch (cause) {
    console.warn(`[draft] 草稿读取失败（${key}）:`, cause);
    return null;
  }
  if (raw === null) {
    return null;
  }

  const discard = (reason: string): null => {
    console.warn(`[draft] 丢弃已损坏或过期的草稿（${key}）: ${reason}`);
    clearDraft(key);
    return null;
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    return discard(`JSON 解析失败 ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (!isValidDraft(parsed)) {
    return discard('结构不符');
  }

  const savedAtMs = Date.parse(parsed.savedAt);
  if (Number.isNaN(savedAtMs)) {
    return discard('savedAt 不是合法时间');
  }
  if (Date.now() - savedAtMs > DRAFT_TTL_MS) {
    return discard('超过 24 小时');
  }

  return parsed;
}
