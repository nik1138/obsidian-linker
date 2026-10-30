// ============================================================
// Core Data Structures
// ============================================================

/** Raw note as read from the vault filesystem */
export interface VaultNote {
  /** Absolute path within the vault (e.g., "/vault/philosophy/Stoicism.md") */
  path: string;
  /** Display name derived from filename without extension */
  name: string;
  /** Full raw markdown content */
  content: string;
  /** File modification timestamp (ms since epoch) */
  modifiedAt: number;
  /** File size in bytes */
  sizeBytes: number;
}

/** A single chunk of text extracted from a note */
export interface NoteChunk {
  /** Unique chunk ID — `${notePath}::chunk::${chunkIndex}` */
  chunkId: string;
  /** Source note path (foreign key into note_metadata) */
  notePath: string;
  /** Zero-based index of this chunk within the note */
  chunkIndex: number;
  /** The text content of this chunk */
  text: string;
  /** Approximate token count (for informational / debug purposes) */
  tokenCount: number;
  /** Markdown heading hierarchy at the chunk's position, e.g. ["# Introduction", "## Background"] */
  headingPath: string[];
  /** Byte offset of this chunk's start within the raw note content */
  byteOffsetStart: number;
  /** Byte offset of this chunk's end within the raw note content */
  byteOffsetEnd: number;
}

/** An embedding vector stored in LanceDB */
export interface EmbeddingRecord {
  /** Chunk ID — matches NoteChunk.chunkId */
  chunkId: string;
  /** Source note path (for filtering queries by note scope) */
  notePath: string;
  /** 384-dimensional float32 vector from Xenova/all-MiniLM-L6-v2 */
  vector: Float32Array;
  /** Embedding model identifier, e.g. "google/embeddinggemma-300m" */
  modelId: string;
}

/** Cache entry for a single note's embeddings */
export interface EmbeddingCacheEntry {
  /** Note file path (the key) */
  notePath: string;
  /** Content hash (SHA-256) at the time embeddings were computed */
  contentHash: string;
  /** Model used for embeddings */
  modelId: string;
  /** Array of embeddings, one per chunk, in chunk order */
  vectors: Float32Array[];
  /** Timestamp of when the cache was created */
  cachedAt: number;
}

// ============================================================
// LanceDB Schemas
// ============================================================

/** Metadata for a note stored in LanceDB */
export interface NoteMetadata {
  notePath: string;
  name: string;
  contentHash: string;
  modifiedAt: number;
  sizeBytes: number;
  chunkCount: number;
  indexedAt: number;
  modelId: string;
}

/** Chunk data stored in LanceDB with vector */
export interface NoteChunkRecord {
  chunkId: string;
  notePath: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  headingPath: string[];
  byteOffsetStart: number;
  byteOffsetEnd: number;
  vector: Float32Array;
}

// ============================================================
// Search & RAG
// ============================================================

/** Result from vector similarity search */
export interface SearchResult {
  /** The matched chunk from LanceDB */
  chunkId: string;
  /** Source note of the matched chunk */
  notePath: string;
  /** The matched chunk text */
  text: string;
  /** Cosine similarity score (0–1) */
  score: number;
  /** Heading hierarchy context */
  headingPath: string[];
}

/** Context assembled for LLM analysis */
export interface RagContext {
  /** The source note being analyzed */
  sourceNote: {
    name: string;
    path: string;
    fullContent: string;
  };
  /** Selected source chunks sent to LLM (to keep context manageable) */
  sourceChunks: NoteChunk[];
  /** Candidate chunks from other notes */
  candidates: Array<{
    noteName: string;
    notePath: string;
    chunks: SearchResult[];
  }>;
}

/** Difference between vault state and indexed state */
export interface IndexDiff {
  /** New notes not in LanceDB */
  newNotes: VaultNote[];
  /** Notes whose content hash changed */
  modifiedNotes: VaultNote[];
  /** Notes in LanceDB but deleted from vault */
  deletedNotes: string[];
  /** Notes unchanged — skip re-indexing */
  unchangedCount: number;
}

// ============================================================
// LLM Integration
// ============================================================

/** LLM client interface */
export interface LlmClient {
  chat(messages: LlmMessage[], options?: LlmOptions): Promise<LlmResponse>;
  healthCheck(): Promise<boolean>;
}

/** LLM message for chat completion */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Options for LLM chat call */
export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  timeout?: number;
}

/** Response from LLM chat completion */
export interface LlmResponse {
  content: string;
  finishReason: "stop" | "length" | "error";
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

/** Typed connection between notes produced by LLM analysis */
export interface TypedConnection {
  /** Target note name */
  targetNote: string;
  /** Target note path */
  targetPath: string;
  /** Connection type */
  type: ConnectionType;
  /** Confidence score 0–1 */
  confidence: number;
  /** Human-readable explanation */
  explanation: string;
  /** Anchor points for inline link insertion */
  anchors: AnchorPoint[];
}

export type LogicalConnection = TypedConnection;

/** Connection type classification */
export type ConnectionType =
  | "causal"
  | "elaboration"
  | "contradiction"
  | "supporting"
  | "sequential"
  | "comparison"
  | "generalization"
  | "reference";

/** Anchor point for link insertion */
export interface AnchorPoint {
  /** Exact phrase from source note to attach the link to */
  sourcePhrase: string;
  /** Why this is the best anchor point */
  reason: string;
  /** Character offset in source note text where the phrase starts */
  position: number;
}

/** Offline connection (heuristic fallback) */
export interface OfflineConnection {
  targetNote: string;
  targetPath: string;
  type: "reference";
  confidence: number;
   explanation: string;
   anchors: AnchorPoint[];
 }

// ============================================================
// Link Insertion
// ============================================================

/** Options for link insertion */
export interface InsertOptions {
  dryRun?: boolean;
  limitPerNote?: number;
}

/** Result of link insertion for a single note */
export interface InsertResultItem {
  notePath: string;
  success: boolean;
  insertedCount: number;
  skippedCount: number;
  errors: string[];
}

/** Overall result of link insertion operation */
export interface InsertResult {
  results: InsertResultItem[];
  totalInserted: number;
  totalSkipped: number;
  dryRun: boolean;
}

// ============================================================
// Backend API
// ============================================================

/** Options for Backend initialization */
export interface BackendOptions {
  /** Path to the vault (used to locate/store LanceDB at <vault>/.obsidian-linker/lancedb/) */
  vaultPath: string;
  /** StepFun API key (optional — falls back to STEPFUN_API_KEY env var) */
  apiKey?: string;
  /** Model cache directory (default: ./models) */
  modelCacheDir?: string;
}

/** Progress information during indexing */
export interface IndexProgress {
  phase: "chunking" | "embedding" | "inserting" | "indexing";
  processed: number;
  total: number;
}

/** Options for connection analysis */
export interface AnalysisOptions {
  maxCandidates?: number;
  topK?: number;
  maxChunksPerCandidate?: number;
  preferOffline?: boolean;
}

/** Health check result */
export interface HealthStatus {
  online: boolean;
  modelAvailable: boolean;
}

/** Main Backend interface */
export interface Backend {
  /** Initialize LanceDB, load models, prepare cache */
  initialize(options: BackendOptions): Promise<void>;

  /** Full re-index of all notes from scratch */
  fullIndex(
    notes: VaultNote[],
    onProgress?: (progress: IndexProgress) => void
  ): Promise<void>;

  /** Incremental update — only process changed notes */
  incrementalUpdate(
    notes: VaultNote[],
    onProgress?: (progress: IndexProgress) => void
  ): Promise<IndexDiff>;

  /** Analyze connections for a single note (RAG + LLM or offline fallback) */
  analyze(
    note: VaultNote,
    options?: AnalysisOptions
  ): Promise<TypedConnection[]>;

  /** Batch analyze multiple notes */
  analyzeBatch(
    notes: VaultNote[],
    options?: AnalysisOptions & { concurrency?: number }
  ): Promise<Map<string, TypedConnection[]>>;

  /** Check LLM API health */
  healthCheck(): Promise<HealthStatus>;

  /** Clean up resources */
  shutdown(): Promise<void>;
}

// ============================================================
// Constants
// ============================================================

export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;
export const DEFAULT_CHUNK_TOKENS = 512;
export const DEFAULT_OVERLAP_TOKENS = 50;
export const DEFAULT_TARGET_CHUNK_TOKENS = 400;
export const LLM_MODEL = "step-3.5-flash-2603";
export const LLM_DEFAULT_TIMEOUT = 30000;
export const LLM_DEFAULT_TEMPERATURE = 0.3;
export const LLM_MAX_TOKENS = 2048;
export const LANCEDB_DB_NAME = "lancedb";
export const METADATA_TABLE = "note_metadata";
export const CHUNKS_TABLE = "note_chunks";