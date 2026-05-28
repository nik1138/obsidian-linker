import { describe, it, expect, vi } from 'vitest';
import { StepFunClient } from '../../src/backend/llm-client';

global.fetch = vi.fn();

describe('StepFunClient', () => {
  it('can be instantiated with API key', () => {
    const client = new StepFunClient({ apiKey: 'test-key' });
    expect(client.hasApiKey()).toBe(true);
  });

  it('can be instantiated without API key', () => {
    const client = new StepFunClient();
    expect(client.hasApiKey()).toBe(false);
  });
});
