import chalk from "chalk";
import fsExtra from "fs-extra";
import path from "path";
import { LinkRemover } from "../links/remover.js";
import type { LogicalConnection } from "../backend/types.js";

interface RemoveOptions {
  input?: string;
}

/**
 * Remove command - rollback inserted wiki-links
 */
export async function removeCommand(options: RemoveOptions): Promise<void> {
  const inputFile = options.input || "obsidian-links.json";
  const inputPath = path.resolve(process.cwd(), inputFile);

  if (!(await fsExtra.pathExists(inputPath))) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  console.log(chalk.blue(`Loading connections from ${inputPath}...`));
  const data = await fsExtra.readJson(inputPath);

  // Flatten all connections into Map keyed by source path
  const connectionsBySource = new Map<string, LogicalConnection[]>();

  for (const entry of data.connections || []) {
    const sourcePath = entry.sourcePath;
    if (!sourcePath) continue;

    const existing = connectionsBySource.get(sourcePath) || [];
    existing.push(...(entry.connections || []));
    connectionsBySource.set(sourcePath, existing);
  }

  console.log(chalk.green(`Loaded connections for ${connectionsBySource.size} notes`));

  // Remove links
  console.log(chalk.blue("Removing links..."));
  const remover = new LinkRemover();
  await remover.removeLinks(connectionsBySource);

  console.log(chalk.green("Links removed successfully"));
}
