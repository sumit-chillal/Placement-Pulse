const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = ⁠ ${BACKEND_URL}/api ⁠;

export async function fetchJobs({ includeExpired = false, limit = 100 } = {}) {
  const res = await fetch(
    ⁠ ${API}/jobs?include_expired=${includeExpired}&limit=${limit} ⁠,
  );
  if (!res.ok) throw new Error(⁠ Failed to load drives (HTTP ${res.status}) ⁠);
  return res.json();
}
