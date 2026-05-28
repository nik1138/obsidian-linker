import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagService } from '../../src/backend/rag';
import { LanceDBClient } from '../../src/backend/lancedb';
import { EmbeddingService } from '../../src/backend/embeddings';
import { StepFunClient } from '../../src/backend/llm-client';

vi.mock('../../src/backend/lancedb');
vi.mock('../../src/backend/embeddings');
vi.mock('../../src/backend/llm-client');

describe('RagService', () => {
  it('can be instantiated with dependencies', () => {
    const lancedb = new LanceDBClient('/vault');
    const embeddings = new EmbeddingService();
    const llm = new StepFunClient({ apiKey: 'test' });

    const rag = new RagService(lancedb, embeddings, llm);
    expect(rag).toBeDefined();
  });
});
