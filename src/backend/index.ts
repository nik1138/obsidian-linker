import * as crypto from "crypto";
import {
  Backend,
  BackendOptions,
  VaultNote,
  IndexDiff,
  IndexProgress,
  TypedConnection,
  AnalysisOptions,
  HealthStatus,
  EMBEDDING_MODEL_ID,
  NoteChunk,
  EmbeddingRecord,
  NoteMetadata,
  NoteChunkRecord,
} from "./types.js";

import { LanceDBClient } from "./lancedb.js";
import { EmbeddingService } from "./embeddings.js";
import { chunkNote } from "./chunker.js";
import { StepFunClient } from "./llm-client.js";
import { RagService } from "./rag.js";

/** Main Backend implementation */
export class BackendImpl implements Backend {
  private lancedb: LanceDBClient;
  private embeddingService: EmbeddingService;
  private llmClient: StepFunClient;
  private ragService: RagService;
  private vaultPath: string;
  private apiKey: string;
  private modelCacheDir: string;
  private initialized: boolean = false;

  constructor() {
    // These will be set in initialize()
    this.lancedb = null as any;
    this.embeddingService = null as any;
    this.llmClient = null as any;
    this.ragService = null as any;
    this.vaultPath = "";
    this.apiKey = "";
    this.modelCacheDir = "./models";
  }

  /** Initialize all backend services */
  async initialize(options: BackendOptions): Promise<void> {
    if (this.initialized) {
      console.warn("Backend already initialized");
      return;
    }

    this.vaultPath = options.vaultPath;
    this.apiKey = options.apiKey || process.env['STEPFUN_API_KEY'] || "";
    this.modelCacheDir = options.modelCacheDir || "./models";

    console.log("Initializing backend...");

    // Initialize LanceDB
    console.log("→ Connecting to LanceDB...");
    this.lancedb = new LanceDBClient(this.vaultPath);
    await this.lancedb.initialize();

    // Initialize embedding service
    console.log("→ Loading embedding model...");
    this.embeddingService = new EmbeddingService({
      modelCacheDir: this.modelCacheDir,
      batchSize: 32,
    });
    await this.embeddingService.initialize();

    // Initialize LLM client
    console.log("→ Initializing LLM client...");
    this.llmClient = new StepFunClient({ apiKey: this.apiKey });

    // Initialize RAG service
    this.ragService = new RagService(this.lancedb, this.embeddingService, this.llmClient);

    this.initialized = true;
    console.log("Backend initialized successfully");
  }

  /** Full re-index of all notes */
  async fullIndex(
    notes: VaultNote[],
    onProgress?: (progress: IndexProgress) => void
  ): Promise<void> {
    this.ensureInitialized();

    console.log(`Starting full index of ${notes.length} notes`);

    // Phase 1: Chunk all notes
    onProgress?.({ phase: "chunking", processed: 0, total: notes.length });
    const allChunks: NoteChunk[] = [];
    const chunkMap = new Map<string, NoteChunk[]>(); // notePath -> chunks

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const chunks = chunkNote(note);
      chunkMap.set(note.path, chunks);
      allChunks.push(...chunks);
      onProgress?.({ phase: "chunking", processed: i + 1, total: notes.length });
    }

    console.log(`Created ${allChunks.length} chunks from ${notes.length} notes`);

    // Phase 2: Embed all chunks
    onProgress?.({ phase: "embedding", processed: 0, total: allChunks.length });
    const allEmbeddings: EmbeddingRecord[] = [];

    for (let i = 0; i < allChunks.length; i += 32) {
      const batch = allChunks.slice(i, i + 32);
      const embeddings = await this.embeddingService.embedBatch(batch);
      allEmbeddings.push(...embeddings);
      onProgress?.({
        phase: "embedding",
        processed: Math.min(i + 32, allChunks.length),
        total: allChunks.length,
      });
    }

    console.log(`Generated ${allEmbeddings.length} embeddings`);

    // Phase 3: Insert into LanceDB
    onProgress?.({ phase: "inserting", processed: 0, total: notes.length });

    // Prepare chunk records
    const chunkRecords: NoteChunkRecord[] = allEmbeddings.map((emb) => {
      const chunk = allChunks.find((c) => c.chunkId === emb.chunkId)!;
      return {
        chunkId: emb.chunkId,
        notePath: emb.notePath,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        headingPath: chunk.headingPath,
        byteOffsetStart: chunk.byteOffsetStart,
        byteOffsetEnd: chunk.byteOffsetEnd,
        vector: emb.vector,
      };
    });

    // Clear existing data
    await this.clearAllData();

    // Insert chunks
    await this.lancedb.insertChunks(chunkRecords);

    // Insert metadata
    const metadataRows: NoteMetadata[] = notes.map((note) => ({
      notePath: note.path,
      name: note.name,
      contentHash: this.sha256(note.content),
      modifiedAt: note.modifiedAt,
      sizeBytes: note.sizeBytes,
      chunkCount: chunkMap.get(note.path)?.length || 0,
      indexedAt: Date.now(),
      modelId: EMBEDDING_MODEL_ID,
    }));

    for (let i = 0; i < metadataRows.length; i++) {
      await this.lancedb.upsertMetadata(metadataRows[i]);
      onProgress?.({ phase: "inserting", processed: i + 1, total: notes.length });
    }

    console.log(`Inserted ${metadataRows.length} metadata records`);

    // Phase 4: Create vector index
    onProgress?.({ phase: "indexing", processed: 0, total: 1 });
    await this.lancedb.rebuildVectorIndex();
    onProgress?.({ phase: "indexing", processed: 1, total: 1 });

    console.log("Full index completed successfully");
  }

  /** Incremental update — only process changed notes */
  async incrementalUpdate(
    notes: VaultNote[],
    onProgress?: (progress: IndexProgress) => void
  ): Promise<IndexDiff> {
    this.ensureInitialized();

    console.log(`Computing diff for ${notes.length} notes...`);

    // Get all indexed paths
    const indexedPaths = new Set(await this.lancedb.getAllIndexedPaths());

    // Compute diff
    const diff: IndexDiff = {
      newNotes: [],
      modifiedNotes: [],
      deletedNotes: [],
      unchangedCount: 0,
    };

    for (const note of notes) {
      if (!indexedPaths.has(note.path)) {
        diff.newNotes.push(note);
      } else {
        const metadata = await this.lancedb.getMetadata(note.path);
        const currentHash = this.sha256(note.content);

        if (!metadata || metadata.contentHash !== currentHash) {
          diff.modifiedNotes.push(note);
        } else {
          diff.unchangedCount++;
        }
      }
    }

    // Find deleted notes
    const vaultPaths = new Set(notes.map((n) => n.path));
    diff.deletedNotes = [...indexedPaths].filter((p) => !vaultPaths.has(p));

    console.log(`Diff: ${diff.newNotes.length} new, ${diff.modifiedNotes.length} modified, ${diff.deletedNotes.length} deleted`);

    if (diff.newNotes.length === 0 && diff.modifiedNotes.length === 0 && diff.deletedNotes.length === 0) {
      return diff;
    }

    // Process deletions
    onProgress?.({ phase: "chunking", processed: 0, total: diff.deletedNotes.length });
    for (let i = 0; i < diff.deletedNotes.length; i++) {
      const notePath = diff.deletedNotes[i];
      await this.lancedb.deleteNoteChunks(notePath);
      await this.lancedb.deleteMetadata(notePath);
      onProgress?.({ phase: "chunking", processed: i + 1, total: diff.deletedNotes.length });
    }

    // Process new + modified notes
    const toIndex = [...diff.newNotes, ...diff.modifiedNotes];
    if (toIndex.length === 0) {
      return diff;
    }

    // Delete old chunks for modified notes
    onProgress?.({ phase: "chunking", processed: 0, total: toIndex.length });
    for (let i = 0; i < diff.modifiedNotes.length; i++) {
      const note = diff.modifiedNotes[i];
      await this.lancedb.deleteNoteChunks(note.path);
      onProgress?.({ phase: "chunking", processed: i + 1, total: toIndex.length });
    }

    // Chunk and embed
    const allChunks: NoteChunk[] = [];
    const allEmbeddings: EmbeddingRecord[] = [];
    const metadataRows: NoteMetadata[] = [];

    onProgress?.({ phase: "embedding", processed: 0, total: toIndex.length });

    for (let i = 0; i < toIndex.length; i++) {
      const note = toIndex[i];
      const chunks = chunkNote(note);
      const embeddings = await this.embeddingService.embedBatch(chunks);

      allChunks.push(...chunks);
      allEmbeddings.push(...embeddings);

      metadataRows.push({
        notePath: note.path,
        name: note.name,
        contentHash: this.sha256(note.content),
        modifiedAt: note.modifiedAt,
        sizeBytes: note.sizeBytes,
        chunkCount: chunks.length,
        indexedAt: Date.now(),
        modelId: EMBEDDING_MODEL_ID,
      });

      onProgress?.({ phase: "embedding", processed: i + 1, total: toIndex.length });
    }

    // Insert chunks
    const chunkRecords: NoteChunkRecord[] = allEmbeddings.map((emb) => {
      const chunk = allChunks.find((c) => c.chunkId === emb.chunkId)!;
      return {
        chunkId: emb.chunkId,
        notePath: emb.notePath,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        headingPath: chunk.headingPath,
        byteOffsetStart: chunk.byteOffsetStart,
        byteOffsetEnd: chunk.byteOffsetEnd,
        vector: emb.vector,
      };
    });

    await this.lancedb.insertChunks(chunkRecords);

    // Upsert metadata
    onProgress?.({ phase: "inserting", processed: 0, total: metadataRows.length });
    for (let i = 0; i < metadataRows.length; i++) {
      await this.lancedb.upsertMetadata(metadataRows[i]);
      onProgress?.({ phase: "inserting", processed: i + 1, total: metadataRows.length });
    }

    // Rebuild index if significant changes
    const totalChunks = await this.lancedb.getTotalChunkCount();
    if (allChunks.length > totalChunks * 0.1) {
      console.log("Significant changes detected, rebuilding vector index...");
      await this.lancedb.rebuildVectorIndex();
    }

    console.log("Incremental update completed");
    return diff;
  }

  /** Analyze connections for a single note */
  async analyze(
    note: VaultNote,
    options: AnalysisOptions = {}
  ): Promise<TypedConnection[]> {
    this.ensureInitialized();
    return this.ragService.analyzeNote(note, options);
  }

  /** Batch analyze multiple notes */
  async analyzeBatch(
    notes: VaultNote[],
    options: AnalysisOptions & { concurrency?: number } = {}
  ): Promise<Map<string, TypedConnection[]>> {
    this.ensureInitialized();
    return this.ragService.analyzeBatch(notes, options);
  }

  /** Check LLM API health */
  async healthCheck(): Promise<HealthStatus> {
    this.ensureInitialized();

    const online = await this.llmClient.healthCheck();

    // Also check if model is available (by checking API key)
    const modelAvailable = this.llmClient.hasApiKey();

    return { online, modelAvailable };
  }

  /** Clean up resources */
  async shutdown(): Promise<void> {
    if (this.lancedb) {
      await this.lancedb.close();
    }

    if (this.embeddingService) {
      await this.embeddingService.shutdown();
    }

    this.initialized = false;
    console.log("Backend shut down");
  }

  /** Ensure backend is initialized */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("Backend not initialized. Call initialize() first.");
    }
  }

  /** Compute SHA-256 hash of content */
  private sha256(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /** Clear all data from LanceDB (for full re-index) */
  private async clearAllData(): Promise<void> {
    // Delete all rows from both tables
    const metadataTable = this.lancedb.getMetadataTable();
    const chunksTable = this.lancedb.getChunksTable();

    // Delete all metadata (truncate)
    await metadataTable.delete('notePath != ""');

    // Delete all chunks
    await chunksTable.delete('chunkId != ""');
  }
}

/** Factory function to create backend instance */
export function createBackend(): Backend {
  return new BackendImpl();
}

// Re-export all types for convenient imports
export * from "./types.js";
