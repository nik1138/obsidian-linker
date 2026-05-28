import fsExtra from "fs-extra";
import path from "path";
import { glob } from "glob";
import MarkdownIt from "markdown-it";
import type { VaultNote } from "./types.js";

export class VaultReader {
  private mdParser: MarkdownIt;

  constructor() {
    this.mdParser = new MarkdownIt("commonmark", {
      html: false,
      linkify: false,
      typographer: false,
    });
  }

  async scanVault(vaultPath: string): Promise<string[]> {
    const pattern = path.join(vaultPath, "**/*.md");
    const files = await glob(pattern, {
      nodir: true,
      absolute: true,
      ignore: [
        "**/.git/**",
        "**/node_modules/**",
        "**/.obsidian-linker/**",
      ],
    });
    return files;
  }

  async readNote(filePath: string): Promise<VaultNote> {
    const content = await fsExtra.readFile(filePath, "utf-8");
    const stats = await fsExtra.stat(filePath);
    const name = path.basename(filePath, ".md");
    return {
      path: filePath,
      name,
      content,
      modifiedAt: stats.mtimeMs,
      sizeBytes: stats.size,
    };
  }

  async readAllNotes(filePaths: string[]): Promise<VaultNote[]> {
    return Promise.all(filePaths.map((fp) => this.readNote(fp)));
  }

  async getChangedFiles(vaultPath: string, since: Date): Promise<string[]> {
    const allFiles = await this.scanVault(vaultPath);
    const changed: string[] = [];

    for (const filePath of allFiles) {
      const stats = await fsExtra.stat(filePath);
      if (stats.mtimeMs > since.getTime()) {
        changed.push(filePath);
      }
    }

    return changed;
  }

  extractTextContent(markdown: string): string {
    const tokens = this.mdParser.parse(markdown, {});
    const textParts: string[] = [];

    for (const token of tokens) {
      if (token.type === "text") {
        textParts.push(token.content);
      }
    }

    return textParts.join(" ");
  }

  extractExistingLinks(markdown: string): string[] {
    const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = regex.exec(markdown)) !== null) {
      links.push(match[1]);
    }
    return links;
  }

  extractFrontmatter(markdown: string): Record<string, any> | null {
    const match = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    try {
      const yaml = match[1];
      const result: Record<string, any> = {};
      for (const line of yaml.split("\n")) {
        const colon = line.indexOf(":");
        if (colon > 0) {
          const key = line.slice(0, colon).trim();
          const value = line.slice(colon + 1).trim();
          result[key] = value;
        }
      }
      return result;
    } catch {
      return null;
    }
  }

  isInForbiddenZone(
    markdown: string,
    position: number
  ): { inCode: boolean; inFrontmatter: boolean; inLink: boolean } {
    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch && frontmatterMatch.index !== undefined && position >= frontmatterMatch.index && position <= frontmatterMatch.index + frontmatterMatch[0].length) {
      return { inCode: false, inFrontmatter: true, inLink: false };
    }

    const lines = markdown.slice(0, position).split("\n");
    let inFence = false;
    let fenceChar = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        if (!inFence) {
          inFence = true;
          fenceChar = trimmed[0];
        } else if (trimmed[0] === fenceChar) {
          inFence = false;
        }
      }

      if (!inFence) {
        let backtickCount = 0;
        for (let j = 0; j < line.length; j++) {
          if (line[j] === "`") backtickCount++;
        }
        if (backtickCount % 2 === 1) {
          return { inCode: true, inFrontmatter: false, inLink: false };
        }
      }
    }

    if (inFence) {
      return { inCode: true, inFrontmatter: false, inLink: false };
    }

    const before = markdown.slice(0, position);
    const open = (before.match(/\[\[/g) || []).length;
    const close = (before.match(/\]\]/g) || []).length;

    if (open > close) {
      return { inCode: false, inFrontmatter: false, inLink: true };
    }

    return { inCode: false, inFrontmatter: false, inLink: false };
  }
}
