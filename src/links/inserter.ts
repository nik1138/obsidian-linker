import fsExtra from "fs-extra";
import path from "path";
import type { LogicalConnection, InsertOptions, InsertResult, InsertResultItem } from "../backend/types.js";

/**
 * LinkInserter - inserts wiki-style [[links]] into markdown files
 */
export class LinkInserter {
  private readonly INSERTION_MARKER = "<!-- obsidian-linker: inserted -->";

  async insertLinks(
    connectionsBySource: Map<string, LogicalConnection[]>,
    options: InsertOptions = {}
  ): Promise<InsertResult> {
    const { dryRun = false, limitPerNote = 10 } = options;
    const results: InsertResultItem[] = [];
    let totalInserted = 0;
    let totalSkipped = 0;

    for (const [sourcePath, noteConnections] of connectionsBySource) {
      const content = await this.readFile(sourcePath);
      if (!content) {
        totalSkipped += noteConnections.length;
        results.push({
          notePath: sourcePath,
          success: false,
          insertedCount: 0,
          skippedCount: noteConnections.length,
          errors: ["Could not read file"],
        });
        continue;
      }

      const sorted = [...noteConnections].sort((a, b) => b.confidence - a.confidence);
      const limited = sorted.slice(0, limitPerNote);

      let newContent = content;
      let insertedCount = 0;
      let skippedCount = 0;

      for (const conn of limited) {
        const anchor = conn.anchors[0];
        if (!anchor) {
          skippedCount++;
          continue;
        }

        if (conn.targetNote === this.extractNoteName(sourcePath)) {
          skippedCount++;
          continue;
        }

        const insertPos = this.findInsertPosition(newContent, anchor, conn.targetNote);
        if (!insertPos) {
          skippedCount++;
          continue;
        }

        const link = `[[${conn.targetNote}|${anchor.sourcePhrase}]]`;
        if (!dryRun) {
          newContent = newContent.slice(0, insertPos) + " " + link + this.INSERTION_MARKER + newContent.slice(insertPos);
        }

        insertedCount++;
        totalInserted++;
      }

      if (!dryRun && insertedCount > 0) {
        await this.writeFile(sourcePath, newContent);
      }

      results.push({
        notePath: sourcePath,
        success: true,
        insertedCount,
        skippedCount: noteConnections.length - insertedCount,
        errors: [],
      });
      totalSkipped += skippedCount;
    }

    return { results, totalInserted, totalSkipped, dryRun };
  }

  async removeLinks(connectionsBySource: Map<string, LogicalConnection[]>): Promise<void> {
    for (const [sourcePath] of connectionsBySource) {
      const content = await this.readFile(sourcePath);
      if (!content) continue;

      const pattern = new RegExp(`\\[\\[[^\\]]+\\]\\]${this.escapeRegex(this.INSERTION_MARKER)}\\s*`, "g");
      const newContent = content.replace(pattern, "").replace(/  +/g, " ");
      await this.writeFile(sourcePath, newContent);
    }
  }

  private async readFile(filePath: string): Promise<string | null> {
    try { return await fsExtra.readFile(filePath, "utf-8"); } catch { return null; }
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await fsExtra.writeFile(filePath, content, "utf-8");
  }

  private extractNoteName(filePath: string): string {
    return path.basename(filePath).replace(/\.md$/, "");
  }

  private findInsertPosition(content: string, anchor: { sourcePhrase: string; position: number }, targetNote: string): number | null {
    const phrase = anchor.sourcePhrase;
    const expectedPos = anchor.position;
    const actualIndex = content.indexOf(phrase);
    if (actualIndex === -1) return null;

    const position = Math.abs(actualIndex - expectedPos) < 50 ? expectedPos : actualIndex + phrase.length;
    if (this.isInForbiddenZone(content, position)) return null;

    const paraStart = content.lastIndexOf("\n\n", position) + 2;
    const paraEnd = content.indexOf("\n\n", position);
    const paragraph = content.slice(paraStart, paraEnd === -1 ? undefined : paraEnd);
    const linkPattern = new RegExp(`\\[\\[${this.escapeRegex(targetNote)}(?:\\|[^\\]]+)?\\]\\]`);
    if (linkPattern.test(paragraph)) return null;

    return position;
  }

  private isInForbiddenZone(content: string, position: number): boolean {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch && frontmatterMatch.index !== undefined && position >= frontmatterMatch.index && position <= frontmatterMatch.index + frontmatterMatch[0].length) {
      return true;
    }

    const before = content.slice(0, position);
    const lines = before.split("\n");
    let inFence = false;
    let fenceChar = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        if (!inFence) { inFence = true; fenceChar = trimmed[0]; }
        else if (trimmed[0] === fenceChar) inFence = false;
      }
      if (inFence) return true;
      let backticks = 0;
      for (const char of line) if (char === "`") backticks++;
      if (backticks % 2 === 1) return true;
    }
    if (inFence) return true;

    const openLinks = (before.match(/\[\[/g) || []).length;
    const closeLinks = (before.match(/\]\]/g) || []).length;
    return openLinks > closeLinks;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
