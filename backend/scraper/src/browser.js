import puppeteer from 'puppeteer';
import { config } from './config.js';
import { logger } from './logger.js';
import { DomMutationError, AuthError } from './errors.js';

/**
 * Resolve the Chromium executable path. Railway's Railpack builder installs
 * the OS-level libraries a headless browser needs (libnss3, libgtk-3-0, etc.)
 * but does NOT install a system `chromium` binary — it expects Puppeteer's
 * own bundled download (fetched automatically into node_modules/.cache during
 * `npm install puppeteer`). So the default here is to let Puppeteer resolve
 * its own bundled executable; only override via PUPPETEER_EXECUTABLE_PATH if
 * you've deliberately configured a system browser instead.
 */
function resolveChromiumPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  return undefined; // let Puppeteer use its own bundled Chromium
}

/** Launch a headless browser instance with server-friendly flags. */
export async function launchBrowser() {
  const executablePath = resolveChromiumPath();
  logger.info('Launching browser', {
    executablePath: executablePath || '(puppeteer bundled default)',
  });

  return puppeteer.launch({
    headless: config.headless,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--incognito',
    ],
  });
}

/** Create an isolated (incognito) browser context, tolerant of API renames across Puppeteer versions. */
export async function createIncognitoContext(browser) {
  if (typeof browser.createBrowserContext === 'function') {
    return browser.createBrowserContext();
  }
  if (typeof browser.createIncognitoBrowserContext === 'function') {
    return browser.createIncognitoBrowserContext();
  }
  return browser.defaultBrowserContext();
}

/**
 * Authentication flow: navigate to login page, type credentials into the
 * exact input selectors, submit, and wait for SSR navigation to settle.
 */
export async function login(page) {
  page.setDefaultNavigationTimeout(config.navTimeoutMs);

  await page.goto(config.loginUrl, { waitUntil: 'networkidle2' });

  const { email: emailSel, password: passSel, submit: submitSel } = config.selectors;

  const emailField = await page.$(emailSel);
  const passField = await page.$(passSel);
  if (!emailField || !passField) {
    throw new AuthError('Login form inputs not found', {
      emailSelector: emailSel,
      passwordSelector: passSel,
      url: page.url(),
    });
  }

  await page.type(emailSel, config.credentials.email, { delay: 20 });
  await page.type(passSel, config.credentials.password, { delay: 20 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click(submitSel),
  ]);

  // If we are still sitting on the login form, auth did not succeed.
  const stillOnLoginForm = await page.$(passSel);
  if (stillOnLoginForm) {
    throw new AuthError('Still on login page after submit — bad credentials or changed flow', {
      url: page.url(),
    });
  }

  logger.info('Authenticated successfully', { url: page.url() });
}

/**
 * Harvest the main job table. Each row contributes:
 *   - postedDate  -> row <th>
 *   - summary     -> first <td>
 *   - detailUrl   -> href of anchor inside second <td>
 * Any missing element is treated as a DOM contract breach.
 */
export async function harvestRows(page) {
  await page.waitForSelector('table tbody tr', { timeout: config.navTimeoutMs }).catch(() => {
    throw new DomMutationError('No `table tbody tr` rows found on portal', { url: page.url() });
  });

  const raw = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    // The job table is the one whose first row <th> is the "Posted Date" header.
    const target = tables.find((t) =>
      /posted\s*date/i.test(t.querySelector('tbody tr th')?.innerText || ''),
    );
    const resolve = (rel) => {
      try {
        return new URL(rel, location.href).href;
      } catch {
        return null;
      }
    };
    // Real href when present; otherwise pull the URL out of the
    // onclick="window.open('details.php?...')" handler.
    const extractUrl = (anchor) => {
      if (!anchor) return null;
      const href = anchor.getAttribute('href');
      if (href && href !== '#' && !href.toLowerCase().startsWith('javascript')) {
        return resolve(href);
      }
      const onclick = anchor.getAttribute('onclick') || '';
      const m = onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
      return m ? resolve(m[1]) : null;
    };

    const rows = target ? [...target.querySelectorAll('tbody tr')] : [];
    return {
      found: !!target,
      rows: rows.map((tr) => {
        const th = tr.querySelector('th');
        const headerText = (th?.innerText || '').trim();
        const tds = tr.querySelectorAll('td');
        const anchor = tds[1] ? tds[1].querySelector('a') : null;
        return {
          isHeader: /posted\s*date/i.test(headerText),
          postedDate: th ? headerText : null,
          summary: tds[0] ? tds[0].innerText.trim() : null,
          detailUrl: extractUrl(anchor),
          hasTh: !!th,
          tdCount: tds.length,
          hasAnchor: !!anchor,
        };
      }),
    };
  });

  if (!raw.found) {
    throw new DomMutationError('Job table (with "Posted Date" header) not found', {
      url: page.url(),
    });
  }

  const dataRows = raw.rows.filter((r) => !r.isHeader);
  if (!dataRows.length) {
    throw new DomMutationError('Job table contains no data rows', { url: page.url() });
  }

  const jobs = [];
  dataRows.forEach((row, index) => {
    if (!row.hasTh || row.tdCount < 2 || !row.hasAnchor || !row.detailUrl) {
      throw new DomMutationError('Row is missing expected th/td/anchor structure', {
        rowIndex: index,
        hasTh: row.hasTh,
        tdCount: row.tdCount,
        hasAnchor: row.hasAnchor,
        detailUrl: row.detailUrl,
        url: page.url(),
      });
    }
    jobs.push({
      postedDate: row.postedDate,
      summary: row.summary,
      detailUrl: row.detailUrl,
    });
  });

  logger.info('Harvested job rows', { count: jobs.length });
  return jobs;
}

/**
 * Deep crawl: open the detail URL inside the same session context and
 * return the raw, unformatted text payload of the main content container.
 */
export async function crawlDetail(context, detailUrl) {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.navTimeoutMs);
  try {
    await page.goto(detailUrl, { waitUntil: 'networkidle2' });

    const detail = await page.evaluate(() => {
      const candidates = [
        'main',
        'article',
        '#content',
        '.content',
        '.container',
        '.card-body',
        '.panel-body',
      ];
      let best = null;
      let bestLen = 0;
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) {
          const len = (el.innerText || '').trim().length;
          if (len > bestLen) {
            best = el;
            bestLen = len;
          }
        }
      }
      const target = best || document.body;
      // Collect hyperlinks inside the content (anchor text -> href) so that
      // registration links are captured even when shown as link text.
      const links = [...target.querySelectorAll('a[href]')]
        .map((a) => ({ text: (a.innerText || '').trim(), href: a.href }))
        .filter(
          (l) =>
            /^https?:\/\//i.test(l.href) &&
            !/canaraengineering\.in\/(user|details|index|logout|home)/i.test(l.href),
        );
      return { text: (target.innerText || '').trim(), links };
    });

    const detailText = detail.text;
    if (!detailText) {
      throw new DomMutationError('Detail page yielded empty text payload', { detailUrl });
    }

    // Append a de-duplicated hyperlink section so the LLM can resolve labelled links.
    if (detail.links && detail.links.length) {
      const seen = new Set();
      const lines = [];
      for (const l of detail.links) {
        if (seen.has(l.href)) continue;
        seen.add(l.href);
        lines.push(`- ${l.text ? l.text + ': ' : ''}${l.href}`);
      }
      if (lines.length) {
        return `${detailText}\n\nHyperlinks on page:\n${lines.join('\n')}`;
      }
    }
    return detailText;
  } finally {
    await page.close();
  }
}