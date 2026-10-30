import * as fs from "fs-extra";
import * as path from "path";
import { connect, Table } from "@lancedb/lancedb";
import {
  NoteMetadata,
  NoteChunkRecord,
  EMBEDDING_DIM,
  METADATA_TABLE,
  CHUNKS_TABLE,
  LANCEDB_DB_NAME,
} from "./types.js";

/** LanceDB connection and table management */
export class LanceDBClient {
  private connection: any = null;
  private metadataTable: Table | null = null;
  private chunksTable: Table | null = null;
  private dbPath: string;

  constructor(vaultPath: string) {
    this.dbPath = path.join(vaultPath, ".obsidian-linker", LANCEDB_DB_NAME);
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.dbPath);
    this.connection = await connect(this.dbPath);

    this.metadataTable = await this.connection.createTable(METADATA_TABLE, {
      schema: {
        notePath: "string",
        name: "string",
        contentHash: "string",
        modifiedAt: "int64",
        sizeBytes: "int64",
        chunkCount: "int32",
        indexedAt: "int64",
        modelId: "string",
      },
      mode: "overwrite",
    });

    this.chunksTable = await this.connection.createTable(CHUNKS_TABLE, {
      schema: {
        chunkId: "string",
        notePath: "string",
        chunkIndex: "int32",
        text: "string",
        tokenCount: "int32",
        headingPath: "list<string>",
        byteOffsetStart: "int32",
        byteOffsetEnd: "int32",
        vector: `vector<float, ${EMBEDDING_DIM}>`,
      },
      mode: "overwrite",
    });

    await this.ensureVectorIndex();
  }

  private async ensureVectorIndex(): Promise<void> {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    // Index will be created automatically on first search or can be created manually later
    // For now, we skip explicit index creation due to API variations
  }

  getMetadataTable(): Table {
    if (!this.metadataTable) throw new Error("LanceDB not initialized");
    return this.metadataTable;
  }

  getChunksTable(): Table {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    return this.chunksTable;
  }

  async searchSimilarChunks(
    queryVector: Float32Array,
    topK: number = 10,
    excludeNotePath?: string
  ): Promise<NoteChunkRecord[]> {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    let query = this.chunksTable
      .vectorSearch(queryVector)
      .limit(topK)
      .select([
        "chunkId",
        "notePath",
        "chunkIndex",
        "text",
        "tokenCount",
        "headingPath",
        "byteOffsetStart",
        "byteOffsetEnd",
      ]);
    if (excludeNotePath) {
      query = query.where(`notePath != '${this.escapeSqlString(excludeNotePath)}'`);
    }
    return query.toArray() as Promise<NoteChunkRecord[]>;
  }

  async upsertMetadata(metadata: NoteMetadata): Promise<void> {
    if (!this.metadataTable) throw new Error("LanceDB not initialized");
    await this.metadataTable.delete(`notePath = '${this.escapeSqlString(metadata.notePath)}'`);
    await this.metadataTable.add([metadata as any]);
  }

  async insertChunks(chunks: NoteChunkRecord[]): Promise<void> {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    await this.chunksTable.add(chunks as any);
  }

  async deleteNoteChunks(notePath: string): Promise<void> {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    await this.chunksTable.delete(`notePath = '${this.escapeSqlString(notePath)}'`);
  }

  async deleteMetadata(notePath: string): Promise<void> {
    if (!this.metadataTable) throw new Error("LanceDB not initialized");
    await this.metadataTable.delete(`notePath = '${this.escapeSqlString(notePath)}'`);
  }

  async getMetadata(notePath: string): Promise<NoteMetadata | null> {
    if (!this.metadataTable) throw new Error("LanceDB not initialized");
    const results = await this.metadataTable.query().toArray();
    return results.find((r: NoteMetadata) => r.notePath === notePath) || null;
  }

  async getAllIndexedPaths(): Promise<string[]> {
    if (!this.metadataTable) throw new Error("LanceDB not initialized");
    const results = await this.metadataTable.query().toArray();
    return results.map((r: NoteMetadata) => r.notePath);
  }

  async getTotalChunkCount(): Promise<number> {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    return this.chunksTable.countRows() as unknown as number;
  }

  async rebuildVectorIndex(): Promise<void> {
    if (!this.chunksTable) throw new Error("LanceDB not initialized");
    // Index creation is automatic in LanceDB; no manual rebuild needed
  }

  private escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
      this.metadataTable = null;
      this.chunksTable = null;
    }
  }
}