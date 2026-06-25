import React from 'react';
import {
  ExternalLink,
  CalendarDays,
  Clock,
  MapPin,
  Timer,
  ClipboardList,
  ArrowUpRight,
} from 'lucide-react';
import WorkflowTimeline from './WorkflowTimeline';

function fmt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

const has = (v) => v && v !== '-';

export default function JobCard({ job }) {
  const todayStart = new Date(new Date().toDateString());
  const expired = job.endDateISO && new Date(job.endDateISO) < todayStart;

  let links = Array.isArray(job.registrationLinks) ? job.registrationLinks.filter((l) => l && l.url) : [];
  if (links.length === 0 && has(job.registrationLink)) {
    links = [{ label: 'Register', url: job.registrationLink }];
  }

  return (
    <article
      data-testid="job-card"
      className="job-card group relative overflow-hidden rounded-3xl border border-white/20 bg-white/10 p-5 shadow-lg backdrop-blur-md transition-transform duration-300 hover:-translate-y-1"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 data-testid="job-company" className="font-display truncate text-lg font-bold tracking-tight text-white">
            {job.companyName}
          </h3>
          {has(job.postedDate) && <p className="mt-0.5 text-[11px] text-white/45">Posted {job.postedDate}</p>}
        </div>
        <span
          data-testid="job-ctc"
          className="shrink-0 rounded-full border border-emerald-300/30 bg-emerald-400/15 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-200"
        >
          CTC · {job.ctc}
        </span>
      </div>

      {job.roles?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="job-roles">
          {job.roles.map((r, i) => (
            <span
              key={i}
              className="rounded-full border border-teal-300/30 bg-teal-400/15 px-2.5 py-1 text-[11px] font-medium text-teal-100"
            >
              {r}
            </span>
          ))}
        </div>
      )}

      {has(job.description) && <p className="mt-3 text-sm leading-relaxed text-white/70">{job.description}</p>}

      {(has(job.venue) || has(job.reportingTime)) && (
        <div className="mt-4 flex flex-wrap gap-2" data-testid="job-logistics">
          {has(job.venue) && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/75">
              <MapPin size={12} className="text-teal-200" /> {job.venue}
            </span>
          )}
          {has(job.reportingTime) && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/75">
              <Timer size={12} className="text-teal-200" /> Report by {job.reportingTime}
            </span>
          )}
        </div>
      )}

      {job.eligibilityCriteria?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" data-testid="job-eligibility">
          {job.eligibilityCriteria.map((c, i) => (
            <span key={i} className="rounded-lg border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[11px] text-white/70">
              {c}
            </span>
          ))}
        </div>
      )}

      <WorkflowTimeline steps={job.selectionWorkflow} />

      {job.additionalDetails?.length > 0 && (
        <div className="mt-4 rounded-2xl border border-white/12 bg-white/[0.05] p-3.5" data-testid="job-instructions">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
            <ClipboardList size={12} /> Before You Go
          </p>
          <ul className="space-y-1.5">
            {job.additionalDetails.map((d, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-white/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300/70" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-white/55">
        {fmt(job.startDateISO) && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={13} /> Starts {fmt(job.startDateISO)}
          </span>
        )}
        {fmt(job.endDateISO) && (
          <span className="inline-flex items-center gap-1">
            <Clock size={13} /> Closes {fmt(job.endDateISO)}
          </span>
        )}
        {expired && (
          <span data-testid="job-expired" className="rounded-full border border-rose-300/30 bg-rose-400/15 px-2 py-0.5 text-rose-200">
            Expired
          </span>
        )}
      </div>

      <div className="mt-5 space-y-2">
        {links.length > 0 ? (
          links.map((l, i) => (
            <a
              key={i}
              data-testid={`job-register-btn-${i}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500/75 to-emerald-500/75 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:from-teal-400 hover:to-emerald-400"
            >
              {links.length > 1 ? `Register · ${l.label}` : 'Register Now'} <ExternalLink size={15} />
            </a>
          ))
        ) : (
          <div
            data-testid="job-no-link"
            className="rounded-xl border border-dashed border-white/20 bg-white/5 px-4 py-2.5 text-center text-sm italic text-white/45"
          >
            Registration Link Not Provided
          </div>
        )}
      </div>

      {has(job.detailUrl) && (
        <a
          data-testid="job-details-link"
          href={job.detailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-teal-300/90 transition hover:text-teal-200"
        >
          More details on portal <ArrowUpRight size={14} />
        </a>
      )}
    </article>
  );
}
