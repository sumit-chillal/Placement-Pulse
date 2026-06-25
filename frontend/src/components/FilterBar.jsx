import React from 'react';
import { Search } from 'lucide-react';

/** Top-of-feed local filter controls (company text + date boundaries). */
export default function FilterBar({
  query,
  setQuery,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  showExpired,
  setShowExpired,
}) {
  return (
    <div
      data-testid="filter-bar"
      className="sticky top-3 z-20 rounded-3xl border border-white/20 bg-white/10 p-4 shadow-lg backdrop-blur-xl"
    >
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          data-testid="filter-company"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company…"
          className="w-full rounded-xl border border-white/15 bg-white/[0.07] py-2.5 pl-9 pr-3 text-sm text-white placeholder-white/40 outline-none transition focus:border-teal-300/40"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-[11px] tracking-wide text-white/50">
          Starts after
          <input
            data-testid="filter-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/15 bg-white/[0.07] px-2 py-2 text-xs text-white outline-none transition focus:border-teal-300/40"
          />
        </label>
        <label className="text-[11px] tracking-wide text-white/50">
          Closes before
          <input
            data-testid="filter-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/15 bg-white/[0.07] px-2 py-2 text-xs text-white outline-none transition focus:border-teal-300/40"
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-white/60">
        <input
          data-testid="filter-expired"
          type="checkbox"
          checked={showExpired}
          onChange={(e) => setShowExpired(e.target.checked)}
          className="h-3.5 w-3.5 accent-teal-400"
        />
        Show expired drives
      </label>
    </div>
  );
}
