import { useCallback, useEffect, useMemo, useState } from 'react';

import FoodLibraryForm from '../components/FoodLibraryForm';
import { addFood, deleteFood, listFoodLibrary, updateFood } from '../db/repo';
import type { FoodLibraryInput } from '../db/repo';
import type { FoodLibraryItem } from '../db/schema';
import { recalcKcal } from '../services/nutrition';
import { sortByName } from '../services/sort';

type EditorState = { mode: 'new' } | { mode: 'edit'; item: FoodLibraryItem };

export default function FoodLibrary() {
  const [foods, setFoods] = useState<FoodLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** 每次挂载与每次写入后都重新读库，不维护本地副本，避免和别处的改动打架 */
  const loadFoods = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // repo 返回的是 name 索引顺序（码点序），这里统一成拼音序，和补剂页保持一致
      setFoods(sortByName(await listFoodLibrary()));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFoods();
  }, [loadFoods]);

  /** 分类下拉的选项从现有条目里提取，不额外维护一份分类表 */
  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const food of foods) {
      const category = food.category?.trim();
      if (category !== undefined && category !== '') {
        unique.add(category);
      }
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [foods]);

  const visibleFoods = useMemo(() => {
    const key = keyword.trim().replace(/\s+/g, '').toLowerCase();
    return foods.filter((food) => {
      if (categoryFilter !== '' && (food.category ?? '') !== categoryFilter) {
        return false;
      }
      if (key === '') {
        return true;
      }
      // 按 name 和 aliases 模糊匹配；去空白再比，用户多打个空格也能搜到
      return [food.name, ...food.aliases].some((text) => text.replace(/\s+/g, '').toLowerCase().includes(key));
    });
  }, [foods, keyword, categoryFilter]);

  async function handleSubmit(value: FoodLibraryInput): Promise<void> {
    if (editor !== null && editor.mode === 'edit') {
      await updateFood(editor.item.id, value);
    } else {
      await addFood(value);
    }
    setEditor(null);
    await loadFoods();
  }

  async function handleDelete(id: string): Promise<void> {
    setDeletingId(id);
    setError(null);
    try {
      await deleteFood(id);
      setPendingDeleteId(null);
      await loadFoods();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">食物库</h1>
        <button
          type="button"
          onClick={() => setEditor({ mode: 'new' })}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white"
        >
          新增食物
        </button>
      </div>

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {/* 新增走顶部表单；编辑走列表行内展开（下面那个块），两者只能出现一个 */}
      {editor !== null && editor.mode === 'new' && (
        <FoodLibraryForm
          key="new"
          title="新增食物"
          onSubmit={handleSubmit}
          onCancel={() => setEditor(null)}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="w-full max-w-xs rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索名称或别名"
          aria-label="搜索食物"
        />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          分类
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="按分类筛选"
          >
            <option value="">全部</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && foods.length === 0 && <p className="text-sm text-slate-500">正在读取…</p>}

      {!loading && foods.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          还没有食物，点右上角新增
        </p>
      )}

      {foods.length > 0 && visibleFoods.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">没有匹配的食物</p>
      )}

      {visibleFoods.length > 0 && (
        <ul className="rounded-lg border border-slate-200 bg-white px-4">
          {visibleFoods.map((food) => (
            <li key={food.id} className="border-b border-slate-100 py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                    {food.name}
                    {food.category !== undefined && food.category !== '' && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                        {food.category}
                      </span>
                    )}
                  </p>
                  {food.aliases.length > 0 && (
                    <p className="mt-0.5 text-xs text-slate-500">别名：{food.aliases.join('、')}</p>
                  )}
                  {food.tags !== undefined && food.tags.length > 0 && (
                    <p className="mt-0.5 text-xs text-slate-500">标签：{food.tags.join('、')}</p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-600">
                    每 {food.perAmount}
                    {food.perUnit}：P {food.proteinG} · C {food.carbG} · F {food.fatG} ·{' '}
                    {/* 方案 2：kcal 一律由 P/F/C 派生，不显示库里可能过时的存量值 */}
                    {recalcKcal(food.proteinG, food.carbG, food.fatG)} kcal
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditor({ mode: 'edit', item: food })}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(food.id)}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>

              {pendingDeleteId === food.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2">
                  <span className="text-xs text-red-700">
                    确认删除「{food.name}」？已记录的历史数据不受影响，但编辑历史记录时无法再按此条匹配。
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(food.id);
                    }}
                    disabled={deletingId === food.id}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {deletingId === food.id ? '删除中…' : '确认删除'}
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

              {editor !== null && editor.mode === 'edit' && editor.item.id === food.id && (
                <div className="mt-2">
                  <FoodLibraryForm
                    key={food.id}
                    initialValue={food}
                    onSubmit={handleSubmit}
                    onCancel={() => setEditor(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
