import React from 'react';

/** Ordered vertical timeline of selection rounds. */
export default function WorkflowTimeline({ steps }) {
  if (!steps || steps.length === 0) return null;
  return (
    <div data-testid="workflow-timeline" className="mt-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        Selection Workflow
      </p>
      <ol className="relative ml-3 space-y-4 border-l border-white/15">
        {steps.map((step, i) => (
          <li key={i} data-testid={`workflow-step-${i}`} className="ml-5">
            <span className="absolute -left-[11px] grid h-5 w-5 place-items-center rounded-full bg-teal-400/20 text-[10px] font-bold text-teal-200 ring-1 ring-teal-300/40">
              {i + 1}
            </span>
            <p className="text-sm leading-snug text-white/85">{step}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
