// 食物库匹配与营养换算。
// AI 只负责解析文本，命中判定完全在这里做（AGENTS.md 第七节）。
import type { FoodLibraryItem } from '../db/schema';
import type { ParsedItem } from '../types/ai';

export interface AppliedItem extends ParsedItem {
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
  dataSource: 'food_library' | 'ai_estimate';
  foodLibraryId?: string;
  /** 克数缺失：营养值只是临时占位，保存前必须补齐 */
  needsWeight: boolean;
}

/** 去掉全部空白并转小写：用户常带空格，库里的名字也未必规范 */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

/** 保留一位小数：按克数换算会产生 12.399999999 这类浮点尾巴，页面显示也要用同一套取整 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 匹配优先级：name 完全相等 > aliases 包含 name > 双向模糊包含。
 * 同级取食物库中靠前的一条，避免顺序不稳定导致同一输入命中不同结果。
 */
function matchFood(name: string, library: FoodLibraryItem[]): FoodLibraryItem | undefined {
  const key = normalizeName(name);
  if (key === '') {
    return undefined;
  }

  const exact = library.find((food) => normalizeName(food.name) === key);
  if (exact) {
    return exact;
  }

  const byAlias = library.find((food) => food.aliases.some((alias) => normalizeName(alias) === key));
  if (byAlias) {
    return byAlias;
  }

  return library.find((food) => {
    const foodName = normalizeName(food.name);
    return foodName !== '' && (foodName.includes(key) || key.includes(foodName));
  });
}

export function applyFoodLibrary(items: ParsedItem[], library: FoodLibraryItem[]): AppliedItem[] {
  return items.map((item) => {
    const matched = matchFood(item.name, library);

    if (matched && item.weightG !== null) {
      const ratio = item.weightG / matched.perAmount;
      return {
        ...item,
        proteinG: round1(matched.proteinG * ratio),
        carbG: round1(matched.carbG * ratio),
        fatG: round1(matched.fatG * ratio),
        kcal: round1(matched.kcal * ratio),
        dataSource: 'food_library',
        foodLibraryId: matched.id,
        needsWeight: false,
      } satisfies AppliedItem;
    }

    if (matched) {
      // 命中但没克数：先用 AI 估算占位。foodLibraryId 保留下来，
      // 用户在确认卡片里补上克数后就能按食物库重算。
      return {
        ...item,
        ...item.estimated,
        dataSource: 'food_library',
        foodLibraryId: matched.id,
        needsWeight: true,
      } satisfies AppliedItem;
    }

    return {
      ...item,
      ...item.estimated,
      dataSource: 'ai_estimate',
      needsWeight: item.weightG === null,
    } satisfies AppliedItem;
  });
}

export function calcKcalFromPFC(proteinG: number, carbG: number, fatG: number): number {
  // 公式本身是 4/4/9，外面套一层 round1 只是抹掉二进制浮点尾巴（3.6*9 = 32.400000000000006）
  return round1(proteinG * 4 + carbG * 4 + fatG * 9);
}

export function validateItems(items: AppliedItem[]): string[] {
  const messages: string[] = [];

  for (const item of items) {
    // 0 和负数同样没法换算，和 null 一起挡掉，否则会存进一条 0 克的记录
    if (item.weightG === null || !Number.isFinite(item.weightG) || item.weightG <= 0) {
      messages.push(`「${item.name}」缺少克数`);
    }
    if (item.proteinG === 0 && item.carbG === 0 && item.fatG === 0 && item.kcal === 0) {
      messages.push(`「${item.name}」营养数据异常`);
    }
  }

  return messages;
}
