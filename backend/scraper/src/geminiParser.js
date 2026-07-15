import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ── Batch size ─────────────────────────────────────────────────────────
// Group this many raw postings into ONE Gemini call instead of one call
// per posting. Directly divides your daily request count by this factor —
// the real fix for RPD (requests-per-day) quota exhaustion, which spacing
// alone can't solve.
const BATCH_SIZE = parseInt(process.env.GEMINI_BATCH_SIZE || '8', 10);

// ── Rate limiting ───────────────────────────────────────────────────────
const RPM = parseInt(process.env.GEMINI_RPM || '10', 10);
const MIN_INTERVAL_MS = Math.ceil(60000 / Math.max(1, RPM));
let lastCallAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

// ── Retry with exponential backoff for transient/quota errors ────────────
const MAX_RETRIES = parseInt(process.env.GEMINI_MAX_RETRIES || '4', 10);
const BASE_BACKOFF_MS = 3000;

function isRetryable(err) {
  const code = err?.status ?? err?.code ?? null;
  const msg = String(err?.message || '');
  return code === 429 || code === 503 || /"code":429/.test(msg) || /"code":503/.test(msg);
}

// ── Per-notice fields (shared by single + batch schemas) ─────────────────
const NOTICE_PROPERTIES = {
  companyName: { type: Type.STRING, description: 'Hiring company name.' },
  ctc: { type: Type.STRING, description: 'Compensation / CTC / stipend as written.' },
  description: { type: Type.STRING, description: 'Concise role / drive summary.' },
  eligibilityCriteria: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: 'Each eligibility rule (branches, CGPA, backlogs, batch).',
  },
  selectionWorkflow: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: 'Ordered selection rounds (e.g. "Online Test", "Technical Interview").',
  },
  registrationLink: {
    type: Type.STRING,
    nullable: true,
    description: 'Primary registration URL (first one if multiple), or null if none.',
  },
  registrationLinks: {
    type: Type.ARRAY,
    description:
      'ALL registration/apply links present, each paired with the role/context it belongs to. Even a single link goes here. If none, return [].',
    items: {
      type: Type.OBJECT,
      properties: {
        label: {
          type: Type.STRING,
          description: 'The role or context this link is for (e.g. "BA role", "SD role"). Use "Register" if unlabeled.',
        },
        url: { type: Type.STRING, description: 'The full URL of the link.' },
      },
      required: ['url'],
    },
  },
  roles: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: 'Distinct job roles/positions offered (e.g. "Software Developer", "Business Analyst").',
  },
  venue: { type: Type.STRING, description: 'Venue / location of the drive or interview, if stated.' },
  reportingTime: { type: Type.STRING, description: 'Reporting / arrival time, if stated.' },
  additionalDetails: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description:
      'Every OTHER actionable instruction, requirement, SOP item or note a student must know. One concise item per entry. Do NOT duplicate eligibility or selection rounds here.',
  },
  startDate: { type: Type.STRING, description: 'Registration/drive start date as written.' },
  endDate: { type: Type.STRING, description: 'Registration/drive end date as written.' },
};

const NOTICE_REQUIRED = [
  'companyName', 'ctc', 'description', 'eligibilityCriteria',
  'selectionWorkflow', 'startDate', 'endDate',
];

// ── Batch schema: one call, many notices, order preserved by `index` ─────
const BATCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: 'One entry per NOTICE block in the input, in any order — `index` maps each back to its input position.',
      items: {
        type: Type.OBJECT,
        properties: {
          index: {
            type: Type.INTEGER,
            description: 'The exact number from that notice\'s "--- NOTICE N ---" header.',
          },
          ...NOTICE_PROPERTIES,
        },
        required: ['index', ...NOTICE_REQUIRED],
      },
    },
  },
  required: ['items'],
};

const SYSTEM_INSTRUCTION = [
  'You are a precise data-extraction engine for college placement notices.',
  'The input contains MULTIPLE notices, each starting with a line like "--- NOTICE 3 ---".',
  'Process EVERY notice independently and return exactly one object per notice in `items`,',
  'with `index` set to the exact number from that notice\'s header — even if a notice is short or sparse.',
  'Extract ONLY information explicitly present in the provided text.',
  'NEVER invent, infer, guess, or hallucinate any value.',
  'Capture EVERY registration link. When a notice has separate links per role',
  '(e.g. one for "BA role" and one for "SD role"), return each in registrationLinks',
  'with its correct label. A "Hyperlinks on page" section may list the actual URLs —',
  'use it to resolve links that appear as anchor text.',
  'Capture venue, reportingTime, and put every other actionable instruction',
  '(documents to carry, equipment/laptop to bring, dress code, mandatory attendance,',
  'reporting instructions, notes) into additionalDetails — one concise item each.',
  'If the text does not contain a value for a field:',
  '  - for string fields, return an empty string "";',
  '  - for array fields, return an empty array [];',
  '  - for registrationLink, return null.',
  'Do not add commentary, markdown, or code fences. Output JSON only.',
].join('\n');

let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in the environment.');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// ── Output normalization ──────────────────────────────────────────────
const asString = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '-');
const asArray = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
const asLink = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t !== '-' ? t : null;
};
const asLinks = (v) => {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === 'object' && typeof x.url === 'string' && x.url.trim())
    .map((x) => ({
      label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : 'Register',
      url: x.url.trim(),
    }));
};

function normalize(data) {
  const d = data && typeof data === 'object' ? data : {};
  const registrationLinks = asLinks(d.registrationLinks);
  let registrationLink = asLink(d.registrationLink);
  if (!registrationLink && registrationLinks.length) registrationLink = registrationLinks[0].url;
  if (registrationLink && !registrationLinks.length) {
    registrationLinks.push({ label: 'Register', url: registrationLink });
  }
  return {
    companyName: asString(d.companyName),
    ctc: asString(d.ctc),
    description: asString(d.description),
    roles: asArray(d.roles),
    eligibilityCriteria: asArray(d.eligibilityCriteria),
    selectionWorkflow: asArray(d.selectionWorkflow),
    registrationLink,
    registrationLinks,
    venue: asString(d.venue),
    reportingTime: asString(d.reportingTime),
    additionalDetails: asArray(d.additionalDetails),
    startDate: asString(d.startDate),
    endDate: asString(d.endDate),
  };
}

async function callGeminiWithRetry(text, schema) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await throttle();
    try {
      return await getClient().models.generateContent({
        model: MODEL,
        contents: text,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1,
        },
      });
    } catch (err) {
      attempt += 1;
      if (!isRetryable(err) || attempt > MAX_RETRIES) throw err;
      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(backoff);
    }
  }
}

function parseJsonLoose(out) {
  try {
    return JSON.parse(out);
  } catch {
    const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  }
}

/**
 * Convert a batch of raw placement notices into structured metadata in ONE
 * Gemini call. Returns an array the SAME LENGTH and ORDER as `rawTexts` —
 * entries that were too short/empty to send, or that Gemini dropped, come
 * back as `null` so the caller can skip just that row without losing the
 * rest of the batch.
 * @param {string[]} rawTexts
 * @returns {Promise<(object|null)[]>}
 */
export async function parsePlacementBatch(rawTexts) {
  if (!Array.isArray(rawTexts) || !rawTexts.length) return [];

  const entries = rawTexts
    .map((t, i) => ({ i, text: typeof t === 'string' ? t.trim() : '' }))
    .filter((e) => e.text && e.text.length >= 15);

  if (!entries.length) return rawTexts.map(() => null);

  const prompt = entries.map((e) => `--- NOTICE ${e.i} ---\n${e.text}`).join('\n\n');

  const response = await callGeminiWithRetry(prompt, BATCH_SCHEMA);
  const out = response.text;
  if (!out || !out.trim()) throw new Error('parsePlacementBatch: Gemini returned an empty response.');

  const parsed = parseJsonLoose(out);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  const byIndex = new Map();
  for (const item of items) {
    if (item && typeof item.index === 'number') byIndex.set(item.index, normalize(item));
  }

  return rawTexts.map((_, i) => byIndex.get(i) || null);
}

/**
 * Splits `rawTexts` into chunks of GEMINI_BATCH_SIZE and processes each
 * chunk as one API call. Preserves original order across the full list.
 * @param {string[]} rawTexts
 * @returns {Promise<(object|null)[]>}
 */
export async function parsePlacementTextsChunked(rawTexts) {
  const results = new Array(rawTexts.length).fill(null);
  for (let start = 0; start < rawTexts.length; start += BATCH_SIZE) {
    const chunk = rawTexts.slice(start, start + BATCH_SIZE);
    const chunkResults = await parsePlacementBatch(chunk);
    chunkResults.forEach((r, j) => {
      results[start + j] = r;
    });
  }
  return results;
}

// Kept for any other caller still using the single-item API — now just a
// thin wrapper over the batch path with a batch of one.
export async function parsePlacementText(rawText) {
  const [result] = await parsePlacementBatch([rawText]);
  if (!result) throw new Error('parsePlacementText: Gemini returned no usable result.');
  return result;
}

export default parsePlacementText;