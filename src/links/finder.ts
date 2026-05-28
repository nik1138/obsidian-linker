import type { Backend } from "../backend/index.js";
import type { VaultNote } from "../vault/types.js";
import type { TypedConnection as LogicalConnection } from "./types.js";

export interface FindOptions {
  maxConnectionsPerNote?: number;
  minConfidence?: number;
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
    const maxConnections = options.maxConnectionsPerNote ?? 10;
    const minConfidence = options.minConfidence ?? 0.0;

    for (const note of notes) {
      try {
        const connections: LogicalConnection[] = await backend.analyze(note, {
          maxCandidates: 5,
          topK: 10,
          maxChunksPerCandidate: 3,
        });

        const filtered = connections
          .filter((c: LogicalConnection) => c.confidence >= minConfidence)
          .sort((a: LogicalConnection, b: LogicalConnection) => b.confidence - a.confidence)
          .slice(0, maxConnections);

        results.set(note.path, filtered);
      } catch (error) {
        console.error(`Error analyzing note ${note.path}:`, error);
        results.set(note.path, []);
      }
    }

    return results;
  }

  async findLinksForNote(
    note: VaultNote,
    _allNotes: VaultNote[],
    backend: Backend
  ): Promise<LogicalConnection[]> {
    const connections: LogicalConnection[] = await backend.analyze(note, {
      maxCandidates: 5,
      topK: 10,
      maxChunksPerCandidate: 3,
    });
    return connections.sort((a: LogicalConnection, b: LogicalConnection) => b.confidence - a.confidence).slice(0, 10);
  }
}
