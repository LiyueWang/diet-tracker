import { useCallback, useEffect, useState } from 'react';

import SupplementForm from '../components/SupplementForm';
import { addSupplement, deleteSupplement, listSupplements, updateSupplement } from '../db/repo';
import type { SupplementPlanInput } from '../db/repo';
import type { SupplementPlan } from '../db/schema';
import { recalcKcal } from '../services/nutrition';
import { compareByName } from '../services/sort';

type EditorState = { mode: 'new' } | { mode: 'edit'; plan: SupplementPlan };

/**
 * 排序：启用中的在前，其次按名称升序。
 * 不用"按 updatedAt 倒序"：那样刚点过启停的会跳到最前，列表顺序会随操作乱跳；
 * 也不把停用的过滤掉 —— 沉底但还在，用户能找回并重新启用。
 */
function sortPlans(plans: SupplementPlan[]): SupplementPlan[] {
  return [...plans].sort((a, b) => {
    if (a.active !== b.active) {
      return b.active - a.active;
    }
    return compareByName(a, b);
  });
}

export default function Supplements() {
  const [plans, setPlans] = useState<SupplementPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadPlans = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setPlans(sortPlans(await listSupplements()));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  async function handleSubmit(value: SupplementPlanInput): Promise<void> {
    if (editor !== null && editor.mode === 'edit') {
      await updateSupplement(editor.plan.id, value);
    } else {
      await addSupplement(value);
    }
    setEditor(null);
    await loadPlans();
  }

  async function handleToggleActive(plan: SupplementPlan): Promise<void> {
    setBusyId(plan.id);
    setError(null);
    try {
      await updateSupplement(plan.id, { active: plan.active === 1 ? 0 : 1 });
      await loadPlans();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await deleteSupplement(id);
      setPendingDeleteId(null);
      await loadPlans();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">补剂方案</h1>
        <button
          type="button"
          onClick={() => setEditor({ mode: 'new' })}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white"
        >
          新增补剂
        </button>
      </div>

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {editor !== null && editor.mode === 'new' && (
        <SupplementForm key="new" title="新增补剂" onSubmit={handleSubmit} onCancel={() => setEditor(null)} />
      )}

      {loading && plans.length === 0 && <p className="text-sm text-slate-500">正在读取…</p>}

      {!loading && plans.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          还没有补剂，点右上角新增
        </p>
      )}

      {plans.length > 0 && (
        <ul className="rounded-lg border border-slate-200 bg-white px-4">
          {plans.map((plan) => (
            <li key={plan.id} className="border-b border-slate-100 py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                    {plan.name}
                    {plan.timing !== undefined && plan.timing !== '' && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                        {plan.timing}
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-normal ${
                        plan.active === 1 ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {plan.active === 1 ? '启用中' : '已停用'}
                    </span>
                  </p>
                  {plan.note !== undefined && plan.note !== '' && (
                    <p className="mt-0.5 text-xs text-slate-500">备注：{plan.note}</p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-600">
                    每份 {plan.defaultAmountG}g：P {plan.proteinG} · C {plan.carbG} · F {plan.fatG} ·{' '}
                    {/* 方案 2：kcal 由 P/F/C 派生，不显示可能过时的存量值 */}
                    {recalcKcal(plan.proteinG, plan.carbG, plan.fatG)} kcal
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditor({ mode: 'edit', plan })}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleActive(plan);
                    }}
                    disabled={busyId === plan.id}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 disabled:opacity-50"
                  >
                    {plan.active === 1 ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(plan.id)}
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600"
                  >
                    删除
                  </button>
                </div>
              </div>

              {pendingDeleteId === plan.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2">
                  <span className="text-xs text-red-700">
                    确认删除「{plan.name}」？已记录的历史数据不受影响，但编辑历史记录时无法再按此条匹配。
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(plan.id);
                    }}
                    disabled={busyId === plan.id}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {busyId === plan.id ? '删除中…' : '确认删除'}
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

              {editor !== null && editor.mode === 'edit' && editor.plan.id === plan.id && (
                <div className="mt-2">
                  <SupplementForm
                    key={plan.id}
                    initialValue={plan}
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
