// 报告的本地聚合与生成。
// 所有汇总、达标判断、PFC 占比都在这里算：页面只负责画，不重复计算。
import type { FoodItem, Meal, Report } from '../db/schema';
import {
  getActivePlan,
  getItemsByMealId,
  getMealsByDate,
  getReport,
  listSupplements,
  saveReport,
} from '../db/repo';
import { generateReport as requestAiReport } from './ai';
import { todayIso } from './date';
import { recalcKcal, round1 } from './nutrition';

export interface NutritionTotals {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}

export interface MealSection {
  items: FoodItem[];
  totals: NutritionTotals;
}

export interface SupplementTaken {
  name: string;
  amountG: number | null;
  timing?: string;
}

export interface DailyAggregate {
  date: string;
  intake: NutritionTotals;
  /** 补剂单独统计一份贡献，方便报告里拆开看 */
  supplementIntake: NutritionTotals;
  target: NutritionTotals | null;
  mealsByType: Record<Meal['mealType'], MealSection>;
  supplementsTaken: SupplementTaken[];
}

export interface WeeklyAggregate {
  startDate: string;
  endDate: string;
  daily: DailyAggregate[];
  average: NutritionTotals;
  target: NutritionTotals | null;
  /** 热量落在目标 ±10% 内的天数（只统计有记录的天） */
  daysOnTarget: number;
  /** 有记录的天数 */
  daysLogged: number;
  /**
   * 达标比例，**分母是 daysLogged 而不是区间天数** ——
   * "7 天里记了 3 天、其中 2 天达标"应该是 66.7%，除以 7 会显示成 28.6%，看着像系统坏了。
   * 一天都没记录时为 null，页面显示"—"而不是 0%。
   */
  daysOnTargetPercent: number | null;
}

export interface PfcKcalBreakdown {
  proteinKcal: number;
  carbKcal: number;
  fatKcal: number;
  totalKcal: number;
  proteinPercent: number;
  carbPercent: number;
  fatPercent: number;
}

const MEAL_TYPES: ReadonlyArray<Meal['mealType']> = ['breakfast', 'lunch', 'dinner', 'snack'];
const ZERO_TOTALS: NutritionTotals = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 };
const TARGET_TOLERANCE = 0.1;
const PROTEIN_TARGET_RATIO = 0.9;

function emptySection(): MealSection {
  return { items: [], totals: { ...ZERO_TOTALS } };
}

/** 累加一条条目。kcal 一律由 P/F/C 派生（方案 2），不读 item.kcal 这个存量字段 */
function addItem(totals: NutritionTotals, item: FoodItem): NutritionTotals {
  return {
    kcal: round1(totals.kcal + recalcKcal(item.proteinG, item.carbG, item.fatG)),
    proteinG: round1(totals.proteinG + item.proteinG),
    carbG: round1(totals.carbG + item.carbG),
    fatG: round1(totals.fatG + item.fatG),
  };
}

/**
 * 有记录 = 这一天至少有一条条目（空餐次不算记录）。
 * 导出给页面用：折线图上"没记录的一天"要断开而不是画成 0
 * （0 kcal 同样可能是"确实吃了但记成了 0"，不能拿 0 当空值）。
 */
export function isDayLogged(day: DailyAggregate): boolean {
  return MEAL_TYPES.some((type) => day.mealsByType[type].items.length > 0);
}

/**
 * PFC 占比用 **kcal 口径**（P×4 / C×4 / F×9），不是克数占比 ——
 * 蛋白质 100g 和脂肪 100g 的克数一样，热量贡献差了 2.25 倍，按克数算会严重失真。
 */
export function calcPfcKcal(totals: Pick<NutritionTotals, 'proteinG' | 'carbG' | 'fatG'>): PfcKcalBreakdown {
  const proteinKcal = round1(totals.proteinG * 4);
  const carbKcal = round1(totals.carbG * 4);
  const fatKcal = round1(totals.fatG * 9);
  const totalKcal = round1(proteinKcal + carbKcal + fatKcal);
  const percent = (part: number): number => (totalKcal > 0 ? Math.round((part / totalKcal) * 100) : 0);
  return {
    proteinKcal,
    carbKcal,
    fatKcal,
    totalKcal,
    proteinPercent: percent(proteinKcal),
    carbPercent: percent(carbKcal),
    fatPercent: percent(fatKcal),
  };
}

/** 目标 ±10% 内算达标 */
export function isKcalOnTarget(kcal: number, target: NutritionTotals | null): boolean {
  if (target === null || target.kcal <= 0) {
    return false;
  }
  return Math.abs(kcal - target.kcal) <= target.kcal * TARGET_TOLERANCE;
}

/**
 * 蛋白质达标只看下限（≥ 目标的 90%）：
 * 热量吃超了要提醒，蛋白质吃超了不是问题，用 ±10% 会把"练得多吃得也多"判成不达标。
 */
export function isProteinOnTarget(proteinG: number, target: NutritionTotals | null): boolean {
  if (target === null || target.proteinG <= 0) {
    return false;
  }
  return proteinG >= target.proteinG * PROTEIN_TARGET_RATIO;
}

export async function aggregateDaily(date: string): Promise<DailyAggregate> {
  const [meals, plans, activePlan] = await Promise.all([getMealsByDate(date), listSupplements(), getActivePlan()]);
  const withItems = await Promise.all(
    meals.map(async (meal) => ({ meal, items: await getItemsByMealId(meal.id) })),
  );

  const mealsByType: Record<Meal['mealType'], MealSection> = {
    breakfast: emptySection(),
    lunch: emptySection(),
    dinner: emptySection(),
    snack: emptySection(),
  };
  let intake: NutritionTotals = { ...ZERO_TOTALS };
  let supplementIntake: NutritionTotals = { ...ZERO_TOTALS };
  const supplementsTaken: SupplementTaken[] = [];

  for (const { meal, items } of withItems) {
    const section = mealsByType[meal.mealType];
    for (const item of items) {
      section.items.push(item);
      section.totals = addItem(section.totals, item);
      intake = addItem(intake, item);

      if (item.itemType === 'supplement') {
        supplementIntake = addItem(supplementIntake, item);
        // timing 存在方案里，不在条目上；方案被删过就留空，不影响统计
        const plan = item.supplementPlanId ? plans.find((candidate) => candidate.id === item.supplementPlanId) : undefined;
        supplementsTaken.push({
          name: item.name,
          amountG: item.weightG,
          ...(plan?.timing !== undefined && plan.timing !== '' ? { timing: plan.timing } : {}),
        });
      }
    }
  }

  return {
    date,
    intake,
    supplementIntake,
    target:
      activePlan === undefined
        ? null
        : {
            kcal: activePlan.targetKcal,
            proteinG: activePlan.targetProteinG,
            carbG: activePlan.targetCarbG,
            fatG: activePlan.targetFatG,
          },
    mealsByType,
    supplementsTaken,
  };
}

/** 起止日期（含两端）展开成日期数组，按本地日期算 */
function listDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return dates;
  }
  while (cursor <= end) {
    dates.push(todayIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export async function aggregateWeekly(startDate: string, endDate: string): Promise<WeeklyAggregate> {
  const dates = listDates(startDate, endDate);
  const daily = await Promise.all(dates.map((date) => aggregateDaily(date)));
  const loggedDays = daily.filter(isDayLogged);

  // 平均值除以"有记录的天数"：把没记录的日子当 0 算进平均没有意义
  const average: NutritionTotals =
    loggedDays.length === 0
      ? { ...ZERO_TOTALS }
      : {
          kcal: round1(loggedDays.reduce((sum, day) => sum + day.intake.kcal, 0) / loggedDays.length),
          proteinG: round1(loggedDays.reduce((sum, day) => sum + day.intake.proteinG, 0) / loggedDays.length),
          carbG: round1(loggedDays.reduce((sum, day) => sum + day.intake.carbG, 0) / loggedDays.length),
          fatG: round1(loggedDays.reduce((sum, day) => sum + day.intake.fatG, 0) / loggedDays.length),
        };

  return {
    startDate,
    endDate,
    daily,
    average,
    // 七天读的是同一份 active plan，取第一天即可
    target: daily[0]?.target ?? null,
    // 没记录的日子不可能是"达标"，所以只在有记录的天里数
    daysOnTarget: loggedDays.filter((day) => isKcalOnTarget(day.intake.kcal, day.target)).length,
    daysLogged: loggedDays.length,
    daysOnTargetPercent:
      loggedDays.length === 0
        ? null
        : Math.round((loggedDays.filter((day) => isKcalOnTarget(day.intake.kcal, day.target)).length / loggedDays.length) * 1000) / 10,
  };
}

/**
 * 传给 AI 的 payload 只带汇总，不带逐条食物明细 ——
 * 报告生成不需要"具体吃了什么"，控制 token 也避免模型编造细节。
 */
function toDailyPayload(aggregate: DailyAggregate): Record<string, unknown> {
  return {
    date: aggregate.date,
    hasRecords: isDayLogged(aggregate),
    intake: aggregate.intake,
    target: aggregate.target,
    supplementIntake: aggregate.supplementIntake,
    supplementsTaken: aggregate.supplementsTaken,
    mealsByType: Object.fromEntries(
      MEAL_TYPES.map((type) => [
        type,
        { totals: aggregate.mealsByType[type].totals, itemCount: aggregate.mealsByType[type].items.length },
      ]),
    ),
  };
}

function toWeeklyPayload(weekly: WeeklyAggregate): Record<string, unknown> {
  return {
    startDate: weekly.startDate,
    endDate: weekly.endDate,
    hasRecords: weekly.daysLogged > 0,
    average: weekly.average,
    target: weekly.target,
    daysLogged: weekly.daysLogged,
    daysOnTarget: weekly.daysOnTarget,
    daily: weekly.daily.map((day) => ({
      date: day.date,
      intake: day.intake,
      supplementIntake: day.supplementIntake,
      hasRecords: isDayLogged(day),
    })),
  };
}

function sameTotals(a: NutritionTotals, b: NutritionTotals): boolean {
  return a.kcal === b.kcal && a.proteinG === b.proteinG && a.carbG === b.carbG && a.fatG === b.fatG;
}

/** 把七天的 intake 加成一份合计；缺字段的快照返回 null，调用方按"无法比对"处理 */
function sumDailyIntake(days: DailyAggregate[]): NutritionTotals | null {
  const total: NutritionTotals = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 };
  for (const day of days) {
    if (day === null || day === undefined || day.intake === undefined) {
      return null;
    }
    total.kcal += day.intake.kcal;
    total.proteinG += day.intake.proteinG;
    total.carbG += day.intake.carbG;
    total.fatG += day.intake.fatG;
  }
  return total;
}

/**
 * 报告是否已经过期：报告存的是生成那一刻的快照，生成之后当天数据又变过就该提示重新生成。
 * 判据用"总摄入 + 补剂 + 各餐次条目数"，而不是比时间戳 ——
 * 删除记录不会产生更新的时间戳，但总数和条目数会变，比时间戳可靠。
 */
export function isReportStale(report: Report, current: DailyAggregate): boolean {
  const stored = report.content as Partial<DailyAggregate> | null | undefined;
  if (stored === null || stored === undefined || stored.intake === undefined || stored.mealsByType === undefined) {
    // 老格式/损坏的快照没有可比对的内容，宁可不提示也不要误报
    return false;
  }

  if (!sameTotals(stored.intake, current.intake)) {
    return true;
  }
  if (stored.supplementIntake !== undefined && !sameTotals(stored.supplementIntake, current.supplementIntake)) {
    return true;
  }
  // 总热量一样但条目在餐次之间搬过家（午→晚），各餐次明细同样过期了
  return MEAL_TYPES.some(
    (type) => (stored.mealsByType?.[type]?.items.length ?? 0) !== current.mealsByType[type].items.length,
  );
}

/**
 * 周报是否已经过期。跟日报同源，但 aggregate 的形状不同（`daily[]` 而不是 `mealsByType`），
 * 所以单独一个函数而不是把 isReportStale 改成联合类型 —— 联合类型内部照样要分支，反而更绕，
 * 将来加月报时也是同样的扩展路径。
 * 判据取两个值：有记录的天数、七天 intake 合计。
 * 已知盲点：跨天等量对冲（A 天减 100、B 天加 100）合计不变，会漏报；
 * 本版本没有跨天移动记录的功能，走不到这条路径，所以不做逐日深比较。
 */
export function isWeeklyReportStale(report: Report, current: WeeklyAggregate): boolean {
  const stored = report.content as Partial<WeeklyAggregate> | null | undefined;
  if (stored === null || stored === undefined || stored.daily === undefined || stored.daysLogged === undefined) {
    // 老格式/损坏的快照没有可比对的内容，宁可不提示也不要误报
    return false;
  }

  if (stored.daysLogged !== current.daysLogged) {
    return true;
  }

  const storedTotal = sumDailyIntake(stored.daily);
  const currentTotal = sumDailyIntake(current.daily);
  if (storedTotal === null || currentTotal === null) {
    return false;
  }
  return !sameTotals(storedTotal, currentTotal);
}

/**
 * 生成日报：命中已有报告就直接返回，否则聚合 → 调 AI → 存库。
 * force = true 用于"重新生成"：既跳过本地已有报告（Dexie），
 * 也跳过服务端的响应缓存 —— 用户点这个按钮是想换一段分析，不是想再走一遍同样的流程。
 */
export async function generateDailyReport(date: string, options?: { force?: boolean }): Promise<Report> {
  if (options?.force !== true) {
    const cached = await getReport('daily', date);
    if (cached !== undefined) {
      return cached;
    }
  }

  const aggregate = await aggregateDaily(date);
  const analysis = await requestAiReport(toDailyPayload(aggregate), 'daily', {
    skipCache: options?.force === true,
  });
  return saveReport({
    reportType: 'daily',
    dateStart: date,
    dateEnd: date,
    content: aggregate,
    aiAnalysis: analysis.analysis,
    aiSuggestions: analysis.suggestions,
  });
}

export async function generateWeeklyReport(
  startDate: string,
  endDate: string,
  options?: { force?: boolean },
): Promise<Report> {
  if (options?.force !== true) {
    const cached = await getReport('weekly', startDate);
    if (cached !== undefined) {
      return cached;
    }
  }

  const aggregate = await aggregateWeekly(startDate, endDate);
  const analysis = await requestAiReport(toWeeklyPayload(aggregate), 'weekly', {
    skipCache: options?.force === true,
  });
  return saveReport({
    reportType: 'weekly',
    dateStart: startDate,
    dateEnd: endDate,
    content: aggregate,
    aiAnalysis: analysis.analysis,
    aiSuggestions: analysis.suggestions,
  });
}
