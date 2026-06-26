import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Bell, GraduationCap, Loader2 } from 'lucide-react';
import { fetchJobs } from '../lib/api';
import { initPush } from '../lib/firebasePush';
import FilterBar from './FilterBar';
import JobCard from './JobCard';

export default function Dashboard() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showExpired, setShowExpired] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);

  const load = async (expired) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchJobs({ includeExpired: expired, limit: 100 });
      setJobs(d.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(showExpired);
  }, [showExpired]);

  // Return visits: if the student already granted permission, silently
  // re-register their token to the topic — zero manual setup.
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      initPush({ silent: true }).then((r) => {
        if (r?.ok) setAlertsOn(true);
      });
    }
  }, []);

  // High-performance local filtering — fully memoized for smooth re-renders.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(toDate) : null;
    return jobs.filter((j) => {
      if (q && !(j.companyName || '').toLowerCase().includes(q)) return false;
      if (from && j.startDateISO && new Date(j.startDateISO) < from) return false;
      if (to && j.endDateISO && new Date(j.endDateISO) > to) return false;
      return true;
    });
  }, [jobs, query, fromDate, toDate]);

const enableAlerts = async () => {
  const res = await initPush();

  console.log("initPush result:", res);

  if (res?.ok) {
    setAlertsOn(true);
    alert("You're subscribed!");
  } else if (res?.reason === "not-configured") {
    alert("Push alerts need Firebase config.");
  } else if (res?.reason === "denied") {
    alert("Notifications are blocked.");
  } else {
    alert("Push failed: " + JSON.stringify(res));
  }
};

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/icons/icon-192.png"
            alt="Placement Pulse logo"
            className="h-11 w-11 rounded-2xl border border-white/20 shadow-md"
          />
          <div>
            <h1 className="font-display text-xl font-extrabold tracking-tight text-white">
              Placement Pulse
            </h1>
            <p data-testid="active-count" className="text-[11px] text-white/45">
              {filtered.length} active drive{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="enable-alerts-btn"
            onClick={enableAlerts}
            aria-label="Enable push alerts"
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 text-white/80 transition hover:bg-white/15"
          >
            <Bell size={18} className={alertsOn ? 'text-teal-300' : ''} />
          </button>
          <button
            data-testid="refresh-btn"
            onClick={() => load(showExpired)}
            aria-label="Refresh drives"
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 text-white/80 transition hover:bg-white/15"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <FilterBar
        query={query}
        setQuery={setQuery}
        fromDate={fromDate}
        setFromDate={setFromDate}
        toDate={toDate}
        setToDate={setToDate}
        showExpired={showExpired}
        setShowExpired={setShowExpired}
      />

      <div className="mt-5 space-y-4" data-testid="jobs-list">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-white/60">
            <Loader2 className="animate-spin" size={18} /> Loading drives…
          </div>
        )}
        {!loading && error && (
          <div
            data-testid="jobs-error"
            className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-5 text-center text-sm text-rose-200"
          >
            Couldn’t load drives: {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div
            data-testid="jobs-empty"
            className="rounded-2xl border border-white/15 bg-white/5 p-10 text-center text-sm text-white/50"
          >
            No drives match your filters.
          </div>
        )}
        {!loading &&
          !error &&
          filtered.map((j) => <JobCard key={j.uniqueHash || j.detailUrl || j.companyName} job={j} />)}
      </div>
    </div>
  );
}
