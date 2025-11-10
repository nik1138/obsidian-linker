const fs = require('fs-extra');
const path = require('path');

/**
 * CLI - Command Line Interface for Obsidian Linker
 */
class CLI {
  /**
   * Constructor
   * @param {Object} program - Commander program instance
   * @param {VaultReader} vaultReader - Vault reader instance
   * @param {LinkFinder} linkFinder - Link finder instance
   * @param {CacheManager} cacheManager - Cache manager instance
   * @param {LinkInserter} linkInserter - Link inserter instance
   * @param {Object} logger - Logger instance
   */
  constructor(program, vaultReader, linkFinder, cacheManager, linkInserter, logger) {
    this.program = program;
    this.vaultReader = vaultReader;
    this.linkFinder = linkFinder;
    this.cacheManager = cacheManager;
    this.linkInserter = linkInserter;
    this.logger = logger;
  }

  /**
   * Run the CLI
   */
  async run() {
    // Configure CLI options
    this.program
      .name('obsidian-linker')
      .description('Find conceptual links in Obsidian vault using NLP')
      .version('1.0.0');
    
    // Analysis command
    this.program
      .command('analyze')
      .description('Analyze Obsidian vault and find conceptual links')
      .requiredOption('-v, --vault <path>', 'path to Obsidian vault')
      .option('-o, --output <file>', 'output file for links (JSON format)', 'links.json')
      .option('-t, --threshold <number>', 'similarity threshold (0-1)', '0.5')
      .option('-m, --max-links <number>', 'maximum links per note', '10')
      .option('--incremental', 'incremental analysis (only changed files)')
      .option('--clear-cache', 'clear cache before analysis')
      .option('--verbose', 'enable verbose logging')
      .option('--dry-run', 'perform dry run without saving results')
      .action(async (options) => {
        await this.handleAnalyzeCommand(options);
      });
    
    // Insert command
    this.program
      .command('insert')
      .description('Insert found links into Obsidian notes')
      .requiredOption('-i, --input <file>', 'input file with analysis results (JSON format)')
      .option('--remove', 'remove previously inserted links instead of adding them')
      .option('-t, --title <title>', 'custom title for the links section', 'Связанные заметки')
      .option('-g, --group-by <criteria>', 'group links by criteria (file, similarity)', 'file')
      .option('-l, --limit <number>', 'limit number of links per file', parseInt)
      .option('--verbose', 'enable verbose logging')
      .action(async (options) => {
        await this.handleInsertCommand(options);
      });

    // Parse command line arguments
    this.program.parse();
  }

  /**
   * Handle analyze command
   * @param {Object} options - CLI options
   */
  async handleAnalyzeCommand(options) {
    try {
      // Set log level
      if (options.verbose) {
        this.logger.level = 'debug';
      }

      this.logger.info('Starting Obsidian Linker analysis');
      
      // Initialize cache manager
      await this.cacheManager.initialize();
      
      // Clear cache if requested
      if (options.clearCache) {
        this.logger.info('Clearing cache...');
        await this.cacheManager.clearCache();
      }
      
      // Validate vault path
      const vaultPath = path.resolve(options.vault);
      this.logger.info(`Using vault path: ${vaultPath}`);
      
      // Get markdown files
      const files = await this.vaultReader.getMarkdownFiles(vaultPath);
      
      if (files.length === 0) {
        this.logger.warn('No markdown files found in vault');
        return;
      }
      
      this.logger.info(`Processing ${files.length} files`);
      
      // Read and process files
      const notes = [];
      const fileMetadataList = [];
      
      for (const filePath of files) {
        try {
          // Get file metadata for caching
          const fileMetadata = await this.vaultReader.getFileMetadata(filePath);
          fileMetadataList.push(fileMetadata);
          
          // Check if cache is valid for incremental analysis
          if (options.incremental) {
            const stats = await fs.stat(filePath);
            if (this.cacheManager.isCacheValid(filePath, stats)) {
              this.logger.debug(`Skipping cached file: ${filePath}`);
              continue;
            }
          }
          
          // Read file
          const note = await this.vaultReader.readFile(filePath);
          notes.push(note);
        } catch (error) {
          this.logger.error(`Error processing file ${filePath}:`, error);
        }
      }
      
      if (notes.length === 0) {
        this.logger.warn('No files to process');
        return;
      }
      
      this.logger.info(`Analyzing ${notes.length} notes`);
      
      // Configure link finder
      const threshold = parseFloat(options.threshold);
      const maxLinks = parseInt(options.maxLinks);
      
      this.linkFinder.setSimilarityThreshold(threshold);
      this.linkFinder.setMaxLinksPerNote(maxLinks);
      
      // Find conceptual links
      const links = await this.linkFinder.findLinks(notes, {
        threshold: threshold,
        maxLinksPerNote: maxLinks
      });
      
      this.logger.info(`Found ${links.length} conceptual links`);
      
      // Group links by source note
      const groupedLinks = this.linkFinder.groupLinksBySource(links);
      
      // Prepare results
      const results = {
        metadata: {
          timestamp: new Date().toISOString(),
          vaultPath: vaultPath,
          totalFiles: files.length,
          processedNotes: notes.length,
          totalLinks: links.length,
          similarityThreshold: threshold,
          maxLinksPerNote: maxLinks,
          cacheStats: this.cacheManager.getCacheStats()
        },
        links: links,
        groupedLinks: groupedLinks
      };
      
      // Output results
      if (!options.dryRun) {
        const outputPath = path.resolve(options.output);
        await fs.writeJson(outputPath, results, { spaces: 2 });
        this.logger.info(`Results saved to: ${outputPath}`);
      }
      
      // Log summary
      this.logSummary(results);
      
      this.logger.info('Obsidian Linker analysis completed successfully');
    } catch (error) {
      this.logger.error('Error running Obsidian Linker analysis:', error);
      process.exit(1);
    }
  }

  /**
   * Handle insert command
   * @param {Object} options - CLI options
   */
  async handleInsertCommand(options) {
    try {
      // Set log level
      if (options.verbose) {
        this.logger.level = 'debug';
      }

      this.logger.info('Starting link insertion process');
      
      // Validate input file path
      const inputPath = path.resolve(options.input);
      this.logger.info(`Using input file: ${inputPath}`);
      
      // Check if input file exists
      if (!await fs.pathExists(inputPath)) {
        this.logger.error(`Input file not found: ${inputPath}`);
        process.exit(1);
      }
      
      // Prepare insertion options
      const insertOptions = {
        sectionTitle: options.title || 'Связанные заметки',
        groupBy: options.groupBy || 'file',
        limit: options.limit ? parseInt(options.limit) : undefined
      };
      
      if (options.remove) {
        // Remove previously inserted links
        await this.linkInserter.removeInsertedLinks(inputPath);
        this.logger.info('Link removal completed successfully');
      } else {
        // Insert links into files
        await this.linkInserter.insertLinks(inputPath, insertOptions);
        this.logger.info('Link insertion completed successfully');
      }
    } catch (error) {
      this.logger.error('Error running link insertion:', error);
      process.exit(1);
    }
  }

  /**
   * Log summary of results
   * @param {Object} results - Analysis results
   */
  logSummary(results) {
    console.log('\n=== Obsidian Linker Results ===');
    console.log(`Vault Path: ${results.metadata.vaultPath}`);
    console.log(`Total Files: ${results.metadata.totalFiles}`);
    console.log(`Processed Notes: ${results.metadata.processedNotes}`);
    console.log(`Total Links Found: ${results.metadata.totalLinks}`);
    console.log(`Similarity Threshold: ${results.metadata.similarityThreshold}`);
    console.log(`Max Links Per Note: ${results.metadata.maxLinksPerNote}`);
    console.log(`Analysis Timestamp: ${results.metadata.timestamp}`);
    
    // Show cache stats
    const cacheStats = this.cacheManager.getCacheStats();
    console.log(`\nCache Stats:`);
    console.log(`  Memory Cache Size: ${cacheStats.memoryCacheSize}`);
    console.log(`  Disk Cache Size: ${cacheStats.diskCacheSize}`);
    
    // Show top connected notes
    console.log(`\nTop Connected Notes:`);
    const sortedNotes = Object.entries(results.groupedLinks)
      .map(([note, links]) => ({ note, linkCount: links.length }))
      .sort((a, b) => b.linkCount - a.linkCount)
      .slice(0, 10);
    
    for (const { note, linkCount } of sortedNotes) {
      console.log(`  ${note}: ${linkCount} links`);
    }
    
    console.log('===============================\n');
  }
}

module.exports = CLI;