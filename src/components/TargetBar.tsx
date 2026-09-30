interface TargetBarProps {
  label?: string;
  value: number;
  target: number;
  unit: string;
  /** 三列窄布局：数值已经由标题行给出，这里只留进度条和百分比，避免同一列里数值出现两次 */
  compact?: boolean;
}

/**
 * 目标进度条：超额时换成红色，比继续拉满蓝色更能说明问题。
 * Today 页和报告页共用 —— 两处各写一份的话，"超额怎么显示"迟早会不一致。
 */
export default function TargetBar({ label, value, target, unit, compact = false }: TargetBarProps) {
  const percent = target > 0 ? Math.round((value / target) * 100) : 0;
  const width = Math.min(100, Math.max(0, percent));
  const tone = value > target ? 'bg-red-500' : 'bg-blue-500';

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          {/* 宽度是运行时算出来的，Tailwind 的静态类名表达不了，只能走内联 style */}
          <div className={`h-2 rounded-full ${tone}`} style={{ width: `${width}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-600">{percent}%</span>
      </div>
    );
  }

  return (
    <div>
      {/* 报告页的三列布局里每列只有一百多像素，CJK 文本允许逐字断行，
          会把「目标」拆成两行。缩到 nowrap 并让整行换行，窄列时数值整体下移。 */}
      <div className="flex flex-wrap justify-between gap-x-2 text-xs text-slate-600">
        {label !== undefined && <span className="whitespace-nowrap">{label}</span>}
        <span className="ml-auto whitespace-nowrap tabular-nums">
          {value} / {target} {unit}（{percent}%）
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        {/* 宽度是运行时算出来的，Tailwind 的静态类名表达不了，只能走内联 style */}
        <div
          className={`h-2 rounded-full ${tone}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
