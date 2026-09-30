import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { PFC_COLORS } from '../components/pfcColors';
import TargetBar from '../components/TargetBar';
import { getReport } from '../db/repo';
import type { Report } from '../db/schema';
import { todayIso } from '../services/date';
import {
  aggregateDaily,
  aggregateWeekly,
  calcPfcKcal,
  generateDailyReport,
  generateWeeklyReport,
  isDayLogged,
  isReportStale,
  isWeeklyReportStale,
} from '../services/report';
import type { DailyAggregate, NutritionTotals, WeeklyAggregate } from '../services/report';

type Tab = 'daily' | 'weekly';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function shiftDate(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return todayIso(next);
}

/** 指定日期所在周的周一 */
function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00`);
  const offset = (day.getDay() + 6) % 7;
  return shiftDate(date, -offset);
}

function weekdayLabel(date: string): string {
  return WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()] ?? '';
}

/** 报告存的是 unknown，这里统一收窄；老格式或损坏时返回 null，页面显示提示而不是崩掉 */
function readDailyContent(report: Report | null): DailyAggregate | null {
  if (report === null) {
    return null;
  }
  const content = report.content as Partial<DailyAggregate> | null | undefined;
  if (content === null || content === undefined || content.intake === undefined || content.mealsByType === undefined) {
    return null;
  }
  return content as DailyAggregate;
}

function readWeeklyContent(report: Report | null): WeeklyAggregate | null {
  if (report === null) {
    return null;
  }
  const content = report.content as Partial<WeeklyAggregate> | null | undefined;
  if (content === null || content === undefined || content.average === undefined || content.daily === undefined) {
    return null;
  }
  return content as WeeklyAggregate;
}

/** PFC 占比饼图：按 kcal 口径分三块，旁边配一份带克数和 kcal 的图例 */
function PfcPieChart({ totals }: { totals: NutritionTotals }) {
  const breakdown = calcPfcKcal(totals);
  const data = [
    { key: 'protein', name: '蛋白质', value: breakdown.proteinKcal, grams: totals.proteinG, percent: breakdown.proteinPercent, color: PFC_COLORS.protein },
    { key: 'carb', name: '碳水', value: breakdown.carbKcal, grams: totals.carbG, percent: breakdown.carbPercent, color: PFC_COLORS.carb },
    { key: 'fat', name: '脂肪', value: breakdown.fatKcal, grams: totals.fatG, percent: breakdown.fatPercent, color: PFC_COLORS.fat },
  ];

  if (breakdown.totalKcal <= 0) {
    return <p className="text-sm text-slate-400">没有营养数据，画不出占比</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={30} outerRadius={70} label={false}>
              {data.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name) => [`${String(value)} kcal`, String(name)]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="text-sm text-slate-700">
        {data.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 py-0.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="w-14">{entry.name}</span>
            <span className="text-slate-500">
              {entry.grams} g / {entry.value} kcal
            </span>
            <span className="font-medium">{entry.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 四餐分区明细（只读展示，编辑入口在 Record 页） */
function DailyMealDetails({ aggregate }: { aggregate: DailyAggregate }) {
  return (
    <div className="space-y-3">
      {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => {
        const section = aggregate.mealsByType[type];
        const label = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[type];
        return (
          <div key={type} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-medium text-slate-700">{label}</h3>
              {section.items.length > 0 && (
                <p className="text-xs text-slate-500">
                  {section.totals.kcal} kcal · P {section.totals.proteinG} · C {section.totals.carbG} · F{' '}
                  {section.totals.fatG}
                </p>
              )}
            </div>
            {section.items.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">暂无记录</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {section.items.map((item) => (
                  <li key={item.id} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="text-sm text-slate-800">
                      {item.name}
                      {item.itemType === 'supplement' && <span className="ml-2 text-xs text-slate-400">补剂</span>}
                    </span>
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
            )}
          </div>
        );
      })}
    </div>
  );
}

function AiAnalysis({ report }: { report: Report }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-medium text-slate-700">AI 分析</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{report.aiAnalysis ?? '（本次生成没有返回分析）'}</p>
      {report.aiSuggestions !== undefined && report.aiSuggestions.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {report.aiSuggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">生成时间：{new Date(report.generatedAt).toLocaleString('zh-CN')}</p>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState<Tab>('daily');

  const [date, setDate] = useState(() => todayIso());
  const [dailyReport, setDailyReport] = useState<Report | null>(null);
  const [dailyLive, setDailyLive] = useState<DailyAggregate | null>(null);

  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayIso()));
  const [weeklyReport, setWeeklyReport] = useState<Report | null>(null);
  const [weeklyLive, setWeeklyLive] = useState<WeeklyAggregate | null>(null);

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekEnd = useMemo(() => shiftDate(weekStart, 6), [weekStart]);

  const loadDaily = useCallback(async (targetDate: string): Promise<void> => {
    const [cached, live] = await Promise.all([getReport('daily', targetDate), aggregateDaily(targetDate)]);
    setDailyReport(cached ?? null);
    setDailyLive(live);
  }, []);

  const loadWeekly = useCallback(async (start: string, end: string): Promise<void> => {
    const [cached, live] = await Promise.all([getReport('weekly', start), aggregateWeekly(start, end)]);
    setWeeklyReport(cached ?? null);
    setWeeklyLive(live);
  }, []);

  // 切日期/切周都重新读一次：缓存报告 + 实时聚合（后者用于判断报告是否过期）
  useEffect(() => {
    if (tab !== 'daily') {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadDaily(date)
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
  }, [tab, date, loadDaily]);

  useEffect(() => {
    if (tab !== 'weekly') {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadWeekly(weekStart, weekEnd)
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
  }, [tab, weekStart, weekEnd, loadWeekly]);

  async function handleGenerateDaily(force: boolean): Promise<void> {
    setGenerating(true);
    setError(null);
    try {
      setDailyReport(await generateDailyReport(date, { force }));
      // 生成完刷新一次实时聚合，这样过期判断立刻回到 false
      setDailyLive(await aggregateDaily(date));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateWeekly(force: boolean): Promise<void> {
    setGenerating(true);
    setError(null);
    try {
      setWeeklyReport(await generateWeeklyReport(weekStart, weekEnd, { force }));
      setWeeklyLive(await aggregateWeekly(weekStart, weekEnd));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGenerating(false);
    }
  }

  const dailyContent = readDailyContent(dailyReport);
  const weeklyContent = readWeeklyContent(weeklyReport);
  const dailyStale = dailyReport !== null && dailyLive !== null && isReportStale(dailyReport, dailyLive);
  const weeklyStale = weeklyReport !== null && weeklyLive !== null && isWeeklyReportStale(weeklyReport, weeklyLive);

  const trendData =
    weeklyContent?.daily.map((day) => ({
      label: weekdayLabel(day.date),
      // 没记录的那天用 null：配合 connectNulls={false} 让折线断开，
      // 否则会画成 0 kcal 的实线，看不出中间断过记录
      kcal: isDayLogged(day) ? day.intake.kcal : null,
    })) ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">报告</h1>
        <div className="flex gap-1">
          {(
            [
              ['daily', '日报'],
              ['weekly', '周报'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                tab === value ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              void (tab === 'daily' ? handleGenerateDaily(dailyReport !== null) : handleGenerateWeekly(weeklyReport !== null));
            }}
            className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs text-red-700"
          >
            重试
          </button>
        </div>
      )}

      {tab === 'daily' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setDate((current) => shiftDate(current, -1))} className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600" aria-label="前一天">
                ←
              </button>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value === '' ? todayIso() : event.target.value)}
                aria-label="报告日期"
                className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
              />
              <button type="button" onClick={() => setDate((current) => shiftDate(current, 1))} className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600" aria-label="后一天">
                →
              </button>
              <span className="ml-1 text-sm text-slate-500">{weekdayLabel(date)}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleGenerateDaily(dailyReport !== null);
              }}
              disabled={generating}
              className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {generating ? '生成中…' : dailyReport === null ? '生成日报' : '重新生成'}
            </button>
          </div>

          {loading && <p className="text-sm text-slate-500">正在读取…</p>}

          {dailyStale && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span>这份报告生成之后，当天记录又有变化，下面的数据可能已经过时。</span>
              <button
                type="button"
                onClick={() => {
                  void handleGenerateDaily(true);
                }}
                disabled={generating}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800 disabled:opacity-50"
              >
                重新生成
              </button>
            </div>
          )}

          {dailyReport === null ? (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
              尚未生成，点击右上角「生成日报」
            </p>
          ) : dailyContent === null ? (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
              报告内容无法解析（可能是旧版本生成的），请重新生成
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-medium text-slate-700">
                  {dailyContent.date} {weekdayLabel(dailyContent.date)}
                </h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500">总热量</p>
                    <p className="text-lg font-semibold">{dailyContent.intake.kcal} kcal</p>
                    {dailyContent.target !== null && (
                      <div className="mt-1">
                        <TargetBar label="目标" value={dailyContent.intake.kcal} target={dailyContent.target.kcal} unit="kcal" />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ['蛋白质', dailyContent.intake.proteinG, dailyContent.target?.proteinG],
                        ['碳水', dailyContent.intake.carbG, dailyContent.target?.carbG],
                        ['脂肪', dailyContent.intake.fatG, dailyContent.target?.fatG],
                      ] as const
                    ).map(([label, value, target]) => (
                      <div key={label}>
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="text-sm font-semibold">
                          {value} g
                          {target !== undefined && <span className="text-xs font-normal text-slate-400"> / 目标 {target} g</span>}
                        </p>
                        {target !== undefined && (
                          <div className="mt-1">
                            <TargetBar compact value={value} target={target} unit="g" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {dailyContent.supplementsTaken.length > 0 && (
                  <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600">
                    补剂贡献：{dailyContent.supplementIntake.kcal} kcal · P {dailyContent.supplementIntake.proteinG} · C{' '}
                    {dailyContent.supplementIntake.carbG} · F {dailyContent.supplementIntake.fatG}
                    <span className="ml-2 text-slate-500">
                      （{dailyContent.supplementsTaken
                        .map((item) => `${item.name}${item.amountG === null ? '' : ` ${item.amountG}g`}${item.timing === undefined ? '' : ` ${item.timing}`}`)
                        .join('、')}）
                    </span>
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-medium text-slate-700">PFC 热量占比</h2>
                {dailyContent.target === null && <p className="mt-1 text-xs text-slate-400">没有营养目标，只显示实际摄入</p>}
                <div className="mt-2">
                  <PfcPieChart totals={dailyContent.intake} />
                </div>
              </div>

              <DailyMealDetails aggregate={dailyContent} />
              <AiAnalysis report={dailyReport} />
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setWeekStart((current) => shiftDate(current, -7))} className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600" aria-label="上一周">
                ←
              </button>
              <span className="text-sm text-slate-700">
                {weekStart} ~ {weekEnd}
              </span>
              <button type="button" onClick={() => setWeekStart((current) => shiftDate(current, 7))} className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600" aria-label="下一周">
                →
              </button>
              <button type="button" onClick={() => setWeekStart(weekStartOf(todayIso()))} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
                回到本周
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                void handleGenerateWeekly(weeklyReport !== null);
              }}
              disabled={generating}
              className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {generating ? '生成中…' : weeklyReport === null ? '生成周报' : '重新生成'}
            </button>
          </div>

          {loading && <p className="text-sm text-slate-500">正在读取…</p>}

          {weeklyStale && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span>这份报告生成之后，这一周的记录又有变化，下面的数据可能已经过时。</span>
              <button
                type="button"
                onClick={() => {
                  void handleGenerateWeekly(true);
                }}
                disabled={generating}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800 disabled:opacity-50"
              >
                重新生成
              </button>
            </div>
          )}

          {weeklyReport === null ? (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
              尚未生成，点击右上角「生成周报」
            </p>
          ) : weeklyContent === null ? (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
              报告内容无法解析（可能是旧版本生成的），请重新生成
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-medium text-slate-700">
                  {weeklyContent.startDate} ~ {weeklyContent.endDate}
                </h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500">平均热量</p>
                    <p className="text-lg font-semibold">{weeklyContent.average.kcal} kcal</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">平均蛋白质</p>
                    <p className="text-lg font-semibold">{weeklyContent.average.proteinG} g</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">平均碳水</p>
                    <p className="text-lg font-semibold">{weeklyContent.average.carbG} g</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">平均脂肪</p>
                    <p className="text-lg font-semibold">{weeklyContent.average.fatG} g</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-700">
                  记录 {weeklyContent.daysLogged} / {weeklyContent.daily.length} 天；热量达标 {weeklyContent.daysOnTarget} 天
                  {weeklyContent.daysOnTargetPercent !== null && <span className="ml-1 text-slate-500">（{weeklyContent.daysOnTargetPercent}%）</span>}
                </p>
                <p className="mt-1 text-xs text-slate-400">平均只按有记录的天数计算</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-medium text-slate-700">每日热量趋势</h2>
                <div className="mt-2 h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(value) => [`${String(value)} kcal`, '热量']} />
                      {/* 目标线用虚线：读图和柱/线区分开。
                          ifOverflow="extendDomain"：目标 2200 而实际只有 600 时，
                          Y 轴默认只按数据自适应，目标线会被挤到画布外看不见 */}
                      {weeklyContent.target !== null && (
                        <ReferenceLine
                          y={weeklyContent.target.kcal}
                          stroke="#f59e0b"
                          strokeDasharray="6 4"
                          ifOverflow="extendDomain"
                        />
                      )}
                      {/* connectNulls=false：没记录的那天断开，不画成 0 的实线 */}
                      <Line type="monotone" dataKey="kcal" stroke="#3b82f6" strokeWidth={2} connectNulls={false} dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-medium text-slate-700">平均 PFC 占比</h2>
                <div className="mt-2">
                  <PfcPieChart totals={weeklyContent.average} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-medium text-slate-700">每日记录状态</h2>
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {weeklyContent.daily.map((day) => {
                    const logged = isDayLogged(day);
                    return (
                      <div
                        key={day.date}
                        className={`rounded-md p-2 text-center text-xs ${
                          logged ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        <p className="font-medium">{weekdayLabel(day.date)}</p>
                        <p>{logged ? `${day.intake.kcal} kcal` : '无记录'}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <AiAnalysis report={weeklyReport} />
            </>
          )}
        </>
      )}
    </section>
  );
}
