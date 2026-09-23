// src/db/repo.ts
// 唯一数据访问层：页面与组件只能通过本文件读写 IndexedDB，不要直接调 db.*
import type { Table } from 'dexie';

import { db } from './schema';
import type {
  FoodItem,
  FoodLibraryItem,
  Meal,
  NutritionPlan,
  Profile,
  Report,
  SupplementPlan,
} from './schema';

/** Profile 是单行表，主键固定为 'me' */
const PROFILE_ID = 'me';

// ---------------- 通用工具 ----------------

/**
 * 给每个操作补上"是谁失败了"的上下文再抛出。
 * 页面层直接拿到裸的 Dexie 错误时无法判断是哪个操作出的问题；
 * 这里不吞错误，cause 保留原始错误供上层按类型判断。
 */
async function withRepoContext<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[repo] ${operation} 失败: ${message}`, { cause: error });
  }
}

/**
 * 用读-合并-写实现局部更新，而不是直接把 patch 丢给 table.update：
 * 一是保证 updatedAt 一定被刷新，二是目标不存在时能报错，避免"静默成功"的假象。
 */
async function patchRow<T extends { id: string; updatedAt: string }>(
  table: Table<T, string>,
  label: string,
  id: string,
  patch: Partial<Omit<T, 'id' | 'updatedAt'>>,
): Promise<void> {
  const existing = await table.get(id);
  if (!existing) {
    throw new Error(`${label}不存在: ${id}`);
  }
  const next: T = { ...existing, ...patch, id: existing.id, updatedAt: new Date().toISOString() };
  await table.put(next);
}

/** 食物名归一化：去掉全部空白并转小写，"鸡胸肉 "和"鸡 胸肉"要能命中同一条 */
function normalizeFoodName(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase();
}

// ---------------- 入参类型 ----------------
// 所有入参类型都排除 id / createdAt / updatedAt：这些字段由本层统一生成，调用方无权覆盖。

export type MealInput = Omit<Meal, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>;
export type MealPatch = Partial<Omit<Meal, 'id' | 'createdAt' | 'updatedAt'>>;

export type FoodItemInput = Omit<FoodItem, 'id' | 'mealId' | 'createdAt' | 'updatedAt'>;
export type FoodItemPatch = Partial<Omit<FoodItem, 'id' | 'mealId' | 'createdAt' | 'updatedAt'>>;

export type FoodLibraryInput = Omit<FoodLibraryItem, 'id' | 'updatedAt' | 'perAmount' | 'perUnit'> & {
  perAmount?: number;
  perUnit?: 'g';
};
export type FoodLibraryPatch = Partial<Omit<FoodLibraryItem, 'id' | 'updatedAt'>>;

export type NutritionPlanInput = Omit<NutritionPlan, 'id' | 'updatedAt' | 'active'> & { active?: 0 | 1 };
export type NutritionPlanPatch = Partial<Omit<NutritionPlan, 'id' | 'updatedAt'>>;

export type SupplementPlanInput = Omit<SupplementPlan, 'id' | 'updatedAt' | 'active'> & { active?: 0 | 1 };
export type SupplementPlanPatch = Partial<Omit<SupplementPlan, 'id' | 'updatedAt'>>;

export type ReportInput = Omit<Report, 'id' | 'generatedAt'> & { generatedAt?: string };

export type ProfilePatch = Partial<Omit<Profile, 'id' | 'updatedAt'>>;

// ---------------- meals ----------------

export async function createMeal(input: MealInput): Promise<Meal> {
  return withRepoContext('createMeal', async () => {
    const now = new Date().toISOString();
    const meal: Meal = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      deleted: 0,
    };
    await db.meals.add(meal);
    return meal;
  });
}

export async function getMealsByDate(date: string): Promise<Meal[]> {
  return withRepoContext('getMealsByDate', async () => {
    const meals = await db.meals.where('date').equals(date).toArray();
    // deleted 是 0/1 而非布尔，索引表达不了"未删除"，只能在取回后过滤
    return meals.filter((meal) => meal.deleted === 0).sort((a, b) => a.time.localeCompare(b.time));
  });
}

export async function updateMeal(id: string, patch: MealPatch): Promise<void> {
  await withRepoContext('updateMeal', () => patchRow(db.meals, '餐次', id, patch));
}

export async function softDeleteMeal(id: string): Promise<void> {
  // Meal 有 deleted 字段，按项目约定走逻辑删除，数据保留以便回溯历史统计
  await withRepoContext('softDeleteMeal', () => patchRow(db.meals, '餐次', id, { deleted: 1 }));
}

// ---------------- foodItems ----------------

export async function addFoodItems(mealId: string, items: FoodItemInput[]): Promise<FoodItem[]> {
  return withRepoContext('addFoodItems', async () => {
    const meal = await db.meals.get(mealId);
    if (!meal) {
      throw new Error(`所属餐次不存在: ${mealId}`);
    }

    const now = new Date().toISOString();
    const rows: FoodItem[] = items.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      mealId,
      createdAt: now,
      updatedAt: now,
    }));
    if (rows.length === 0) {
      return rows;
    }
    await db.foodItems.bulkAdd(rows);
    return rows;
  });
}

export async function getItemsByMealId(mealId: string): Promise<FoodItem[]> {
  return withRepoContext('getItemsByMealId', () =>
    db.foodItems.where('mealId').equals(mealId).sortBy('createdAt'),
  );
}

export async function updateFoodItem(id: string, patch: FoodItemPatch): Promise<void> {
  await withRepoContext('updateFoodItem', () => patchRow(db.foodItems, '食物条目', id, patch));
}

export async function deleteItemsByMealId(mealId: string): Promise<number> {
  // 物理删除（非逻辑删除）：FoodItem 表没有 deleted 字段，软删除状态无处存放。
  // 条目是餐次的从属数据，随餐次清掉不会丢失独立的历史信息。
  return withRepoContext('deleteItemsByMealId', () =>
    db.foodItems.where('mealId').equals(mealId).delete(),
  );
}

// ---------------- foodLibrary ----------------

export async function addFood(input: FoodLibraryInput): Promise<FoodLibraryItem> {
  return withRepoContext('addFood', async () => {
    const food: FoodLibraryItem = {
      ...input,
      id: crypto.randomUUID(),
      perAmount: input.perAmount ?? 100,
      perUnit: 'g',
      updatedAt: new Date().toISOString(),
    };
    await db.foodLibrary.add(food);
    return food;
  });
}

export async function listFoodLibrary(): Promise<FoodLibraryItem[]> {
  return withRepoContext('listFoodLibrary', () => db.foodLibrary.orderBy('name').toArray());
}

export async function updateFood(id: string, patch: FoodLibraryPatch): Promise<void> {
  await withRepoContext('updateFood', () => patchRow(db.foodLibrary, '食物库条目', id, patch));
}

export async function deleteFood(id: string): Promise<void> {
  // 物理删除（非逻辑删除）：FoodLibraryItem 没有 deleted 字段。
  // 引用过它的 FoodItem 已把营养值复制成自己的字段，删除食物库条目不会让历史记录失真。
  await withRepoContext('deleteFood', async () => {
    await db.foodLibrary.delete(id);
  });
}

export async function findFoodByName(name: string): Promise<FoodLibraryItem | undefined> {
  return withRepoContext('findFoodByName', async () => {
    const key = normalizeFoodName(name);
    if (!key) {
      return undefined;
    }
    // 归一化后比较无法走索引（*aliases 只支持原始值精确匹配），
    // 个人食物库在几百条量级，全表扫描的成本可以接受。
    const foods = await db.foodLibrary.toArray();
    // 先给 name 命中，其次才是 alias，避免别名把正式名挤掉
    const byName = foods.find((food) => normalizeFoodName(food.name) === key);
    if (byName) {
      return byName;
    }
    return foods.find((food) => food.aliases.some((alias) => normalizeFoodName(alias) === key));
  });
}

// ---------------- nutritionPlans ----------------

export async function addPlan(input: NutritionPlanInput): Promise<NutritionPlan> {
  return withRepoContext('addPlan', async () => {
    const plan: NutritionPlan = {
      ...input,
      id: crypto.randomUUID(),
      // 新方案默认不激活：active 的唯一性统一由 setActivePlan 维护
      active: input.active ?? 0,
      updatedAt: new Date().toISOString(),
    };
    await db.nutritionPlans.add(plan);
    return plan;
  });
}

export async function listPlans(): Promise<NutritionPlan[]> {
  return withRepoContext('listPlans', () =>
    db.nutritionPlans.orderBy('updatedAt').reverse().toArray(),
  );
}

export async function updatePlan(id: string, patch: NutritionPlanPatch): Promise<void> {
  await withRepoContext('updatePlan', () => patchRow(db.nutritionPlans, '营养方案', id, patch));
}

export async function setActivePlan(id: string): Promise<void> {
  await withRepoContext('setActivePlan', () =>
    db.transaction('rw', db.nutritionPlans, async () => {
      const target = await db.nutritionPlans.get(id);
      // 先校验再改，配合事务回滚：目标不存在时不会留下"所有方案都被置 0"的中间状态
      if (!target) {
        throw new Error(`营养方案不存在: ${id}`);
      }

      const now = new Date().toISOString();
      await db.nutritionPlans.toCollection().modify((plan) => {
        if (plan.id === id || plan.active === 0) {
          return;
        }
        plan.active = 0;
        plan.updatedAt = now;
      });
      await db.nutritionPlans.update(id, { active: 1, updatedAt: now });
    }),
  );
}

export async function getActivePlan(): Promise<NutritionPlan | undefined> {
  return withRepoContext('getActivePlan', () => db.nutritionPlans.where('active').equals(1).first());
}

// ---------------- supplementPlans ----------------

export async function addSupplement(input: SupplementPlanInput): Promise<SupplementPlan> {
  return withRepoContext('addSupplement', async () => {
    const supplement: SupplementPlan = {
      ...input,
      id: crypto.randomUUID(),
      // 补剂没有 setActive 这类切换入口，默认就激活，否则新增后在"启用中"的视图里找不到
      active: input.active ?? 1,
      updatedAt: new Date().toISOString(),
    };
    await db.supplementPlans.add(supplement);
    return supplement;
  });
}

export async function listSupplements(): Promise<SupplementPlan[]> {
  return withRepoContext('listSupplements', () =>
    db.supplementPlans.orderBy('updatedAt').reverse().toArray(),
  );
}

export async function updateSupplement(id: string, patch: SupplementPlanPatch): Promise<void> {
  await withRepoContext('updateSupplement', () =>
    patchRow(db.supplementPlans, '补剂方案', id, patch),
  );
}

export async function deleteSupplement(id: string): Promise<void> {
  // 物理删除（非逻辑删除）：SupplementPlan 没有 deleted 字段；
  // 已记录进 FoodItem 的营养值不受影响，删除方案不会改变历史数据。
  await withRepoContext('deleteSupplement', async () => {
    await db.supplementPlans.delete(id);
  });
}

// ---------------- reports ----------------

export async function saveReport(input: ReportInput): Promise<Report> {
  return withRepoContext('saveReport', () =>
    db.transaction('rw', db.reports, async () => {
      const generatedAt = input.generatedAt ?? new Date().toISOString();
      // 同一 reportType + dateStart 视为同一份报告：重新生成应当覆盖而不是堆积，
      // 否则 getReport 在重复生成后取到哪一份是不确定的。
      const existing = await db.reports
        .where('reportType')
        .equals(input.reportType)
        .filter((report) => report.dateStart === input.dateStart)
        .first();

      if (existing) {
        const updated: Report = { ...existing, ...input, generatedAt };
        await db.reports.put(updated);
        return updated;
      }

      const report: Report = { ...input, id: crypto.randomUUID(), generatedAt };
      await db.reports.add(report);
      return report;
    }),
  );
}

export async function getReport(
  reportType: Report['reportType'],
  dateStart: string,
): Promise<Report | undefined> {
  return withRepoContext('getReport', () =>
    db.reports
      .where('reportType')
      .equals(reportType)
      .filter((report) => report.dateStart === dateStart)
      .first(),
  );
}

export async function listReports(reportType: Report['reportType']): Promise<Report[]> {
  return withRepoContext('listReports', async () => {
    const reports = await db.reports.where('reportType').equals(reportType).sortBy('generatedAt');
    // 报告列表按时间倒序更符合"最近生成的在最上面"的预期
    return reports.reverse();
  });
}

// ---------------- profile ----------------

export async function getProfile(): Promise<Profile | undefined> {
  return withRepoContext('getProfile', () => db.profile.get(PROFILE_ID));
}

export async function saveProfile(patch: ProfilePatch): Promise<Profile> {
  return withRepoContext('saveProfile', () =>
    db.transaction('rw', db.profile, async () => {
      const existing = await db.profile.get(PROFILE_ID);
      // Profile 只有一行且字段会分阶段填写，用读-合并-写让 patch 语义成立，
      // 直接 put 会把本次没传的字段（比如上一次填的身高）抹掉。
      const next: Profile = {
        ...existing,
        ...patch,
        id: PROFILE_ID,
        updatedAt: new Date().toISOString(),
      };
      await db.profile.put(next);
      return next;
    }),
  );
}
