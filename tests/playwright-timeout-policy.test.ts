import { describe, expect, it } from 'vitest';

import adminNavConfig from '../playwright.admin-nav.config';
import ordinaryConfig from '../playwright.config';
import nlStressConfig from '../playwright.nl-stress.config';
import {
  DEFAULT_NL_UI_OPERATION_TIMEOUT_MS,
  positiveTimeout,
  withDeadline,
} from './nl-ui/timeout-policy';

function expectFinitePositive(value: unknown): void {
  expect(typeof value).toBe('number');
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThan(0);
}

describe('Playwright timeout policy', () => {
  it('bounds the ordinary deterministic E2E harness at every timeout layer', () => {
    expect(ordinaryConfig.timeout).toBe(30_000);
    expect(ordinaryConfig.expect?.timeout).toBe(5_000);
    expect(ordinaryConfig.use?.actionTimeout).toBe(10_000);
    expect(ordinaryConfig.use?.navigationTimeout).toBe(30_000);
    expect(ordinaryConfig.globalTimeout).toBe(30 * 60_000);
  });

  it('keeps the admin timing diagnostic finite but independent', () => {
    expect(adminNavConfig.timeout).toBe(15 * 60_000);
    expect(adminNavConfig.use?.actionTimeout).toBe(60_000);
    expect(adminNavConfig.use?.navigationTimeout).toBe(60_000);
    expect(adminNavConfig.globalTimeout).toBe(60 * 60_000);
    expect(adminNavConfig.workers).toBe(1);
  });

  it('retains the separate long-running NL stress policy', () => {
    const configuredOperationTimeout = positiveTimeout(
      'NL_UI_TIMEOUT_MS',
      process.env.NL_UI_TIMEOUT_MS,
      DEFAULT_NL_UI_OPERATION_TIMEOUT_MS,
    );
    expect(nlStressConfig.timeout).toBe(30 * 60_000);
    expect(nlStressConfig.expect?.timeout).toBe(5_000);
    expect(nlStressConfig.use?.actionTimeout).toBe(configuredOperationTimeout);
    expect(nlStressConfig.use?.navigationTimeout).toBe(configuredOperationTimeout);
    expect(nlStressConfig.globalTimeout).toBe(2 * 60 * 60_000);
    expect(nlStressConfig.retries).toBe(0);
    expectFinitePositive(nlStressConfig.workers);
  });

  it('rejects zero, negative, non-integral and non-finite timeout overrides', () => {
    for (const raw of ['0', '-1', '1.5', 'Infinity', 'not-a-number']) {
      expect(() => positiveTimeout('NL_UI_TIMEOUT_MS', raw, 15_000)).toThrow(
        /NL_UI_TIMEOUT_MS must be a positive integer number of milliseconds/,
      );
    }
  });

  it('terminates arbitrary promises with a labelled diagnostic', async () => {
    await expect(withDeadline('raw document response body', new Promise<never>(() => {}), 5))
      .rejects.toThrow('raw document response body did not complete within 5 ms.');
  });

  it('contains no zero timeout in the imported live configs', () => {
    for (const config of [ordinaryConfig, adminNavConfig, nlStressConfig]) {
      for (const timeout of [
        config.timeout,
        config.expect?.timeout,
        config.use?.actionTimeout,
        config.use?.navigationTimeout,
        config.globalTimeout,
      ]) {
        expectFinitePositive(timeout);
      }
    }
  });
});
