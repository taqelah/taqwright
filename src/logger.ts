export const logger = {
  log: (...args: unknown[]) => console.log('[taqwright]', ...args),
  warn: (...args: unknown[]) => console.warn('[taqwright]', ...args),
  error: (...args: unknown[]) => console.error('[taqwright]', ...args),
};
