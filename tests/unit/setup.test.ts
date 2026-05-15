// Basic test to verify Jest and fast-check are working

import * as fc from 'fast-check';

describe('Test Framework Setup', () => {
  it('should run basic Jest test', () => {
    expect(true).toBe(true);
  });

  it('should run basic property-based test with fast-check', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return n + 0 === n;
      })
    );
  });

  it('should verify TypeScript compilation', () => {
    const testFunction = (x: number): number => x * 2;
    expect(testFunction(5)).toBe(10);
  });

  it('should have access to test setup', () => {
    // Verify console is mocked from setup.ts
    expect(console.log).toBeDefined();
    expect(typeof console.log).toBe('function');
  });
});
