import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import SaveAsFoodForm from '../components/SaveAsFoodForm';
import {
  addFoodItems,
  createMeal,
  getItemsByMealId,
  getMealById,
  listFoodLibrary,
  replaceMealItems,
  updateMeal,
} from '../db/repo';
import type { FoodItemInput } from '../db/repo';
import type { FoodItem, FoodLibraryItem } from '../db/schema';
import { parseText } from '../services/ai';
import { nowHhMm, todayIso } from '../services/date';
import { applyFoodLibrary, round1, validateItems } from '../services/nutrition';
import type { AppliedItem } from '../services/nutrition';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * 确认卡片里的每一行。
 * 带本地 key 而不是用数组下标：删除中间一行时下标会整体前移，
 * 既会让 React 复用错输入框（焦点乱跳），也会让"已存入"状态串到别的行。
 */
interface EditableRow {
  key: string;
  item: AppliedItem;
}

const MEAL_TYPES: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
];

const CELL_INPUT = 'rounded border border-slate-300 px-1 py-0.5 text-sm outline-none focus:border-blue-500';

/** 按当前时间猜默认餐次：<10 早餐，<15 午餐，<21 晚餐，其余加餐 */
function guessMealType(now: Date): MealType {
  const hour = now.getHours();
  if (hour < 10) {
    return 'breakfast';
  }
  if (hour < 15) {
    return 'lunch';
  }
  if (hour < 21) {
    return 'dinner';
  }
  return 'snack';
}

/** 返回 undefined 表示"输入非法，忽略这次改动"，避免把 NaN 写进 state */
function parseWeightInput(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNutritionInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function toFoodItemInput(item: AppliedItem): FoodItemInput {
  const input: FoodItemInput = {
    name: item.name.trim(),
    weightG: item.weightG,
    proteinG: item.proteinG,
    carbG: item.carbG,
    fatG: item.fatG,
    kcal: item.kcal,
    dataSource: item.dataSource,
    itemType: item.itemType,
  };
  // 只在有意义时写这两个可选字段，省得 IndexedDB 里躺一堆 undefined
  if (item.foodLibraryId) {
    input.foodLibraryId = item.foodLibraryId;
  }
  if (item.dataSource === 'ai_estimate') {
    input.aiConfidence = item.confidence;
  }
  return input;
}

/**
 * 已保存的 FoodItem → 确认卡片用的 AppliedItem。
 * estimated 只能拿存下来的数值充当：库里没有保留当初 AI 的原始估算，
 * 这个字段只在"库行失去匹配后退回估算"时才被读到。
 * dataSource 为 manual 的行目前没有写入方，这里按 AI 估算处理。
 */
function toAppliedItem(item: FoodItem): AppliedItem {
  return {
    name: item.name,
    weightG: item.weightG,
    quantityDesc: '',
    itemType: item.itemType,
    estimated: {
      proteinG: item.proteinG,
      carbG: item.carbG,
      fatG: item.fatG,
      kcal: item.kcal,
    },
    confidence: item.aiConfidence ?? 0,
    proteinG: item.proteinG,
    carbG: item.carbG,
    fatG: item.fatG,
    kcal: item.kcal,
    dataSource: item.dataSource === 'food_library' ? 'food_library' : 'ai_estimate',
    ...(item.foodLibraryId ? { foodLibraryId: item.foodLibraryId } : {}),
    needsWeight: item.weightG === null,
  };
}

/** 「存为常用」表单要的是每 100g 的值，而卡片上的数值是当前克数的合计，这里换算回去 */
function toPer100g(item: AppliedItem): { proteinG: number; carbG: number; fatG: number; kcal: number } {
  if (item.weightG !== null && item.weightG > 0) {
    const factor = 100 / item.weightG;
    return {
      proteinG: round1(item.proteinG * factor),
      carbG: round1(item.carbG * factor),
      fatG: round1(item.fatG * factor),
      kcal: round1(item.kcal * factor),
    };
  }
  // 没有克数就没法换算，原样带入让用户自己核对
  return { proteinG: item.proteinG, carbG: item.carbG, fatG: item.fatG, kcal: item.kcal };
}

export default function Record() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = editId !== null;

  const [mealType, setMealType] = useState<MealType>(() => guessMealType(new Date()));
  const [time, setTime] = useState<string>(() => nowHhMm());
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [library, setLibrary] = useState<FoodLibraryItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFormKey, setOpenFormKey] = useState<string | null>(null);
  const [savedRowKeys, setSavedRowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    listFoodLibrary()
      .then((foods) => {
        if (!cancelled) {
          setLibrary(foods);
        }
      })
      .catch((cause: unknown) => {
        // 组件卸载后 setState 会被 React 忽略，但错误信息仍要落到界面上
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 编辑模式：把已保存的餐次和条目读回确认卡片
  useEffect(() => {
    if (editId === null) {
      return;
    }
    // 收窄后的副本：嵌套的 async 函数里 TS 不会沿用外层的 null 检查
    const mealId = editId;
    let cancelled = false;

    async function loadMeal(): Promise<void> {
      setLoadingEdit(true);
      setNotFound(false);
      try {
        const meal = await getMealById(mealId);
        if (cancelled) {
          return;
        }
        // 逻辑删除过的记录等于不存在，不能让用户编辑出一个"复活"的幽灵记录
        if (!meal || meal.deleted === 1) {
          setNotFound(true);
          return;
        }

        const items = await getItemsByMealId(mealId);
        if (cancelled) {
          return;
        }
        setMealType(meal.mealType);
        setTime(meal.time);
        setRows(items.map((item) => ({ key: crypto.randomUUID(), item: toAppliedItem(item) })));
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) {
          setLoadingEdit(false);
        }
      }
    }

    void loadMeal();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const items = useMemo(() => rows.map((row) => row.item), [rows]);

  const errors = useMemo(() => {
    // validateItems 只认克数和营养值，空名字要靠页面自己挡：否则会存进一条没有名字的记录
    const unnamed = items.some((item) => item.name.trim() === '') ? ['有未命名的条目，请填写名称'] : [];
    return [...unnamed, ...validateItems(items)];
  }, [items]);

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => ({
          proteinG: round1(acc.proteinG + item.proteinG),
          carbG: round1(acc.carbG + item.carbG),
          fatG: round1(acc.fatG + item.fatG),
          kcal: round1(acc.kcal + item.kcal),
        }),
        { proteinG: 0, carbG: 0, fatG: 0, kcal: 0 },
      ),
    [items],
  );

  function toRow(item: AppliedItem): EditableRow {
    return { key: crypto.randomUUID(), item };
  }

  function patchRow(key: string, patch: Partial<AppliedItem>): void {
    setRows((prev) => prev.map((row) => (row.key === key ? { key, item: { ...row.item, ...patch } } : row)));
  }

  /**
   * 改克数：命中食物库的行按库里每 100g 的数据重算（否则"库"这个标签就是假的）；
   * AI 估算的行只改克数，不覆盖用户手工改过的营养值。
   */
  function handleWeightChange(row: EditableRow, raw: string): void {
    const next = parseWeightInput(raw);
    if (next === undefined) {
      return;
    }
    if (next !== null && row.item.foodLibraryId) {
      const [recomputed] = applyFoodLibrary([{ ...row.item, weightG: next }], library);
      if (recomputed) {
        patchRow(row.key, recomputed);
        return;
      }
    }
    patchRow(row.key, { weightG: next });
  }

  async function handleParse(): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') {
      setError('请输入饮食描述');
      return;
    }

    setParsing(true);
    setError(null);
    setOpenFormKey(null);
    setSavedRowKeys({});
    try {
      const result = await parseText(trimmed);
      if (result.items.length === 0) {
        setRows([]);
        setError('没有识别到任何食物，换个说法再试');
        return;
      }
      setRows(applyFoodLibrary(result.items, library).map(toRow));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setParsing(false);
    }
  }

  function handleAddRow(): void {
    setRows((prev) => [
      ...prev,
      toRow({
        name: '',
        weightG: null,
        quantityDesc: '',
        itemType: 'food',
        estimated: { proteinG: 0, carbG: 0, fatG: 0, kcal: 0 },
        confidence: 0,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        kcal: 0,
        dataSource: 'ai_estimate',
        needsWeight: true,
      }),
    ]);
  }

  function handleRemoveRow(key: string): void {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setOpenFormKey((current) => (current === key ? null : current));
  }

  function handleCancel(): void {
    // 编辑模式直接离开，不要留下"看起来取消了其实没保存"的中间状态
    if (isEditMode) {
      navigate('/');
      return;
    }
    setRows([]);
    setError(null);
    setOpenFormKey(null);
    setSavedRowKeys({});
  }

  function handleFoodSaved(row: EditableRow, food: FoodLibraryItem): void {
    patchRow(row.key, { foodLibraryId: food.id });
    // 新食物立刻并入内存里的食物库，这样同一句里再出现它就能直接命中，不必刷新页面
    setLibrary((prev) => [...prev, food]);
    setSavedRowKeys((prev) => ({ ...prev, [row.key]: true }));
    setOpenFormKey(null);
  }

  async function handleSave(): Promise<void> {
    if (errors.length > 0) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isEditMode && editId !== null) {
        // date 不传：本阶段不支持跨天移动记录
        await updateMeal(editId, { mealType, time });
        await replaceMealItems(editId, items.map(toFoodItemInput));
        navigate('/', { state: { savedAt: Date.now(), kind: 'updated' } });
        return;
      }

      const meal = await createMeal({
        date: todayIso(),
        mealType,
        time,
        source: 'text',
        rawText: text.trim(),
      });
      await addFoodItems(meal.id, items.map(toFoodItemInput));

      setRows([]);
      setText('');
      setSavedRowKeys({});
      // 跳回今日汇总；带上 state 让 Today 能提示"已保存"
      navigate('/', { state: { savedAt: Date.now(), kind: 'created' } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  if (notFound) {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">编辑记录</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">记录不存在（可能已被删除）。</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-3 rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white"
          >
            返回今日汇总
          </button>
        </div>
      </section>
    );
  }

  const mealControls = (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">餐次</p>
        <div className="flex flex-wrap gap-2">
          {MEAL_TYPES.map((meal) => (
            <button
              key={meal.value}
              type="button"
              onClick={() => setMealType(meal.value)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                mealType === meal.value
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {meal.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        时间
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal outline-none focus:border-blue-500"
          aria-label="时间"
        />
      </label>
    </div>
  );

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{isEditMode ? '编辑记录' : '记录饮食'}</h1>

      {isEditMode ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {mealControls}
          {loadingEdit && <p className="mt-3 text-sm text-slate-500">正在读取记录…</p>}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">{mealControls}</div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="record-text">
              吃了什么
            </label>
            <textarea
              id="record-text"
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="例如：中午吃了200克鸡胸肉和150克米饭"
              className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm outline-none focus:border-blue-500"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleParse();
                }}
                disabled={parsing}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {parsing ? '正在解析…' : '解析'}
              </button>
              {parsing && <span className="text-sm text-slate-500">正在解析…</span>}
            </div>
          </div>
        </>
      )}

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">食物名</th>
                <th className="pb-2 font-medium">克数</th>
                <th className="pb-2 font-medium">蛋白质</th>
                <th className="pb-2 font-medium">碳水</th>
                <th className="pb-2 font-medium">脂肪</th>
                <th className="pb-2 font-medium">热量</th>
                <th className="pb-2 font-medium">来源</th>
                <th className="pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { item } = row;
                const weightMissing = item.weightG === null || item.weightG <= 0;
                return (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="py-2 pr-2">
                      <input
                        className={`${CELL_INPUT} w-28`}
                        value={item.name}
                        onChange={(event) => patchRow(row.key, { name: event.target.value })}
                        aria-label="食物名"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        className={`${CELL_INPUT} w-16 ${weightMissing ? 'border-red-500 bg-red-50' : ''}`}
                        value={item.weightG ?? ''}
                        onChange={(event) => handleWeightChange(row, event.target.value)}
                        aria-label="克数"
                      />
                      {weightMissing && <p className="mt-1 text-xs text-red-600">请补充克数</p>}
                    </td>
                    {(
                      [
                        ['蛋白质', item.proteinG, 'proteinG'],
                        ['碳水', item.carbG, 'carbG'],
                        ['脂肪', item.fatG, 'fatG'],
                        ['热量', item.kcal, 'kcal'],
                      ] as const
                    ).map(([label, value, field]) => (
                      <td key={field} className="py-2 pr-2">
                        <input
                          className={`${CELL_INPUT} w-16`}
                          value={value}
                          onChange={(event) => {
                            const parsed = parseNutritionInput(event.target.value);
                            if (parsed !== undefined) {
                              patchRow(row.key, { [field]: parsed });
                            }
                          }}
                          aria-label={label}
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          item.dataSource === 'food_library'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {item.dataSource === 'food_library' ? '库' : 'AI'}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setOpenFormKey((current) => (current === row.key ? null : row.key))}
                          disabled={savedRowKeys[row.key] === true}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 disabled:opacity-60"
                        >
                          {savedRowKeys[row.key] === true ? '已存入' : '存为常用'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.key)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {openFormKey !== null &&
                (() => {
                  const row = rows.find((candidate) => candidate.key === openFormKey);
                  if (!row) {
                    return null;
                  }
                  return (
                    <tr>
                      <td colSpan={8} className="pt-1">
                        <SaveAsFoodForm
                          defaultName={row.item.name}
                          defaultPer100g={toPer100g(row.item)}
                          onSaved={(food) => handleFoodSaved(row, food)}
                          onCancel={() => setOpenFormKey(null)}
                        />
                      </td>
                    </tr>
                  );
                })()}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-700">
              合计：热量 <span className="font-semibold">{totals.kcal} kcal</span>
              <span className="ml-3">蛋白质 {totals.proteinG}g</span>
              <span className="ml-2">碳水 {totals.carbG}g</span>
              <span className="ml-2">脂肪 {totals.fatG}g</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddRow}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                添加一条
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                disabled={errors.length > 0 || saving}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-600">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
