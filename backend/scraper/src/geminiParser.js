import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ── Structured-output schema ─────────────────────────────────────────────
// Forces Gemini to emit JSON matching this exact shape (no prose, no fences).
const PLACEMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
            description:
              'The role or context this link is for (e.g. "BA role", "SD role"). Use "Register" if it is unlabeled.',
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
        'Every OTHER actionable instruction, requirement, SOP item or note a student must know — e.g. documents to carry, laptop/equipment to bring, dress code / formal attire, mandatory attendance, reporting instructions. One concise item per entry. Do NOT duplicate eligibility or selection rounds here.',
    },
    startDate: { type: Type.STRING, description: 'Registration/drive start date as written.' },
    endDate: { type: Type.STRING, description: 'Registration/drive end date as written.' },
  },
  required: [
    'companyName',
    'ctc',
    'description',
    'eligibilityCriteria',
    'selectionWorkflow',
    'startDate',
    'endDate',
  ],
  propertyOrdering: [
    'companyName',
    'ctc',
    'description',
    'roles',
    'eligibilityCriteria',
    'selectionWorkflow',
    'registrationLink',
    'registrationLinks',
    'venue',
    'reportingTime',
    'additionalDetails',
    'startDate',
    'endDate',
  ],
};

// ── Zero-knowledge safety system prompt ──────────────────────────────────
const SYSTEM_INSTRUCTION = [
  'You are a precise data-extraction engine for college placement notices.',
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

// Lazily-constructed client so an empty rawText can be rejected without
// requiring (or validating) the API key — preserving quota.
let client = null;
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in the environment.');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// ── Output normalization / validation wrapper ────────────────────────────
const asString = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '-');
const asArray = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
const asLink = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t !== '-' && /^https?:\/\//i.test(t) ? t : t && t !== '-' ? t : null;
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
  // Backfill the single link from the array (or vice-versa) for consistency.
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

// ── Input validation (runs BEFORE any API call to protect quota) ──────────
function validateInput(rawText) {
  if (typeof rawText !== 'string') {
    throw new Error('parsePlacementText: rawText must be a string.');
  }
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('parsePlacementText: rawText is empty — request rejected (no API call made).');
  }
  if (trimmed.length < 15) {
    throw new Error('parsePlacementText: rawText too short to contain placement info — rejected.');
  }
  return trimmed;
}

/**
 * Convert a raw placement notice into a verified, clean metadata object.
 * @param {string} rawText
 * @returns {Promise<{companyName,ctc,description,eligibilityCriteria,selectionWorkflow,registrationLink,startDate,endDate}>}
 */
export async function parsePlacementText(rawText) {
  const text = validateInput(rawText);

  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: text,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: PLACEMENT_SCHEMA,
      temperature: 0.1,
    },
  });

  const out = response.text;
  if (!out || !out.trim()) {
    throw new Error('parsePlacementText: Gemini returned an empty response.');
  }

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    // Defensive: strip stray code fences if the model ever wraps output.
    const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  }

  return normalize(parsed);
}

export default parsePlacementText;
