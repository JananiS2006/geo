import { NavLink, Outlet } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

const links = [
  { to: "/", label: "New analysis", end: true },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/competitors", label: "Competitors" },
  { to: "/studio", label: "Content Studio" },
];

export default function Layout() {
  return (
    <div className="min-h-screen wash">
      <nav className="sticky top-0 z-30 border-b border-line/70 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2.5 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand to-violet text-white">
              <Sparkles size={16} />
            </span>
            <span className="hidden sm:inline">AI Visibility Analyzer</span>
          </NavLink>
          <div className="ml-auto flex gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) => cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  isActive ? "bg-brand-tint text-brand-dark" : "text-ink-soft hover:text-ink hover:bg-canvas")}>
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
