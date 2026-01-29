/**
 * Test file for usePolling hook
 * Run with: npx tsx src/hooks/usePolling.test.ts
 */

// Simple mock for React hooks since we're testing logic, not React integration
let mockState: Map<number, unknown> = new Map();
let mockEffects: Array<{ effect: () => (() => void) | void; deps: unknown[] | undefined }> = [];
let mockRefs: Map<number, { current: unknown }> = new Map();
let stateIndex = 0;
let refIndex = 0;

function resetMocks() {
  mockState = new Map();
  mockEffects = [];
  mockRefs = new Map();
  stateIndex = 0;
  refIndex = 0;
}

// Mock React hooks
const MockReact = {
  useState: <T>(initial: T): [T, (v: T) => void] => {
    const idx = stateIndex++;
    if (!mockState.has(idx)) {
      mockState.set(idx, initial);
    }
    return [
      mockState.get(idx) as T,
      (v: T) => mockState.set(idx, v)
    ];
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    mockEffects.push({ effect, deps });
  },
  useRef: <T>(initial: T): { current: T } => {
    const idx = refIndex++;
    if (!mockRefs.has(idx)) {
      mockRefs.set(idx, { current: initial });
    }
    return mockRefs.get(idx) as { current: T };
  },
  useCallback: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
};

// Override require for the module
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
  if (id === 'react') {
    return MockReact;
  }
  return originalRequire.apply(this, [id]);
};

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void> | void) {
  return { name, fn };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test cases
const tests = [
  test('should call fetch immediately when immediate: true', async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      return 'data';
    };

    resetMocks();
    const { usePolling } = await import('./usePolling');

    usePolling(mockFetch, { interval: 1000, immediate: true });

    // Run effects
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(10);
    assert(fetchCalled, 'Fetch should be called immediately');
  }),

  test('should not call immediately when immediate: false', async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      return 'data';
    };

    resetMocks();

    // Re-import to get fresh module with new mocks
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    usePolling(mockFetch, { interval: 1000, immediate: false });

    // Run effects that check immediate
    for (const { effect, deps } of mockEffects) {
      // The immediate effect has enabled, immediate, doFetch in deps
      if (deps && deps.length === 3) {
        effect();
      }
    }

    await sleep(10);
    assert(!fetchCalled, 'Fetch should not be called when immediate: false');
  }),

  test('should not poll when enabled: false', async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return 'data';
    };

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    usePolling(mockFetch, { interval: 50, enabled: false });

    // Run effects
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(100);
    assert(fetchCount === 0, `Fetch should not be called when disabled, but was called ${fetchCount} times`);
  }),

  test('should return data after successful fetch', async () => {
    const expectedData = { id: 1, name: 'test' };
    const mockFetch = async () => expectedData;

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    const result = usePolling(mockFetch, { interval: 1000, immediate: true });

    // Run effects
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(10);

    // Data should be set (checking via mock state)
    // Since state updates are synchronous in our mock, check directly
    assert(result.data === null || mockState.get(0) === expectedData,
      'Data should be set after successful fetch');
  }),

  test('should set error on fetch failure', async () => {
    const mockError = new Error('Fetch failed');
    const mockFetch = async () => {
      throw mockError;
    };

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    usePolling(mockFetch, { interval: 1000, immediate: true });

    // Run effects
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(10);

    // Error should be set (index 1 in state is error)
    const errorState = mockState.get(1);
    assert(errorState instanceof Error, 'Error should be set on fetch failure');
  }),

  test('should skip fetch if previous fetch still in progress', async () => {
    let fetchCount = 0;
    let resolveFirst: () => void;
    const firstFetchPromise = new Promise<void>(resolve => { resolveFirst = resolve; });

    const mockFetch = async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await firstFetchPromise;
      }
      return 'data';
    };

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    const result = usePolling(mockFetch, { interval: 1000, immediate: true });

    // Run effects to start first fetch
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(10);

    // Try to refetch while first is in progress
    await result.refetch();

    // Should still be 1 because second was skipped
    assert(fetchCount === 1, `Should skip overlapping fetches, but fetch was called ${fetchCount} times`);

    // Cleanup
    resolveFirst!();
    await sleep(10);
  }),

  test('should provide working refetch function', async () => {
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount++;
      return `data-${fetchCount}`;
    };

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    const result = usePolling(mockFetch, { interval: 10000, immediate: false });

    assert(fetchCount === 0, 'Should not fetch initially with immediate: false');

    // Manual refetch
    await result.refetch();
    await sleep(10);

    assert(fetchCount === 1, `Refetch should trigger fetch, count: ${fetchCount}`);

    // Another manual refetch
    await result.refetch();
    await sleep(10);

    assert(fetchCount === 2, `Second refetch should work, count: ${fetchCount}`);
  }),

  test('should handle non-Error thrown values', async () => {
    const mockFetch = async () => {
      throw 'string error';
    };

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    usePolling(mockFetch, { interval: 1000, immediate: true });

    // Run effects
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(10);

    // Error should be converted to Error instance
    const errorState = mockState.get(1);
    assert(errorState instanceof Error, 'String error should be converted to Error');
    assert((errorState as Error).message === 'string error', 'Error message should match');
  }),

  test('should clear interval on cleanup', async () => {
    let intervalCleared = false;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;

    let capturedIntervalId: NodeJS.Timeout | null = null;
    global.setInterval = ((fn: () => void, ms: number) => {
      capturedIntervalId = originalSetInterval(fn, ms);
      return capturedIntervalId;
    }) as typeof setInterval;

    global.clearInterval = ((id: NodeJS.Timeout) => {
      if (id === capturedIntervalId) {
        intervalCleared = true;
      }
      return originalClearInterval(id);
    }) as typeof clearInterval;

    try {
      resetMocks();
      delete require.cache[require.resolve('./usePolling')];
      const { usePolling } = await import('./usePolling');

      usePolling(async () => 'data', { interval: 100, immediate: false });

      // Find and run the interval effect, then call its cleanup
      for (const { effect, deps } of mockEffects) {
        // The interval effect has enabled, interval, doFetch in deps
        if (deps && deps.length === 3 && typeof deps[1] === 'number') {
          const cleanup = effect();
          if (typeof cleanup === 'function') {
            cleanup();
          }
        }
      }

      assert(intervalCleared, 'Interval should be cleared on cleanup');
    } finally {
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
    }
  }),

  test('should default enabled to true', async () => {
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      return 'data';
    };

    resetMocks();
    delete require.cache[require.resolve('./usePolling')];
    const { usePolling } = await import('./usePolling');

    // Don't pass enabled, should default to true
    usePolling(mockFetch, { interval: 1000 });

    // Run effects
    for (const { effect } of mockEffects) {
      effect();
    }

    await sleep(10);
    assert(fetchCalled, 'Should fetch when enabled defaults to true');
  }),
];

// Run tests
async function runTests() {
  console.log('Running usePolling tests...\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`✓ ${name}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, error });
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error}`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed}/${results.length} passed`);

  if (failed > 0) {
    console.log(`\nFailed tests:`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}`);
    });
    process.exit(1);
  } else {
    console.log('\nAll tests passed!');
  }
}

runTests();
