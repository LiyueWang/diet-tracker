import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  deleteItemsByMealId,
  getActivePlan,
  getItemsByMealId,
  getMealsByDate,
  softDeleteMeal,
} from '../db/repo';
import type { FoodItem, Meal, NutritionPlan } from '../db/schema';
import { describeDay, todayIso } from '../services/date';
import { round1 } from '../services/nutrition';

type MealType = Meal['mealType'];

interface Totals {
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
}

/**
 * 一条餐次记录 + 它的条目。
 * 现在是"一条记录一个卡片"而不是"按餐次类型合并"：
 * 合并之后一个分区里可能有多个 meal.id，编辑/删除按钮就不知道作用在谁身上。
 */
interface MealGroup {
  meal: Meal;
  items: FoodItem[];
}

const MEAL_SECTIONS: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
];

const ZERO_TOTALS: Totals = { proteinG: 0, carbG: 0, fatG: 0, kcal: 0 };

function sumItems(items: FoodItem[]): Totals {
  return items.reduce(
    (acc, item) => ({
      // 每条都过一遍 round1，避免浮点尾巴在累加时放大
      proteinG: round1(acc.proteinG + item.proteinG),
      carbG: round1(acc.carbG + item.carbG),
      fatG: round1(acc.fatG + item.fatG),
      kcal: round1(acc.kcal + item.kcal),
    }),
    ZERO_TOTALS,
  );
}

/** 目标进度条：超额时换成红色，比继续拉满蓝色更能说明问题 */
function TargetBar({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const percent = target > 0 ? Math.round((value / target) * 100) : 0;
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span>
          {value} / {target} {unit}（{percent}%）
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        {/* 宽度是运行时算出来的，Tailwind 的静态类名表达不了，只能走内联 style */}
        <div
          className={`h-2 rounded-full ${value > target ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export default function Today() {
  const location = useLocation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<MealGroup[]>([]);
  const [plan, setPlan] = useState<NutritionPlan | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const today = todayIso();

  /**
   * 每次挂载都从 repo 重新读当天数据，不依赖任何全局缓存 ——
   * 编辑/删除返回后要能立刻看到最新结果，最省事也最不容易出错的做法就是不缓存。
   * （没有做卸载守卫：React 18 起卸载后 setState 是 no-op，不会告警也不会泄漏。）
   */
  const loadToday = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // 餐次和条目分两次查：repo 没有提供联表接口，个人数据量下这里够用
      const meals = await getMealsByDate(today);
      const loaded = await Promise.all(
        meals.map(async (meal) => ({ meal, items: await getItemsByMealId(meal.id) })),
      );
      const activePlan = await getActivePlan();
      setGroups(loaded);
      setPlan(activePlan);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  /**
   * Record 保存/更新成功后 navigate('/', { state: { savedAt, kind } })，这里接住并提示。
   * 显示完立刻把 state 清掉：React Router 的 location.state 留在 history 里，
   * 不清的话用户手动刷新页面会再弹一次。
   * replace: true 是必须的 —— 否则会往历史里塞一条新记录，用户按返回键又会看到带 toast 的那一页。
   */
  useEffect(() => {
    const state = location.state as { savedAt?: number; kind?: 'created' | 'updated' } | null;
    if (!state?.savedAt) {
      return;
    }
    // 先 setNotice 再清 state：清空会让本 effect 重入一次，但那时 state 已经是 null，直接 return
    setNotice(state.kind === 'updated' ? '已更新' : '已保存');
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  /**
   * 提示自动消失。
   * 单独拆一个 effect 而不是塞在上面的 cleanup 里：上面那次重入会执行上一次的 cleanup，
   * 如果定时器挂在那个 cleanup 上，刚设好的 3 秒定时会被立刻取消，提示就永远不消失。
   */
  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // 总览是当天所有 meal 的条目相加，跟下面按餐次分区的结构无关：
  // 同一天记了几条、分属哪个餐次都不影响这里的口径。
  const totals = useMemo(() => sumItems(groups.flatMap((group) => group.items)), [groups]);

  async function handleDelete(mealId: string): Promise<void> {
    setDeletingId(mealId);
    setError(null);
    try {
      // 顺序不能反：先清条目再软删餐次，否则会留下"餐次已标记删除、条目还挂在上面"的残骸
      await deleteItemsByMealId(mealId);
      await softDeleteMeal(mealId);
      setPendingDeleteId(null);
      await loadToday();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">今日汇总</h1>
        <p className="mt-1 text-sm text-slate-600">{describeDay()}</p>
      </header>

      {notice !== null && (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</p>
      )}

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">总览</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">热量</p>
            <p className="text-lg font-semibold">{totals.kcal} kcal</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">蛋白质</p>
            <p className="text-lg font-semibold">{totals.proteinG} g</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">碳水</p>
            <p className="text-lg font-semibold">{totals.carbG} g</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">脂肪</p>
            <p className="text-lg font-semibold">{totals.fatG} g</p>
          </div>
        </div>

        {plan ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-slate-500">目标：{plan.name}</p>
            <TargetBar label="热量" value={totals.kcal} target={plan.targetKcal} unit="kcal" />
            <TargetBar label="蛋白质" value={totals.proteinG} target={plan.targetProteinG} unit="g" />
            <TargetBar label="碳水" value={totals.carbG} target={plan.targetCarbG} unit="g" />
            <TargetBar label="脂肪" value={totals.fatG} target={plan.targetFatG} unit="g" />
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            还没有设置营养目标（repo.getActivePlan 无结果），所以不显示进度条。
          </p>
        )}
      </div>

      {loading && groups.length === 0 && <p className="text-sm text-slate-500">正在读取…</p>}

      {MEAL_SECTIONS.map((section) => {
        // 同一餐次一天可能记了多条，按时间先后排列（getMealsByDate 已按 time 排序，这里再显式排一次，
        // 免得将来换数据源时顺序悄悄变掉）
        const meals = groups
          .filter((group) => group.meal.mealType === section.value)
          .sort((a, b) => a.meal.time.localeCompare(b.meal.time));

        if (meals.length === 0) {
          return (
            <div key={section.value} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-medium text-slate-700">{section.label}</h2>
              <p className="mt-2 text-sm text-slate-400">暂无记录</p>
            </div>
          );
        }

        return meals.map((group) => {
          const sectionTotals = sumItems(group.items);
          return (
            <div key={group.meal.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-slate-700">
                  {section.label}
                  <span className="ml-2 text-xs font-normal text-slate-400">{group.meal.time}</span>
                </h2>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/record?edit=${group.meal.id}`)}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(group.meal.id)}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {sectionTotals.kcal} kcal · P {sectionTotals.proteinG} · C {sectionTotals.carbG} · F{' '}
                {sectionTotals.fatG}
              </p>

              {pendingDeleteId === group.meal.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2">
                  <span className="text-xs text-red-700">确认删除这条记录？</span>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(group.meal.id);
                    }}
                    disabled={deletingId === group.meal.id}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {deletingId === group.meal.id ? '删除中…' : '确认删除'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(null)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600"
                  >
                    取消
                  </button>
                </div>
              )}

              <ul className="mt-2 divide-y divide-slate-100">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-sm text-slate-800">{item.name}</span>
                    <span className="whitespace-nowrap text-xs text-slate-600">
                      {item.weightG === null ? '—' : `${item.weightG}g`}
                      <span className="ml-3">P {item.proteinG}</span>
                      <span className="ml-2">C {item.carbG}</span>
                      <span className="ml-2">F {item.fatG}</span>
                      <span className="ml-3 font-medium text-slate-800">{item.kcal} kcal</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        });
      })}
    </section>
  );
}
