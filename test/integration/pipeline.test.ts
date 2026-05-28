import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackendImpl } from '../../src/backend/index';
import { LanceDBClient } from '../../src/backend/lancedb';
import { EmbeddingService } from '../../src/backend/embeddings';
import { StepFunClient } from '../../src/backend/llm-client';

vi.mock('../../src/backend/lancedb');
vi.mock('../../src/backend/embeddings');
vi.mock('../../src/backend/llm-client');

describe('Backend Integration', () => {
  it('can be instantiated', () => {
    const backend = new BackendImpl();
    expect(backend).toBeDefined();
  });
});
