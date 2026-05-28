import { pipeline, env, FeatureExtractionPipeline, Tensor } from "@xenova/transformers";
import { NoteChunk, EmbeddingRecord, EMBEDDING_MODEL_ID } from "./types.js";

/** Embedding service using Transformers.js */
export class EmbeddingService {
  private embedder: FeatureExtractionPipeline | null = null;
  private modelCacheDir: string;
  private batchSize: number;

  constructor(options: { modelCacheDir?: string; batchSize?: number } = {}) {
    this.modelCacheDir = options.modelCacheDir || "./models";
    this.batchSize = options.batchSize || 32;
  }

  /** Initialize the embedding model */
  async initialize(): Promise<void> {
    // Configure Transformers.js environment
    env.localModelPath = this.modelCacheDir;
    env.allowRemoteModels = true;

    // Load the feature extraction pipeline
    this.embedder = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
      progress_callback: (data: { status?: string; progress?: number }) => {
        if (data.status === "progress") {
          const percent = Math.round(data.progress || 0);
          process.stdout.write(`\rLoading embedding model: ${percent}%`);
        }
      },
    }) as FeatureExtractionPipeline;

    console.log("\nEmbedding model loaded successfully");
  }

  /** Check if the embedder is ready */
  isReady(): boolean {
    return this.embedder !== null;
  }

  /** Embed a single chunk */
  async embedChunk(chunk: NoteChunk): Promise<EmbeddingRecord> {
    if (!this.embedder) {
      throw new Error("Embedding service not initialized");
    }

    const output = await this.embedder(chunk.text, {
      pooling: "mean",
      normalize: true,
    });

    const data = output.data as Float32Array;

    return {
      chunkId: chunk.chunkId,
      notePath: chunk.notePath,
      vector: new Float32Array(data),
      modelId: EMBEDDING_MODEL_ID,
    };
  }

  /** Embed a batch of chunks */
  async embedBatch(chunks: NoteChunk[]): Promise<EmbeddingRecord[]> {
    if (!this.embedder) {
      throw new Error("Embedding service not initialized");
    }

    if (chunks.length === 0) {
      return [];
    }

    // Process in sub-batches if needed
    const results: EmbeddingRecord[] = [];

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map((c) => c.text);

      const outputs = await this.embedder(texts, {
        pooling: "mean",
        normalize: true,
      });

      // Map outputs back to chunks
      const outputArray = outputs as unknown as Tensor[];
      for (let j = 0; j < batch.length; j++) {
        const tensor = outputArray[j];
        const data = new Float32Array(tensor.data as Float32Array);
        results.push({
          chunkId: batch[j].chunkId,
          notePath: batch[j].notePath,
          vector: data,
          modelId: EMBEDDING_MODEL_ID,
        });
      }
    }

    return results;
  }

  /** Compute embeddings for all chunks from a note */
  async embedNoteChunks(chunks: NoteChunk[]): Promise<EmbeddingRecord[]> {
    return this.embedBatch(chunks);
  }

  /** Clean up resources */
  async shutdown(): Promise<void> {
    this.embedder = null;
  }
}

/** Simple in-memory LRU cache for embeddings */
export class EmbeddingCache {
  private cache = new Map<string, { hash: string; vectors: Float32Array[] }>();
  private maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  /** Get cached embeddings if content hash matches */
  get(notePath: string, contentHash: string): Float32Array[] | null {
    const entry = this.cache.get(notePath);
    if (entry && entry.hash === contentHash) {
      return entry.vectors;
    }
    return null;
  }

  /** Cache embeddings for a note */
  set(notePath: string, contentHash: string, vectors: Float32Array[]): void {
    // LRU eviction
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(notePath, { hash: contentHash, vectors });
  }

  /** Invalidate cache entry for a note */
  invalidate(notePath: string): void {
    this.cache.delete(notePath);
  }

  /** Clear entire cache */
  clear(): void {
    this.cache.clear();
  }

  /** Get current cache size */
  get size(): number {
    return this.cache.size;
  }
}