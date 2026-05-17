/**
 * Error Handling Utilities
 *
 * Provides retry with exponential backoff, circuit breaker pattern,
 * and structured error logging for the distributed file storage system.
 */

export interface RetryOptions {
  maxAttempts?: number;       // default 3
  initialDelayMs?: number;    // default 1000
  backoffMultiplier?: number; // default 2
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;  // default 5
  resetTimeoutMs?: number;    // default 60_000
}

export type LogSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface StructuredError {
  severity: LogSeverity;
  timestamp: Date;
  component: string;
  message: string;
  traceId?: string;
  details?: unknown;
}

// ─── Retry with exponential backoff ──────────────────────────────────────────

/**
 * Execute an async operation with exponential backoff retry.
 * Retries on any thrown error up to maxAttempts times.
 * Delays: initialDelayMs, initialDelayMs*2, initialDelayMs*4, …
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 1000, backoffMultiplier = 2 } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is OPEN — operation rejected');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }
}

// ─── Structured error logging ─────────────────────────────────────────────────

export class ErrorLogger {
  private readonly logs: StructuredError[] = [];

  log(error: Omit<StructuredError, 'timestamp'>): void {
    const entry: StructuredError = { ...error, timestamp: new Date() };
    this.logs.push(entry);
    // In production this would write to a log aggregator
    if (entry.severity === 'critical' || entry.severity === 'error') {
      console.error(JSON.stringify(entry));
    }
  }

  getLogs(): StructuredError[] {
    return [...this.logs];
  }

  getLogsBySeverity(severity: LogSeverity): StructuredError[] {
    return this.logs.filter((l) => l.severity === severity);
  }
}

// ─── Hash validation ──────────────────────────────────────────────────────────

import crypto from 'crypto';

/**
 * Validate that the SHA-256 hash of data matches the expected hash.
 * Property 26: Hash validation detects mismatches.
 */
export function validateHash(data: Buffer, expectedHash: string): boolean {
  const actual = crypto.createHash('sha256').update(data).digest('hex');
  return actual === expectedHash;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
