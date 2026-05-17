import { withRetry, CircuitBreaker, ErrorLogger, validateHash } from '../../src/error-handling';
import crypto from 'crypto';

describe('Error Handling', () => {
  // ─── withRetry ────────────────────────────────────────────────────────────

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const op = jest.fn().mockResolvedValue('ok');
      const result = await withRetry(op, { maxAttempts: 3, initialDelayMs: 0 });
      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds on second attempt', async () => {
      const op = jest.fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce('ok');

      const result = await withRetry(op, { maxAttempts: 3, initialDelayMs: 0 });

      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all attempts', async () => {
      const op = jest.fn().mockRejectedValue(new Error('always fails'));

      await expect(
        withRetry(op, { maxAttempts: 3, initialDelayMs: 0 })
      ).rejects.toThrow('always fails');
      expect(op).toHaveBeenCalledTimes(3);
    });
  });

  // ─── CircuitBreaker ───────────────────────────────────────────────────────

  describe('CircuitBreaker', () => {
    it('starts in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe('closed');
    });

    it('opens after reaching failure threshold', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
      const fail = () => Promise.reject(new Error('fail'));

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(fail)).rejects.toThrow();
      }

      expect(cb.getState()).toBe('open');
    });

    it('rejects immediately when open', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(
        /circuit breaker is OPEN/i
      );
    });

    it('resets to closed after successful execution in half-open state', async () => {
      jest.useFakeTimers();
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });

      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.getState()).toBe('open');

      jest.advanceTimersByTime(1001);

      await cb.execute(() => Promise.resolve('ok'));
      expect(cb.getState()).toBe('closed');

      jest.useRealTimers();
    });
  });

  // ─── ErrorLogger ──────────────────────────────────────────────────────────

  describe('ErrorLogger', () => {
    it('stores logged errors', () => {
      const logger = new ErrorLogger();
      logger.log({ severity: 'error', component: 'test', message: 'something failed' });

      expect(logger.getLogs()).toHaveLength(1);
      expect(logger.getLogs()[0].message).toBe('something failed');
    });

    it('filters logs by severity', () => {
      const logger = new ErrorLogger();
      logger.log({ severity: 'info', component: 'c', message: 'info msg' });
      logger.log({ severity: 'error', component: 'c', message: 'error msg' });
      logger.log({ severity: 'critical', component: 'c', message: 'critical msg' });

      expect(logger.getLogsBySeverity('error')).toHaveLength(1);
      expect(logger.getLogsBySeverity('critical')).toHaveLength(1);
      expect(logger.getLogsBySeverity('info')).toHaveLength(1);
    });

    it('includes timestamp in each log entry', () => {
      const logger = new ErrorLogger();
      logger.log({ severity: 'warn', component: 'c', message: 'msg' });

      expect(logger.getLogs()[0].timestamp).toBeInstanceOf(Date);
    });
  });

  // ─── validateHash ─────────────────────────────────────────────────────────

  describe('validateHash', () => {
    it('returns true for correct hash', () => {
      const data = Buffer.from('hello world');
      const hash = crypto.createHash('sha256').update(data).digest('hex');

      expect(validateHash(data, hash)).toBe(true);
    });

    it('returns false for incorrect hash', () => {
      const data = Buffer.from('hello world');
      const wrongHash = 'a'.repeat(64);

      expect(validateHash(data, wrongHash)).toBe(false);
    });

    it('detects single-byte modification', () => {
      const data = Buffer.from('hello world');
      const hash = crypto.createHash('sha256').update(data).digest('hex');

      const tampered = Buffer.from(data);
      tampered[0] ^= 0xff;

      expect(validateHash(tampered, hash)).toBe(false);
    });
  });
});
