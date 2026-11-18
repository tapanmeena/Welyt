import type { FastifyBaseLogger } from 'fastify';
import { startDailyJob } from '../../lib/daily-job.ts';
import type { FxRefreshResult } from './fx.service.ts';

const REFRESH_UTC_MS = (16 * 60 + 30) * 60_000; // 22:00 in Asia/Kolkata.

export function startDailyFxRefresh(
  refresh: () => Promise<FxRefreshResult[]>,
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): () => Promise<void> {
  return startDailyJob(
    REFRESH_UTC_MS,
    refresh,
    (rates) => {
      if (rates.some((rate) => rate.status === 'missing')) {
        log.warn({ rates }, 'Daily FX refresh did not return every currency');
      } else {
        log.info({ rates }, 'Daily FX refresh completed');
      }
    },
    (error) => log.warn({ err: error }, 'Daily FX refresh failed; retaining stored rates'),
  );
}
