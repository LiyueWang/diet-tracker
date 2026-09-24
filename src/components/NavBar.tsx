import { NavLink } from 'react-router-dom';

// '/' 需要 end：否则首页在 /record 等路径下也会被判成 active
const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: '今日', end: true },
  { to: '/record', label: '记录' },
  { to: '/library', label: '食物库' },
  { to: '/reports', label: '报告' },
  { to: '/settings', label: '设置' },
];

export default function NavBar() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto p-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
