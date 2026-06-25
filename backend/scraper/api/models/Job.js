import mongoose from 'mongoose';

/**
 * Job listing schema. Defaults mirror the parser's normalization contract
 * ("-" for absent strings, [] for arrays, null for a missing link).
 */
const jobSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true },
    ctc: { type: String, default: '-' },
    description: { type: String, default: '-' },
    roles: { type: [String], default: [] },
    eligibilityCriteria: { type: [String], default: [] },
    selectionWorkflow: { type: [String], default: [] },
    registrationLink: { type: String, default: null },
    registrationLinks: {
      type: [{ label: { type: String }, url: { type: String }, _id: false }],
      default: [],
    },
    venue: { type: String, default: '-' },
    reportingTime: { type: String, default: '-' },
    additionalDetails: { type: [String], default: [] },
    startDate: { type: String, default: '-' },
    endDate: { type: String, default: '-' },
    // Normalized chronological dates (parsed from the messy string fields).
    startDateISO: { type: Date, default: null },
    endDateISO: { type: Date, default: null },
    // Stable scrape key used to skip already-processed detail pages.
    detailUrl: { type: String, default: null },
    postedDate: { type: String, default: '-' },
    uniqueHash: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

// Unique index — absolute dedup guarantee under high write contention
// (declared via `unique: true` on the field above).
// Compound index — fast sorted/filtered reads for 2000+ concurrent users.
jobSchema.index({ endDate: 1, companyName: 1 });
// Chronological index for true date-sorted feeds + expired filtering.
jobSchema.index({ endDateISO: 1 });
jobSchema.index({ detailUrl: 1 }, { sparse: true });

export const Job = mongoose.model('Job', jobSchema);
