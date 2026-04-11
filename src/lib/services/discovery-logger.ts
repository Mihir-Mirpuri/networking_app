/**
 * Discovery Logger — per-request structured logging for the discovery pipeline.
 *
 * Usage model:
 * - Entry points (`extractSearchFiltersAction`, `searchPeopleV2Action`) call
 *   `createLoggerForQuery(query)`. It returns `null` unless
 *   `DISCOVERY_LOGGER_ENABLED=1`.
 * - When non-null, the entry point wraps its body in `withLogger(logger, fn)`.
 *   Downstream code emits structured entries via the `log.*()` helpers, which
 *   look up the logger from `AsyncLocalStorage`.
 * - When no logger is active in the current async context, every `log.*()`
 *   call is an immediate return — zero side effects.
 * - At the end of the request, the entry point calls `logger.finalize()` which
 *   writes a single JSONL file to `logs/discovery/<timestamp>-<slug>.jsonl`.
 *
 * This module only depends on Node built-ins (async_hooks, fs/promises, path,
 * crypto) — no new npm dependencies.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type LogKind = 'info' | 'decision' | 'llm' | 'api' | 'db' | 'error';

export interface LogEntry {
  ts: string; // ISO timestamp
  elapsedMs: number; // ms since logger start
  component: string; // 'ai-search' | 'search-v2' | 'anthropic' | ...
  step?: string; // optional sub-step identifier
  level: LogLevel;
  kind: LogKind;
  message?: string;
  data?: Record<string, unknown>;
}

export interface LlmCallData {
  provider: 'anthropic' | 'perplexity' | 'groq';
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  rawResponse: string;
  parsedResponse?: unknown;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number; // Anthropic prompt caching
  cacheReadTokens?: number; // Anthropic prompt caching
  durationMs: number;
  costUsd?: number;
  error?: string;
}

export interface ApiCallData {
  service: string; // 'apify-linkedin-short' | 'perplexity-sonar' | 'serper'
  endpoint?: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  statusCode?: number;
  durationMs: number;
  costUsd?: number;
  error?: string;
}

export interface LoggerRunSummary {
  runId: string;
  query: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalCostUsd: number;
  costBreakdown: Record<string, number>;
  cacheStats: { creationTokens: number; readTokens: number };
  entryCount: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

// ─── Cost helpers ────────────────────────────────────────────────────────────

// Anthropic Haiku 4.5 pricing (per million tokens):
//   Input:  $1.00 / 1M
//   Output: $5.00 / 1M
//   Cache write (creation): 1.25x input = $1.25 / 1M
//   Cache read:             0.10x input = $0.10 / 1M
export function anthropicHaikuCost(
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0
): number {
  const INPUT_PER_M = 1.0;
  const OUTPUT_PER_M = 5.0;
  const CACHE_WRITE_PER_M = 1.25;
  const CACHE_READ_PER_M = 0.1;
  // promptTokens already excludes cached tokens in Anthropic's SDK; the cache
  // creation/read counts are reported separately.
  const inputCost = (promptTokens / 1_000_000) * INPUT_PER_M;
  const outputCost = (completionTokens / 1_000_000) * OUTPUT_PER_M;
  const cacheWriteCost = (cacheCreationTokens / 1_000_000) * CACHE_WRITE_PER_M;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * CACHE_READ_PER_M;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export const PERPLEXITY_SONAR_COST_PER_REQUEST = 0.005; // $0.005 per Sonar request
export const APIFY_SHORT_COST_PER_PAGE = 0.1; // $0.10 per Apify Short page
export const SERPER_COST_PER_REQUEST = 0.001; // $0.001 per Serper request
// Apify full-profile scraper (actor LpVuK3Zozwuipa5bp) — per-profile pricing
// from its two modes: "Profile details no email" and "Profile details + email search".
export const APIFY_FULL_COST_PER_PROFILE_NO_EMAIL = 0.004; // $4 per 1,000 profiles
export const APIFY_FULL_COST_PER_PROFILE_EMAIL = 0.01; // $10 per 1,000 profiles

// ─── DiscoveryLogger class ───────────────────────────────────────────────────

export interface DiscoveryLoggerOptions {
  query: string;
  runId?: string;
  filePath?: string;
}

export class DiscoveryLogger {
  public readonly runId: string;
  public readonly query: string;
  public readonly startedAt: number;
  public readonly filePath: string | null;

  private entries: LogEntry[] = [];
  private costBreakdown: Record<string, number> = {};
  private cacheStats = { creationTokens: 0, readTokens: 0 };
  private readonly consoleMirror: boolean;

  constructor(opts: DiscoveryLoggerOptions) {
    this.runId = opts.runId ?? generateRunId();
    this.query = opts.query;
    this.startedAt = Date.now();
    this.filePath = opts.filePath ?? null;
    this.consoleMirror = process.env.DISCOVERY_LOGGER_CONSOLE === '1';
  }

  private push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.consoleMirror) {
      const dataStr = entry.data ? ' ' + safeStringify(entry.data) : '';
      const stepStr = entry.step ? `/${entry.step}` : '';
      // eslint-disable-next-line no-console
      console.log(
        `[+${entry.elapsedMs}ms] ${entry.component}/${entry.kind}${stepStr} ${entry.message || ''}${dataStr}`
      );
    }
  }

  private now(): { ts: string; elapsedMs: number } {
    const nowMs = Date.now();
    return {
      ts: new Date(nowMs).toISOString(),
      elapsedMs: nowMs - this.startedAt,
    };
  }

  info(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const { ts, elapsedMs } = this.now();
    this.push({
      ts,
      elapsedMs,
      component,
      step,
      level: 'info',
      kind: 'info',
      message,
      data,
    });
  }

  warn(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const { ts, elapsedMs } = this.now();
    this.push({
      ts,
      elapsedMs,
      component,
      step,
      level: 'warn',
      kind: 'info',
      message,
      data,
    });
  }

  error(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const { ts, elapsedMs } = this.now();
    this.push({
      ts,
      elapsedMs,
      component,
      step,
      level: 'error',
      kind: 'error',
      message,
      data,
    });
  }

  decision(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const { ts, elapsedMs } = this.now();
    this.push({
      ts,
      elapsedMs,
      component,
      step,
      level: 'info',
      kind: 'decision',
      message,
      data,
    });
  }

  llm(component: string, data: LlmCallData, step?: string): void {
    const { ts, elapsedMs } = this.now();
    this.push({
      ts,
      elapsedMs,
      component,
      step,
      level: data.error ? 'error' : 'info',
      kind: 'llm',
      message: data.error ? `LLM call failed: ${data.provider}/${data.model}` : `LLM call: ${data.provider}/${data.model}`,
      data: data as unknown as Record<string, unknown>,
    });
    // Aggregate cost + cache stats
    if (typeof data.costUsd === 'number') {
      const key = `${data.provider}:${data.model}`;
      this.costBreakdown[key] = (this.costBreakdown[key] ?? 0) + data.costUsd;
    }
    if (data.cacheCreationTokens) {
      this.cacheStats.creationTokens += data.cacheCreationTokens;
    }
    if (data.cacheReadTokens) {
      this.cacheStats.readTokens += data.cacheReadTokens;
    }
  }

  api(component: string, data: ApiCallData, step?: string): void {
    const { ts, elapsedMs } = this.now();
    this.push({
      ts,
      elapsedMs,
      component,
      step,
      level: data.error ? 'error' : 'info',
      kind: 'api',
      message: data.error ? `API call failed: ${data.service}` : `API call: ${data.service}`,
      data: data as unknown as Record<string, unknown>,
    });
    if (typeof data.costUsd === 'number') {
      this.costBreakdown[data.service] = (this.costBreakdown[data.service] ?? 0) + data.costUsd;
    }
  }

  addCost(category: string, amount: number): void {
    this.costBreakdown[category] = (this.costBreakdown[category] ?? 0) + amount;
  }

  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  async finalize(
    status: 'success' | 'error',
    errorMessage?: string
  ): Promise<LoggerRunSummary> {
    const finishedAtMs = Date.now();
    const totalCostUsd = Object.values(this.costBreakdown).reduce(
      (sum, v) => sum + v,
      0
    );
    const summary: LoggerRunSummary = {
      runId: this.runId,
      query: this.query,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - this.startedAt,
      totalCostUsd,
      costBreakdown: { ...this.costBreakdown },
      cacheStats: { ...this.cacheStats },
      entryCount: this.entries.length,
      status,
      errorMessage,
    };

    if (this.filePath) {
      try {
        const lines: string[] = [];
        lines.push(
          safeStringify({
            type: 'run_start',
            runId: this.runId,
            query: this.query,
            startedAt: summary.startedAt,
            cwd: process.cwd(),
          })
        );
        for (const entry of this.entries) {
          lines.push(safeStringify({ type: 'entry', ...entry }));
        }
        lines.push(safeStringify({ type: 'run_end', ...summary }));
        await writeFile(this.filePath, lines.join('\n') + '\n', 'utf8');
      } catch (err) {
        // Never throw from finalize — logging should not break the request
        // eslint-disable-next-line no-console
        console.error(
          `[discovery-logger] Failed to write log file ${this.filePath}:`,
          err
        );
      }
    }

    return summary;
  }
}

// ─── AsyncLocalStorage context ───────────────────────────────────────────────

const storage = new AsyncLocalStorage<DiscoveryLogger>();

export function getCurrentLogger(): DiscoveryLogger | undefined {
  return storage.getStore();
}

export function withLogger<T>(
  logger: DiscoveryLogger,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(logger, fn);
}

// ─── Safe helper (no-op when no logger in context) ──────────────────────────

export const log = {
  info(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.info(component, message, data, step);
  },
  warn(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.warn(component, message, data, step);
  },
  error(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.error(component, message, data, step);
  },
  decision(
    component: string,
    message: string,
    data?: Record<string, unknown>,
    step?: string
  ): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.decision(component, message, data, step);
  },
  llm(component: string, data: LlmCallData, step?: string): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.llm(component, data, step);
  },
  api(component: string, data: ApiCallData, step?: string): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.api(component, data, step);
  },
  addCost(category: string, amount: number): void {
    const logger = getCurrentLogger();
    if (!logger) return;
    logger.addCost(category, amount);
  },
};

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Returns a `DiscoveryLogger` configured to write to
 * `logs/discovery/<timestamp>-<slug>.jsonl` when `DISCOVERY_LOGGER_ENABLED=1`,
 * or `null` otherwise. Entry points call this and wrap their body in
 * `withLogger(logger, fn)` when non-null.
 */
export function createLoggerForQuery(query: string): DiscoveryLogger | null {
  if (process.env.DISCOVERY_LOGGER_ENABLED !== '1') {
    return null;
  }

  const runId = generateRunId();
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
  const slug = slugify(query, 60);
  const fileName = `${timestamp}-${slug}-${runId.slice(0, 6)}.jsonl`;
  const dir = join(process.cwd(), 'logs', 'discovery');
  const filePath = join(dir, fileName);

  // Fire-and-forget mkdir — the actual write only happens in finalize(), by
  // which time this will have resolved. mkdir with recursive:true is idempotent.
  mkdir(dir, { recursive: true }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[discovery-logger] Failed to create log dir ${dir}:`, err);
  });

  return new DiscoveryLogger({ query, runId, filePath });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function generateRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

function slugify(input: string, maxLen: number): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'query'
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    // Circular references or non-serializable values — fall back to a safe
    // representation that won't crash the logger.
    return JSON.stringify({
      _unserializable: true,
      _type: typeof value,
    });
  }
}
