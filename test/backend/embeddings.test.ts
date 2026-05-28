import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '../../src/backend/embeddings';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
  env: { localModelPath: '', allowRemoteModels: false },
}));

describe('EmbeddingService', () => {
  it('can be instantiated', () => {
    const service = new EmbeddingService();
    expect(service).toBeDefined();
    expect(service.isReady()).toBe(false);
  });

  it('initializes successfully', async () => {
    const service = new EmbeddingService();
    const { pipeline } = await import('@xenova/transformers');
    pipeline.mockResolvedValue(() => ({ data: new Float32Array(384) }));

    await service.initialize();
    expect(service.isReady()).toBe(true);
  });
});
