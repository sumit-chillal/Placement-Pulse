import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Dedicated error-reporting hook. Fires only when the routine has failed
 * MAX_CONSECUTIVE_FAILURES times in a row, signalling a probable upstream
 * DOM structure mutation rather than a transient blip.
 */
export async function reportDomMutation({ error, consecutiveFailures }) {
  const structured = typeof error?.toStructured === 'function'
    ? error.toStructured()
    : { name: error?.name, message: error?.message };

  const payload = {
    username: 'Placement Scraper Monitor',
    embeds: [
      {
        title: '🚨 Scraper failed 3 consecutive times — DOM mutation suspected',
        color: 0xc01616,
        description:
          'The placement portal scraper has failed repeatedly. The upstream ' +
          'DOM structure (table/th/td/anchor selectors) has likely changed.',
        fields: [
          { name: 'Error', value: `\`${structured.name || 'Error'}\``, inline: true },
          { name: 'Code', value: `\`${structured.code || 'N/A'}\``, inline: true },
          { name: 'Stage', value: `\`${structured.stage || 'N/A'}\``, inline: true },
          { name: 'Consecutive failures', value: `${consecutiveFailures}`, inline: true },
          { name: 'Message', value: (structured.message || 'n/a').slice(0, 1000) },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(config.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logger.error('Discord webhook returned non-2xx', { status: res.status });
    } else {
      logger.info('DOM-mutation alert dispatched to Discord');
    }
  } catch (hookErr) {
    logger.error('Failed to dispatch Discord alert', { reason: hookErr.message });
  }
}
