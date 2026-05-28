import fsExtra from "fs-extra";
import path from "path";

export interface AppConfig {
  vaultPath: string;
  outputFile: string;
  similarityThreshold: number;
  maxLinksPerNote: number;
  incremental: boolean;
  clearCache: boolean;
  verbose: boolean;
  apiKey?: string;
  modelCacheDir?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  vaultPath: "",
  outputFile: "links.json",
  similarityThreshold: 0.5,
  maxLinksPerNote: 10,
  incremental: false,
  clearCache: false,
  verbose: false,
};

/**
 * Config loader - loads from config.json and CLI overrides
 */
export class ConfigLoader {
  private configPath: string;
  private config: AppConfig;

  constructor(configPath = "config.json") {
    this.configPath = configPath;
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Load config from file and apply overrides
   */
  async load(overrides: Partial<AppConfig> = {}): Promise<AppConfig> {
    // Load from file if exists
    if (await fsExtra.pathExists(this.configPath)) {
      try {
        const fileContent = await fsExtra.readFile(this.configPath, "utf-8");
        const fileConfig = JSON.parse(fileContent);
        this.config = { ...this.config, ...fileConfig };
      } catch (error) {
        console.warn(`Failed to load config from ${this.configPath}:`, error);
      }
    }

    // Apply CLI overrides
    this.config = { ...this.config, ...overrides };

    // Validate required fields
    if (!this.config.vaultPath) {
      throw new Error("vaultPath is required in config or CLI arguments");
    }

    // Resolve vault path to absolute
    this.config.vaultPath = path.resolve(this.config.vaultPath);

    return this.config;
  }

  /**
   * Get current config
   */
  getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * Save config to file
   */
  async save(): Promise<void> {
    await fsExtra.writeFile(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
  }
}

/**
 * Merge CLI arguments into config overrides
 */
export function cliOverridesToPartial(
  args: Record<string, any>
): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {};

  if (args.vault !== undefined) overrides.vaultPath = args.vault;
  if (args.output !== undefined) overrides.outputFile = args.output;
  if (args.threshold !== undefined) overrides.similarityThreshold = parseFloat(args.threshold);
  if (args.maxLinks !== undefined) overrides.maxLinksPerNote = parseInt(args.maxLinks);
  if (args.incremental !== undefined) overrides.incremental = args.incremental;
  if (args.clearCache !== undefined) overrides.clearCache = args.clearCache;
  if (args.verbose !== undefined) overrides.verbose = args.verbose;
  if (args.apiKey !== undefined) overrides.apiKey = args.apiKey;
  if (args.modelCacheDir !== undefined) overrides.modelCacheDir = args.modelCacheDir;

  return overrides;
}
