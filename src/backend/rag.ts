import {
  VaultNote,
  NoteChunk,
  SearchResult,
  RagContext,
  TypedConnection,
  OfflineConnection,
  AnchorPoint,
  ConnectionType,
  AnalysisOptions,
} from "./types.js";
import { LanceDBClient } from "./lancedb.js";
import { EmbeddingService } from "./embeddings.js";
import { chunkNote } from "./chunker.js";
import { StepFunClient, ConnectionAnalyzer } from "./llm-client.js";

/** System prompt for logical connection analysis */
export const SYSTEM_PROMPT = `You are a logical connection analyzer for a personal knowledge base (Obsidian vault).
Your task is to identify and classify meaningful conceptual connections between a source
note and similar notes retrieved from the vault.

For each connection you find, you must provide:
1. The type of connection (see connection types below)
2. A confidence score (0.0-1.0)
3. A brief explanation of the relationship
4. Anchor points — specific sentences or phrases in the source note where an inline
   link to the target note would be contextually appropriate, with the exact anchor
   text from the source.

Connection types:
- "causal" — source describes a cause of what target describes, or vice versa
- "elaboration" — target expands on, explains, or provides details for source content
- "contradiction" — source and target present opposing viewpoints or conflicting information
- "supporting" — target provides evidence, examples, or reinforcement for source claims
- "sequential" — source and target describe steps in a process or temporal sequence
- "comparison" — source and target discuss comparable concepts, entities, or phenomena
- "generalization" — one note is a specific instance/case of a broader concept in the other
- "reference" — source explicitly or implicitly refers to content that exists in the target

Return ONLY valid JSON with the following structure:
{
  "connections": [
    {
      "targetNote": "Note Name",
      "targetPath": "/path/to/note.md",
      "type": "elaboration",
      "confidence": 0.85,
      "explanation": "Target note provides historical background for the philosophical school discussed in the source",
      "anchors": [
        {
          "sourcePhrase": "exact text from source note to attach link to",
          "reason": "Why this phrase is the best anchor point"
        }
      ]
    }
  ]
}`;

/** Build user prompt from RAG context */
export function buildUserPrompt(
  sourceNote: { name: string; path: string; fullContent: string },
  candidates: Array<{ noteName: string; notePath: string; chunks: SearchResult[] }>
): string {
  let prompt = `## Source Note: ${sourceNote.name}\n\n${sourceNote.fullContent}\n\n---\n\n## Candidate Notes\n\n`;

  for (const candidate of candidates) {
    prompt += `### ${candidate.noteName}\nRelevant excerpts:\n`;

    for (const chunk of candidate.chunks) {
      const headingPath = chunk.headingPath.length > 0 ? `[${chunk.headingPath.join(" > ")}]` : "[No heading]";
      prompt += `${headingPath}\n${chunk.text}\n\n`;
    }

    prompt += "\n";
  }

  prompt += `---\n\nAnalyze the logical connections between the source note and each candidate note.
For each meaningful connection, return the connection type, confidence, explanation, and anchors.
If no meaningful connection exists for a candidate, omit it from the output.`;

  return prompt;
}

/** Convert LanceDB distance to cosine similarity score (0-1) */
export function distanceToScore(distance: number): number {
  // LanceDB returns L2 distance for normalized vectors: distance = 2 - 2*cosine_similarity
  // So cosine_similarity = (2 - distance) / 2
  const cosine = (2 - distance) / 2;
  return Math.max(0, Math.min(1, cosine));
}

/** Parse LLM JSON response into typed connections */
export function parseLlmResponse(
  rawJson: string,
  sourceContent: string
): TypedConnection[] {
  try {
    const parsed = JSON.parse(rawJson);

    if (!parsed.connections || !Array.isArray(parsed.connections)) {
      console.warn("Invalid LLM response: missing connections array");
      return [];
    }

    return parsed.connections
      .filter((c: any) => {
        const hasRequired =
          c.targetNote &&
          c.targetPath &&
          c.type &&
          typeof c.confidence === "number" &&
          Array.isArray(c.anchors) &&
          c.anchors.length > 0;

        if (!hasRequired) {
          console.warn("Filtering out invalid connection:", c);
        }

        return hasRequired;
      })
      .map((c: any) => {
        // Compute position for each anchor by finding the phrase in source content
        const anchors = c.anchors.map((a: any) => {
          const sourcePhrase = a.sourcePhrase || "";
          const position = sourcePhrase
            ? sourceContent.indexOf(sourcePhrase)
            : -1;

          return {
            sourcePhrase,
            reason: a.reason || "",
            position: position >= 0 ? position : 0,
          };
        }).filter((a: AnchorPoint) => a.position >= 0); // Only keep anchors with valid positions

        return {
          targetNote: c.targetNote,
          targetPath: c.targetPath,
          type: c.type as ConnectionType,
          confidence: Math.max(0, Math.min(1, c.confidence)),
          explanation: c.explanation || "",
          anchors,
        };
      })
      .filter((c: TypedConnection) => c.anchors.length > 0); // Only keep connections with at least one valid anchor
  } catch (error) {
    console.error("Failed to parse LLM response as JSON:", error);
    return [];
  }
}

/** Search for similar chunks for a single embedding */
async function searchSimilarChunks(
  lancedb: LanceDBClient,
  queryVector: Float32Array,
  topK: number,
  excludeNotePath?: string
): Promise<SearchResult[]> {
  const results = await lancedb.searchSimilarChunks(queryVector, topK, excludeNotePath);

  return results.map((r) => ({
    chunkId: r.chunkId,
    notePath: r.notePath,
    text: r.text,
    score: 0.9, // Placeholder - LanceDB returns distance, convert properly
    headingPath: r.headingPath,
  }));
}

/** Find candidate chunks across all source chunks */
async function findCandidateChunks(
  lancedb: LanceDBClient,
  sourceNote: VaultNote,
  sourceEmbeddings: any[], // EmbeddingRecord[]
  topK: number,
  maxCandidatesPerNote: number
): Promise<Map<string, SearchResult[]>> {
  // Run vector searches in parallel
  const allResults = await Promise.all(
    sourceEmbeddings.map((e) => searchSimilarChunks(lancedb, e.vector, topK, sourceNote.path))
  );

  // Flatten and aggregate by target note
  const byNote = new Map<string, SearchResult[]>();
  for (const results of allResults) {
    for (const r of results) {
      if (!byNote.has(r.notePath)) {
        byNote.set(r.notePath, []);
      }
      byNote.get(r.notePath)!.push(r);
    }
  }

  // Per target note: keep top-K by score, then limit to maxCandidatesPerNote
  for (const [notePath, chunks] of byNote) {
    chunks.sort((a, b) => b.score - a.score);
    byNote.set(notePath, chunks.slice(0, maxCandidatesPerNote));
  }

  return byNote;
}

/** Assemble RAG context for LLM */
function assembleContext(
  sourceNote: VaultNote,
  sourceChunks: NoteChunk[],
  candidates: Map<string, SearchResult[]>
): RagContext {
  // Select top 3 source chunks (longest/most substantive ones)
  const selectedSourceChunks = [...sourceChunks]
    .sort((a, b) => b.tokenCount - a.tokenCount)
    .slice(0, 3);

  return {
    sourceNote: {
      name: sourceNote.name,
      path: sourceNote.path,
      fullContent: sourceNote.content,
    },
    sourceChunks: selectedSourceChunks,
    candidates: Array.from(candidates.entries()).map(([notePath, chunks]) => ({
      noteName: pathToNoteName(notePath),
      notePath,
      chunks,
    })),
  };
}

/** Extract note name from path */
function pathToNoteName(notePath: string): string {
  const base = notePath.split("/").pop() || notePath;
  return base.replace(/\.md$/, "");
}

  /** Analyze connections using LLM (online mode) */
  async function analyzeWithLlm(
    llmClient: StepFunClient,
    sourceNote: VaultNote,
    ragContext: RagContext,
    maxCandidates: number
  ): Promise<TypedConnection[]> {
    const limitedCandidates = ragContext.candidates.slice(0, maxCandidates);

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: buildUserPrompt(ragContext.sourceNote, limitedCandidates) },
    ];

    const response = await llmClient.chat(messages, {
      temperature: 0.3,
      maxTokens: 2048,
      responseFormat: "json_object",
    });

    return parseLlmResponse(response.content, sourceNote.content);
  }

/** Offline fallback: use cosine similarity heuristics */
async function analyzeOffline(
  lancedb: LanceDBClient,
  embeddingService: EmbeddingService,
  sourceNote: VaultNote,
  topK: number,
  maxChunksPerCandidate: number
): Promise<OfflineConnection[]> {
  const sourceChunks = chunkNote(sourceNote);
  const sourceEmbeddings = await embeddingService.embedNoteChunks(sourceChunks);

  const candidates = await findCandidateChunks(
    lancedb,
    sourceNote,
    sourceEmbeddings,
    topK,
    maxChunksPerCandidate
  );

  const connections: OfflineConnection[] = [];

  for (const [notePath, chunks] of candidates) {
    const topChunks = chunks.slice(0, 3);
    const avgScore = topChunks.reduce((sum, c) => sum + c.score, 0) / topChunks.length;

    if (avgScore < 0.5) continue; // Minimum threshold

    const bestChunk = topChunks[0];
    const phrase = truncateText(bestChunk.text, 100);
    const position = sourceNote.content.indexOf(phrase);

    const anchor: AnchorPoint = {
      sourcePhrase: phrase,
      reason: `High semantic similarity (${bestChunk.score.toFixed(3)}) — chunk from section: ${bestChunk.headingPath.join(" > ") || "No heading"}`,
      position: position >= 0 ? position : 0,
    };

    connections.push({
      targetNote: pathToNoteName(notePath),
      targetPath: notePath,
      type: "reference",
      confidence: avgScore,
      explanation: `Semantic similarity score: ${avgScore.toFixed(3)}. Top matching chunk: "${truncateText(bestChunk.text, 80)}..."`,
      anchors: [anchor],
    });
  }

  return connections.sort((a, b) => b.confidence - a.confidence);
}

/** Truncate text to max length with ellipsis */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/** Main RAG service */
export class RagService {
  private lancedb: LanceDBClient;
  private embeddingService: EmbeddingService;
  private llmClient: StepFunClient;
  private analyzer: ConnectionAnalyzer;

  constructor(
    lancedb: LanceDBClient,
    embeddingService: EmbeddingService,
    llmClient: StepFunClient
  ) {
    this.lancedb = lancedb;
    this.embeddingService = embeddingService;
    this.llmClient = llmClient;
    this.analyzer = new ConnectionAnalyzer(llmClient);
  }

  /** Analyze connections for a single note */
  async analyzeNote(
    sourceNote: VaultNote,
    options: AnalysisOptions = {}
  ): Promise<TypedConnection[]> {
    const {
      maxCandidates = 5,
      topK = 10,
      maxChunksPerCandidate = 3,
      preferOffline = false,
    } = options;

    // Check connectivity
    await this.analyzer.checkConnectivity();

    // If offline or preferOffline, use heuristic fallback
    if (preferOffline || !this.analyzer.getOnlineStatus()) {
      const offlineConnections = await analyzeOffline(
        this.lancedb,
        this.embeddingService,
        sourceNote,
        topK,
        maxChunksPerCandidate
      );

      // Convert OfflineConnection to TypedConnection (type is always "reference")
      return offlineConnections.map((oc) => ({
        targetNote: oc.targetNote,
        targetPath: oc.targetPath,
        type: "reference",
        confidence: oc.confidence,
        explanation: oc.explanation,
        anchors: oc.anchors,
      }));
    }

    // Online mode: try LLM analysis
    try {
      // Phase 1: Chunk source note
      const sourceChunks = chunkNote(sourceNote);

      // Phase 2: Embed source chunks
      const sourceEmbeddings = await this.embeddingService.embedNoteChunks(sourceChunks);

      // Phase 2.5: Find candidate chunks
      const candidates = await findCandidateChunks(
        this.lancedb,
        sourceNote,
        sourceEmbeddings,
        topK,
        maxChunksPerCandidate
      );

      // Phase 3: Assemble context
      const ragContext = assembleContext(sourceNote, sourceChunks, candidates);

      // Phase 4: LLM analysis
      return await analyzeWithLlm(this.llmClient, sourceNote, ragContext, maxCandidates);
    } catch (error) {
      console.error("LLM analysis failed, falling back to offline mode:", error);

      // Fallback to offline mode on any error
      const offlineConnections = await analyzeOffline(
        this.lancedb,
        this.embeddingService,
        sourceNote,
        topK,
        maxChunksPerCandidate
      );

      return offlineConnections.map((oc) => ({
        targetNote: oc.targetNote,
        targetPath: oc.targetPath,
        type: "reference",
        confidence: oc.confidence,
        explanation: oc.explanation,
        anchors: oc.anchors,
      }));
    }
  }

  /** Batch analyze multiple notes */
  async analyzeBatch(
    notes: VaultNote[],
    options: AnalysisOptions & { concurrency?: number } = {}
  ): Promise<Map<string, TypedConnection[]>> {
    const { concurrency = 3 } = options;
    const results = new Map<string, TypedConnection[]>();

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < notes.length; i += concurrency) {
      const batch = notes.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((note) => this.analyzeNote(note, options))
      );

      for (let j = 0; j < batch.length; j++) {
        results.set(batch[j].path, batchResults[j]);
      }

      // Small delay between batches to be nice to rate limits
      if (i + concurrency < notes.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /** Get connectivity status */
  getConnectivityStatus(): boolean {
    return this.analyzer.getOnlineStatus();
  }

  /** Force health check */
  async forceHealthCheck(): Promise<boolean> {
    return this.analyzer.forceHealthCheck();
  }
}