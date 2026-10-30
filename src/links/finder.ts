import type { Backend } from "../backend/index.js";
import type { VaultNote } from "../vault/types.js";
import type { TypedConnection as LogicalConnection } from "./types.js";

export interface FindOptions {
  maxConnectionsPerNote?: number;
  minConfidence?: number;
  maxCandidates?: number;
  topK?: number;
  maxChunksPerCandidate?: number;
}

/**
 * LinkFinder - orchestrates RAG search → LLM → LogicalConnection[]
 */
export class LinkFinder {
  async findLinks(
    notes: VaultNote[],
    backend: Backend,
    options: FindOptions = {}
  ): Promise<Map<string, LogicalConnection[]>> {
    const results = new Map<string, LogicalConnection[]>();

    for (const note of notes) {
      try {
        results.set(note.path, await this.findLinksForNote(note, backend, options));
      } catch (error) {
        console.error(`Error analyzing note ${note.path}:`, error);
        results.set(note.path, []);
      }
    }

    return results;
  }

  async findLinksForNote(
    note: VaultNote,
    backend: Backend,
    options: FindOptions = {}
  ): Promise<LogicalConnection[]> {
    const {
      maxConnectionsPerNote = 10,
      minConfidence = 0,
      maxCandidates = 5,
      topK = 10,
      maxChunksPerCandidate = 3,
    } = options;

    const connections: LogicalConnection[] = await backend.analyze(note, {
      maxCandidates,
      topK,
      maxChunksPerCandidate,
    });

    return connections
      .filter((connection) => connection.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxConnectionsPerNote);
  }
}
