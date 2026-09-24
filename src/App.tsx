import { Route, Routes } from 'react-router-dom';

import NavBar from './components/NavBar';
import FoodLibrary from './pages/FoodLibrary';
import Record from './pages/Record';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Today from './pages/Today';

export default function App() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <NavBar />
      <main className="mx-auto max-w-3xl p-4">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/record" element={<Record />} />
          <Route path="/library" element={<FoodLibrary />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
