const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const winston = require('winston');

// Import our modules
const VaultReader = require('../vault-reader');
const NLPProcessor = require('../nlp-processor');
const LinkFinder = require('../link-finder');
const CacheManager = require('../cache-manager');
const LinkInserter = require('../link-inserter');
const BackupManager = require('../backup/backup-manager');

// Setup logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'obsidian-linker-web' },
  transports: [
    new winston.transports.File({ filename: 'logs/web-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/web-combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Ensure logs directory exists
fs.ensureDirSync('./logs');

class WebServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    // Initialize modules
    this.cacheManager = new CacheManager(logger);
    this.nlpProcessor = new NLPProcessor(logger, this.cacheManager);
    this.vaultReader = new VaultReader(logger);
    this.linkFinder = new LinkFinder(this.nlpProcessor, logger);
    this.linkInserter = new LinkInserter(logger);
    this.backupManager = new BackupManager(logger);
    
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    this.app.use(express.static(path.join(__dirname, 'public')));
  }
  
  setupRoutes() {
    // Health check endpoint
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    // Analysis endpoints
    this.app.post('/api/analyze', this.analyzeVault.bind(this));
    
    // Insertion endpoints
    this.app.post('/api/insert', this.insertLinks.bind(this));
    this.app.post('/api/remove', this.removeLinks.bind(this));
    
    // Backup endpoints
    this.app.post('/api/backups/create', this.createBackup.bind(this));
    this.app.get('/api/backups/list', this.listBackups.bind(this));
    this.app.post('/api/backups/restore', this.restoreBackup.bind(this));
    this.app.delete('/api/backups/:backupId', this.deleteBackup.bind(this));
    
    // Serve frontend
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }
  
  async analyzeVault(req, res) {
    try {
      const { 
        vaultPath, 
        threshold = 0.5, 
        maxLinks = 10, 
        adjustLowLinks = false,
        incremental = false,
        clearCache = false,
        dryRun = false
      } = req.body;
      
      logger.info('Starting vault analysis', { vaultPath, threshold, maxLinks, adjustLowLinks });
      
      // Initialize cache manager
      await this.cacheManager.initialize();
      
      // Clear cache if requested
      if (clearCache) {
        logger.info('Clearing cache...');
        await this.cacheManager.clearCache();
      }
      
      // Validate vault path
      const resolvedVaultPath = path.resolve(vaultPath);
      logger.info(`Using vault path: ${resolvedVaultPath}`);
      
      // Get markdown files
      const files = await this.vaultReader.getMarkdownFiles(resolvedVaultPath);
      
      if (files.length === 0) {
        return res.status(400).json({ error: 'No markdown files found in vault' });
      }
      
      logger.info(`Processing ${files.length} files`);
      
      // Read and process files
      const notes = [];
      const fileMetadataList = [];
      
      for (const filePath of files) {
        try {
          // Get file metadata for caching
          const fileMetadata = await this.vaultReader.getFileMetadata(filePath);
          fileMetadataList.push(fileMetadata);
          
          // Check if cache is valid for incremental analysis
          if (incremental) {
            const stats = await fs.stat(filePath);
            if (this.cacheManager.isCacheValid(filePath, stats)) {
              logger.debug(`Skipping cached file: ${filePath}`);
              continue;
            }
          }
          
          // Read file
          const note = await this.vaultReader.readFile(filePath);
          notes.push(note);
        } catch (error) {
          logger.error(`Error processing file ${filePath}:`, error);
        }
      }
      
      if (notes.length === 0) {
        return res.status(400).json({ error: 'No files to process' });
      }
      
      logger.info(`Analyzing ${notes.length} notes`);
      
      // Configure link finder
      this.linkFinder.setSimilarityThreshold(parseFloat(threshold));
      this.linkFinder.setMaxLinksPerNote(parseInt(maxLinks));
      
      // Find conceptual links
      const links = await this.linkFinder.findLinks(notes, {
        threshold: parseFloat(threshold),
        maxLinksPerNote: parseInt(maxLinks),
        adjustLowLinks: adjustLowLinks
      });
      
      logger.info(`Found ${links.length} conceptual links`);
      
      // Group links by source note
      const groupedLinks = this.linkFinder.groupLinksBySource(links);
      
      // Prepare results
      const results = {
        metadata: {
          timestamp: new Date().toISOString(),
          vaultPath: resolvedVaultPath,
          totalFiles: files.length,
          processedNotes: notes.length,
          totalLinks: links.length,
          similarityThreshold: parseFloat(threshold),
          maxLinksPerNote: parseInt(maxLinks),
          cacheStats: this.cacheManager.getCacheStats()
        },
        links: links,
        groupedLinks: groupedLinks
      };
      
      // Output results
      if (!dryRun) {
        const outputPath = path.resolve('links.json');
        await fs.writeJson(outputPath, results, { spaces: 2 });
        logger.info(`Results saved to: ${outputPath}`);
      }
      
      res.json({
        success: true,
        results: results,
        message: `Analysis completed successfully. Found ${links.length} links.`
      });
    } catch (error) {
      logger.error('Error running vault analysis:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  async insertLinks(req, res) {
    try {
      const { 
        inputPath = 'links.json',
        sectionTitle = 'Связанные заметки',
        groupBy = 'file',
        limit 
      } = req.body;
      
      logger.info('Starting link insertion process', { inputPath, sectionTitle, groupBy, limit });
      
      // Validate input file path
      const resolvedInputPath = path.resolve(inputPath);
      logger.info(`Using input file: ${resolvedInputPath}`);
      
      // Check if input file exists
      if (!await fs.pathExists(resolvedInputPath)) {
        return res.status(400).json({ error: `Input file not found: ${resolvedInputPath}` });
      }
      
      // Prepare insertion options
      const insertOptions = {
        sectionTitle: sectionTitle || 'Связанные заметки',
        groupBy: groupBy || 'file',
        limit: limit ? parseInt(limit) : undefined
      };
      
      // Insert links into files
      await this.linkInserter.insertLinks(resolvedInputPath, insertOptions);
      logger.info('Link insertion completed successfully');
      
      res.json({
        success: true,
        message: 'Link insertion completed successfully'
      });
    } catch (error) {
      logger.error('Error running link insertion:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  async removeLinks(req, res) {
    try {
      const { inputPath = 'links.json' } = req.body;
      
      logger.info('Starting link removal process', { inputPath });
      
      // Validate input file path
      const resolvedInputPath = path.resolve(inputPath);
      logger.info(`Using input file: ${resolvedInputPath}`);
      
      // Check if input file exists
      if (!await fs.pathExists(resolvedInputPath)) {
        return res.status(400).json({ error: `Input file not found: ${resolvedInputPath}` });
      }
      
      // Remove previously inserted links
      await this.linkInserter.removeInsertedLinks(resolvedInputPath);
      logger.info('Link removal completed successfully');
      
      res.json({
        success: true,
        message: 'Link removal completed successfully'
      });
    } catch (error) {
      logger.error('Error running link removal:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  async createBackup(req, res) {
    try {
      const { files, vaultPath } = req.body;
      
      logger.info('Creating backup', { fileCount: files.length, vaultPath });
      
      // Create backup
      const backupId = await this.backupManager.createBackup(files, vaultPath);
      
      res.json({
        success: true,
        backupId: backupId,
        message: 'Backup created successfully'
      });
    } catch (error) {
      logger.error('Error creating backup:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  async listBackups(req, res) {
    try {
      const backups = await this.backupManager.listBackups();
      res.json({ backups });
    } catch (error) {
      logger.error('Error listing backups:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  async restoreBackup(req, res) {
    try {
      const { backupId } = req.body;
      
      if (!backupId) {
        return res.status(400).json({ error: 'Backup ID is required' });
      }
      
      logger.info('Restoring backup', { backupId });
      
      await this.backupManager.restoreBackup(backupId);
      
      res.json({
        success: true,
        message: 'Backup restored successfully'
      });
    } catch (error) {
      logger.error('Error restoring backup:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  async deleteBackup(req, res) {
    try {
      const { backupId } = req.params;
      
      if (!backupId) {
        return res.status(400).json({ error: 'Backup ID is required' });
      }
      
      logger.info('Deleting backup', { backupId });
      
      await this.backupManager.deleteBackup(backupId);
      
      res.json({
        success: true,
        message: 'Backup deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting backup:', error);
      res.status(500).json({ error: error.message });
    }
  }
  
  start() {
    this.app.listen(this.port, () => {
      logger.info(`Obsidian Linker web server running on port ${this.port}`);
    });
  }
}

module.exports = WebServer;