import { createChildLogger } from './logger.js';

const log = createChildLogger('retry');

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelayMs = 1000,
    maxDelayMs = 60_000,
    multiplier = 2,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts) break;

      log.warn({ attempt, maxAttempts, delay, error: lastError.message }, 'Retrying after error');
      onRetry?.(attempt, lastError);

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * multiplier, maxDelayMs);
    }
  }

  throw lastError;
}
