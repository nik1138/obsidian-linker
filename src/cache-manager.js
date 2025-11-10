const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

/**
 * CacheManager - Module for managing cached data to optimize performance
 */
class CacheManager {
  /**
   * Constructor
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger;
    this.cacheDir = './cache';
    this.metadataFile = path.join(this.cacheDir, 'metadata.json');
    this.embeddingsFile = path.join(this.cacheDir, 'embeddings.json');
    
    // In-memory cache for faster access
    this.memoryCache = new Map();
    
    // Cache metadata
    this.metadata = {};
  }

  /**
   * Initialize cache directory and load metadata
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Create cache directory if it doesn't exist
      await fs.ensureDir(this.cacheDir);
      
      // Load metadata if it exists
      if (await fs.pathExists(this.metadataFile)) {
        const metadataContent = await fs.readFile(this.metadataFile, 'utf8');
        this.metadata = JSON.parse(metadataContent);
        this.logger.info(`Loaded cache metadata for ${Object.keys(this.metadata).length} files`);
      } else {
        this.metadata = {};
        this.logger.info('Initialized new cache metadata');
      }
      
      this.logger.info('Cache manager initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing cache manager:', error);
      throw error;
    }
  }

  /**
   * Check if a file's cache is valid
   * @param {string} filePath - Path to file
   * @param {Object} currentStats - Current file stats
   * @returns {boolean} - Whether cache is valid
   */
  isCacheValid(filePath, currentStats) {
    const fileKey = this.getFileKey(filePath);
    
    // Check if file exists in metadata
    if (!this.metadata[fileKey]) {
      return false;
    }
    
    const cachedMetadata = this.metadata[fileKey];
    
    // Check if file has been modified
    if (currentStats.mtime.getTime() > cachedMetadata.modified) {
      return false;
    }
    
    // Check if file size has changed
    if (currentStats.size !== cachedMetadata.size) {
      return false;
    }
    
    return true;
  }

  /**
   * Get cached embeddings for a file
   * @param {string} filePath - Path to file
   * @returns {Promise<Array<number>|null>} - Embeddings or null if not cached
   */
  async getCachedEmbeddings(filePath) {
    try {
      // Check memory cache first
      const fileKey = this.getFileKey(filePath);
      if (this.memoryCache.has(fileKey)) {
        this.logger.debug(`Using memory cache for ${filePath}`);
        return this.memoryCache.get(fileKey);
      }
      
      // Check if embeddings file exists
      if (!(await fs.pathExists(this.embeddingsFile))) {
        return null;
      }
      
      // Load embeddings
      const embeddingsContent = await fs.readFile(this.embeddingsFile, 'utf8');
      const embeddingsData = JSON.parse(embeddingsContent);
      
      // Check if file exists in embeddings
      if (embeddingsData[fileKey]) {
        this.logger.debug(`Using disk cache for ${filePath}`);
        const embeddings = embeddingsData[fileKey];
        
        // Store in memory cache for faster access next time
        this.memoryCache.set(fileKey, embeddings);
        
        return embeddings;
      }
      
      return null;
    } catch (error) {
      this.logger.warn(`Error reading cache for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Cache embeddings for a file
   * @param {string} filePath - Path to file
   * @param {Array<number>} embeddings - Embeddings to cache
   * @param {Object} fileStats - File stats
   * @returns {Promise<void>}
   */
  async cacheEmbeddings(filePath, embeddings, fileStats) {
    try {
      const fileKey = this.getFileKey(filePath);
      
      // Update metadata
      this.metadata[fileKey] = {
        path: filePath,
        size: fileStats.size,
        modified: fileStats.mtime.getTime(),
        cached: Date.now()
      };
      
      // Store in memory cache
      this.memoryCache.set(fileKey, embeddings);
      
      // Load existing embeddings data
      let embeddingsData = {};
      if (await fs.pathExists(this.embeddingsFile)) {
        const embeddingsContent = await fs.readFile(this.embeddingsFile, 'utf8');
        embeddingsData = JSON.parse(embeddingsContent);
      }
      
      // Update embeddings data
      embeddingsData[fileKey] = embeddings;
      
      // Save embeddings data
      await fs.writeFile(this.embeddingsFile, JSON.stringify(embeddingsData, null, 2));
      
      // Save metadata
      await fs.writeFile(this.metadataFile, JSON.stringify(this.metadata, null, 2));
      
      this.logger.debug(`Cached embeddings for ${filePath}`);
    } catch (error) {
      this.logger.error(`Error caching embeddings for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get file key for caching
   * @param {string} filePath - Path to file
   * @returns {string} - File key
   */
  getFileKey(filePath) {
    // Create a hash of the file path for consistent keys
    return crypto.createHash('md5').update(filePath).digest('hex');
  }

  /**
   * Clear all cache
   * @returns {Promise<void>}
   */
  async clearCache() {
    try {
      // Clear memory cache
      this.memoryCache.clear();
      this.metadata = {};
      
      // Remove cache files
      if (await fs.pathExists(this.cacheDir)) {
        await fs.remove(this.cacheDir);
        this.logger.info('Cache cleared successfully');
      }
      
      // Recreate cache directory
      await this.initialize();
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    return {
      memoryCacheSize: this.memoryCache.size,
      diskCacheSize: Object.keys(this.metadata).length,
      cacheDir: this.cacheDir
    };
  }

  /**
   * Remove stale cache entries
   * @param {number} maxAge - Maximum age in milliseconds (default: 7 days)
   * @returns {Promise<void>}
   */
  async removeStaleCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      const now = Date.now();
      let removedCount = 0;
      
      // Load embeddings data
      let embeddingsData = {};
      if (await fs.pathExists(this.embeddingsFile)) {
        const embeddingsContent = await fs.readFile(this.embeddingsFile, 'utf8');
        embeddingsData = JSON.parse(embeddingsContent);
      }
      
      // Check each cached file
      for (const [fileKey, metadata] of Object.entries(this.metadata)) {
        const age = now - metadata.cached;
        
        if (age > maxAge) {
          // Remove from metadata
          delete this.metadata[fileKey];
          
          // Remove from embeddings data
          if (embeddingsData[fileKey]) {
            delete embeddingsData[fileKey];
          }
          
          // Remove from memory cache
          this.memoryCache.delete(fileKey);
          
          removedCount++;
        }
      }
      
      // Save updated data
      await fs.writeFile(this.metadataFile, JSON.stringify(this.metadata, null, 2));
      await fs.writeFile(this.embeddingsFile, JSON.stringify(embeddingsData, null, 2));
      
      this.logger.info(`Removed ${removedCount} stale cache entries`);
    } catch (error) {
      this.logger.error('Error removing stale cache:', error);
      throw error;
    }
  }
}

module.exports = CacheManager;