import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { PFC_COLORS } from '../components/pfcColors';
import { todayIso } from '../services/date';
import { aggregateWeekly, calcPfcKcal, isDayLogged, isProteinOnTarget } from '../services/report';
import type { WeeklyAggregate } from '../services/report';

type RangeKey = '7' | '30' | 'custom';

const RANGE_OPTIONS: ReadonlyArray<{ key: RangeKey; label: string }> = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: 'custom', label: '自定义' },
];

const PFC_LEGEND_ITEMS = [
  { name: '蛋白质', color: PFC_COLORS.protein },
  { name: '碳水', color: PFC_COLORS.carb },
  { name: '脂肪', color: PFC_COLORS.fat },
];

/** 往前推 n 天。用 setDate 而不是减毫秒，跨月/跨年不用自己算天数差 */
function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return todayIso(date);
}

function monthDayLabel(date: string): string {
  return date.slice(5);
}

/** 30 天有 30 个刻度会把 X 轴挤成一团，按数据量稀释到 8 个左右 */
function tickInterval(count: number): number {
  return count > 14 ? Math.ceil(count / 8) - 1 : 0;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint !== undefined && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function percentText(part: number, total: number): string | null {
  // 一天都没记录时不给百分比：显示 0% 会像"全都没达标"，实际是没数据
  return total === 0 ? null : `${Math.round((part / total) * 1000) / 10}%`;
}

export default function Analysis() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('7');
  const [customStart, setCustomStart] = useState(() => daysAgoIso(29));
  const [customEnd, setCustomEnd] = useState(() => todayIso());
  const [summary, setSummary] = useState<WeeklyAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = useMemo(() => {
    if (rangeKey === 'custom') {
      // 起止填反了就自动摆正，否则会算出一个空区间，看起来像"这段时间没记录"
      return customStart <= customEnd
        ? { startDate: customStart, endDate: customEnd }
        : { startDate: customEnd, endDate: customStart };
    }
    const days = rangeKey === '7' ? 7 : 30;
    return { startDate: daysAgoIso(days - 1), endDate: todayIso() };
  }, [rangeKey, customStart, customEnd]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    aggregateWeekly(startDate, endDate)
      .then((result) => {
        if (!cancelled) {
          setSummary(result);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const daily = summary?.daily ?? [];
  const loggedDays = daily.filter(isDayLogged);
  const target = summary?.target ?? null;
  const proteinOnTarget = loggedDays.filter((day) => isProteinOnTarget(day.intake.proteinG, target)).length;
  // 一天都没记录时把数值显示成"—"而不是 0：0 kcal 和"没数据"是两回事，
  // 跟报告页 daysOnTargetPercent 为 null 的处理保持一致
  const noData = summary !== null && summary.daysLogged === 0;

  const trendData = daily.map((day) => ({
    label: monthDayLabel(day.date),
    // 没记录的一天给 null，配合 connectNulls={false} 让折线断开；
    // 填 0 会画成一条掉到底的实线，看不出那天其实没记
    kcal: isDayLogged(day) ? day.intake.kcal : null,
  }));

  const pfcData = daily.map((day) => {
    // 这里不像折线图那样用 null：柱状图没有"把两天连起来"的歧义，
    // 没记录的一天画成 0 高度即可，X 轴上也还能保住那一天的档位
    const breakdown = calcPfcKcal(day.intake);
    return {
      label: monthDayLabel(day.date),
      proteinKcal: breakdown.proteinKcal,
      carbKcal: breakdown.carbKcal,
      fatKcal: breakdown.fatKcal,
    };
  });

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">营养分析</h1>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRangeKey(option.key)}
              aria-pressed={rangeKey === option.key}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                rangeKey === option.key
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-1 text-sm text-slate-500">
            {startDate} ~ {endDate}
          </span>
        </div>

        {rangeKey === 'custom' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(event) => {
                if (event.target.value !== '') {
                  setCustomStart(event.target.value);
                }
              }}
              aria-label="自定义开始日期"
              className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
            <span className="text-sm text-slate-400">~</span>
            <input
              type="date"
              value={customEnd}
              onChange={(event) => {
                if (event.target.value !== '') {
                  setCustomEnd(event.target.value);
                }
              }}
              aria-label="自定义结束日期"
              className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
          </div>
        )}

        <p className="mt-2 text-xs text-slate-400">全部由本地数据聚合，不调用 AI，不消耗每日额度。</p>
      </div>

      {loading && <p className="text-sm text-slate-500">正在汇总…</p>}

      {error !== null && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          读取分析数据失败：{error}
        </div>
      )}

      {summary !== null && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium text-slate-700">达标情况</h2>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatTile
                label="记录天数"
                value={`${summary.daysLogged} / ${summary.daily.length}`}
                hint="区间内有记录的天数"
              />
              <StatTile
                label="热量达标"
                value={noData ? '—' : `${summary.daysOnTarget} 天`}
                hint={percentText(summary.daysOnTarget, summary.daysLogged) ?? '暂无记录'}
              />
              <StatTile
                label="蛋白质达标"
                value={noData ? '—' : `${proteinOnTarget} 天`}
                hint={percentText(proteinOnTarget, summary.daysLogged) ?? '暂无记录'}
              />
              <StatTile label="平均热量" value={noData ? '—' : `${summary.average.kcal} kcal`} />
              <StatTile label="平均蛋白质" value={noData ? '—' : `${summary.average.proteinG} g`} />
              <StatTile
                label="平均碳水 / 脂肪"
                value={noData ? '—' : `${summary.average.carbG} / ${summary.average.fatG} g`}
              />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              热量达标口径：目标 ±10%；蛋白质达标口径：≥ 目标的 90%。平均值只按有记录的天数算，
              百分比的分母也是有记录的天数。
              {target === null && ' 当前没有启用的营养方案，无法判断达标，只展示实际摄入。'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium text-slate-700">热量趋势</h2>
            <div className="mt-2 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={tickInterval(trendData.length)} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value) => [`${String(value)} kcal`, '热量']} />
                  {/* ifOverflow="extendDomain"：目标 2200 而实际只有 600 时，
                      Y 轴默认只按数据自适应，目标线会被挤到画布外看不见 */}
                  {target !== null && (
                    <ReferenceLine
                      y={target.kcal}
                      stroke="#f59e0b"
                      strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Line type="monotone" dataKey="kcal" stroke="#3b82f6" strokeWidth={2} connectNulls={false} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {target !== null && (
              <p className="mt-1 text-xs text-slate-400">橙色虚线是热量目标 {target.kcal} kcal。</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium text-slate-700">PFC 摄入趋势</h2>
            <p className="mt-1 text-xs text-slate-400">
              按 kcal 口径堆叠（蛋白 ×4、碳水 ×4、脂肪 ×9），不是克数 —— 克数一样时热量贡献能差 2 倍以上。
            </p>
            <div className="mt-2 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pfcData} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={tickInterval(pfcData.length)} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value, name) => [`${String(value)} kcal`, String(name)]} />
                  {target !== null && (
                    <ReferenceLine
                      y={target.kcal}
                      stroke="#ef4444"
                      strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    />
                  )}
                  <Bar dataKey="proteinKcal" name="蛋白质" stackId="pfc" fill={PFC_COLORS.protein} />
                  <Bar dataKey="carbKcal" name="碳水" stackId="pfc" fill={PFC_COLORS.carb} />
                  <Bar dataKey="fatKcal" name="脂肪" stackId="pfc" fill={PFC_COLORS.fat} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* 自己画图例：recharts v3 的 Legend 不支持传 payload，
                让它自动排会把顺序倒过来（碳水/脂肪/蛋白质），和图里的堆叠顺序对不上 */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              {PFC_LEGEND_ITEMS.map((entry) => (
                <span key={entry.name} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                  {entry.name}
                </span>
              ))}
            </div>
            {target !== null && (
              <p className="mt-1 text-xs text-slate-400">
                红色虚线是热量目标 {target.kcal} kcal：柱子堆到线附近就是总热量达标。
              </p>
            )}
          </div>

          {loggedDays.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
              这段时间没有任何记录，图表是空的。
            </p>
          )}
        </>
      )}
    </section>
  );
}
