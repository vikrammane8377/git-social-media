import { NavLink, Route, Routes } from "react-router-dom";
import { Overview } from "./pages/Overview";
import { SlotDetail } from "./pages/SlotDetail";
import { Events } from "./pages/Events";
import { Plans } from "./pages/Plans";
import { Health } from "./pages/Health";
import { Runs } from "./pages/Runs";
import { Assets } from "./pages/Assets";
import { Settings } from "./pages/Settings";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/events", label: "Events", end: false },
  { to: "/plans", label: "Plans", end: false },
  { to: "/assets", label: "Assets", end: false },
  { to: "/runs", label: "Runs", end: false },
  { to: "/settings", label: "Settings", end: false },
  { to: "/health", label: "Health", end: false },
];

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Bix Pipeline</div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/slots/:id" element={<SlotDetail />} />
          <Route path="/events" element={<Events />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/health" element={<Health />} />
        </Routes>
      </main>
    </div>
  );
}
