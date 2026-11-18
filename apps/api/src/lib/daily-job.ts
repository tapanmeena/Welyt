const DAY_MS = 86_400_000;

export function startDailyJob<Result>(
  timeOfDayUtcMs: number,
  check: () => Promise<Result> | Result,
  onSuccess: (result: Result) => void,
  onError: (error: unknown) => void,
): () => Promise<void> {
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void>;

  async function run(): Promise<void> {
    try {
      onSuccess(await check());
    } catch (error) {
      onError(error);
    } finally {
      if (!stopping) {
        const delay = timeOfDayUtcMs - (Date.now() % DAY_MS);
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
