import type { FastifyBaseLogger } from 'fastify';
import type { FxRefreshResult } from './fx.service.ts';

const DAY_MS = 86_400_000;
const REFRESH_UTC_MS = (16 * 60 + 30) * 60_000; // 22:00 in Asia/Kolkata.

export function startDailyFxRefresh(
  refresh: () => Promise<FxRefreshResult[]>,
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>,
): () => Promise<void> {
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void>;

  async function run(): Promise<void> {
    try {
      const rates = await refresh();
      if (rates.some((rate) => rate.status === 'missing')) {
        log.warn({ rates }, 'Daily FX refresh did not return every currency');
      } else {
        log.info({ rates }, 'Daily FX refresh completed');
      }
    } catch (error) {
      log.warn({ err: error }, 'Daily FX refresh failed; retaining stored rates');
    } finally {
      if (!stopping) {
        const delay = REFRESH_UTC_MS - (Date.now() % DAY_MS);
        timer = setTimeout(
          () => {
            pending = run();
          },
          delay > 0 ? delay : delay + DAY_MS,
        ).unref();
      }
    }
  }

  pending = run();
  return async () => {
    stopping = true;
    clearTimeout(timer);
    await pending;
  };
}
