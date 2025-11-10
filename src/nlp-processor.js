const { pipeline, env } = require('@xenova/transformers');

/**
 * NLPProcessor - Module for natural language processing
 * 
 * This module uses transformer models to process text and find
 * conceptual similarities between documents.
 */
class NLPProcessor {
  /**
   * Constructor
   * @param {Object} logger - Logger instance
   * @param {CacheManager} cacheManager - Cache manager instance (optional)
   */
  constructor(logger, cacheManager = null) {
    this.logger = logger;
    this.cacheManager = cacheManager;
    
    // Set local model path
    env.localModelPath = './models';
    // Allow remote models for initial download
    env.allowRemoteModels = true;
    
    // Initialize models (will be loaded on first use)
    this.featureExtractor = null;
    this.embeddingsCache = new Map();
  }

  /**
   * Initialize the NLP models
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('Initializing NLP models...');
      
      // Use a lightweight feature extraction model
      // This model is good for sentence embeddings
      this.featureExtractor = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
      
      this.logger.info('NLP models initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing NLP models:', error);
      throw error;
    }
  }

  /**
   * Extract embeddings from text
   * @param {string} text - Input text
   * @param {Object} fileMetadata - File metadata for caching (optional)
   * @returns {Promise<Array<number>>} - Embeddings vector
   */
  async extractEmbeddings(text, fileMetadata = null) {
    try {
      // Check cache first
      if (this.embeddingsCache.has(text)) {
        this.logger.debug('Using memory cache for embeddings');
        return this.embeddingsCache.get(text);
      }
      
      // Check disk cache if cache manager is available
      if (this.cacheManager && fileMetadata) {
        const cachedEmbeddings = await this.cacheManager.getCachedEmbeddings(fileMetadata.path);
        if (cachedEmbeddings) {
          // Store in memory cache for faster access next time
          this.embeddingsCache.set(text, cachedEmbeddings);
          return cachedEmbeddings;
        }
      }
      
      // Initialize model if needed
      if (!this.featureExtractor) {
        await this.initialize();
      }
      
      // Clean and truncate text for better performance
      const cleanedText = this.cleanText(text);
      const truncatedText = this.truncateText(cleanedText, 512);
      
      this.logger.debug(`Extracting embeddings for text (length: ${truncatedText.length})`);
      
      // Extract embeddings
      const output = await this.featureExtractor(truncatedText, {
        pooling: 'mean',
        normalize: true
      });
      
      // Convert to array
      const embeddings = Array.from(output.data);
      
      // Cache the result
      this.embeddingsCache.set(text, embeddings);
      
      // Save to disk cache if cache manager is available
      if (this.cacheManager && fileMetadata) {
        await this.cacheManager.cacheEmbeddings(
          fileMetadata.path,
          embeddings,
          fileMetadata
        );
      }
      
      return embeddings;
    } catch (error) {
      this.logger.error('Error extracting embeddings:', error);
      throw error;
    }
  }

  /**
   * Calculate similarity between two texts
   * @param {string} text1 - First text
   * @param {string} text2 - Second text
   * @returns {Promise<number>} - Similarity score (0-1)
   */
  async calculateSimilarity(text1, text2) {
    try {
      // Extract embeddings
      const embeddings1 = await this.extractEmbeddings(text1);
      const embeddings2 = await this.extractEmbeddings(text2);
      
      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(embeddings1, embeddings2);
      
      this.logger.debug(`Similarity between texts: ${similarity.toFixed(4)}`);
      
      return similarity;
    } catch (error) {
      this.logger.error('Error calculating similarity:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Array<number>} vec1 - First vector
   * @param {Array<number>} vec2 - Second vector
   * @returns {number} - Cosine similarity (0-1)
   */
  cosineSimilarity(vec1, vec2) {
    // Calculate dot product
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }
    
    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);
    
    if (mag1 === 0 || mag2 === 0) {
      return 0;
    }
    
    return dotProduct / (mag1 * mag2);
  }

  /**
   * Clean text for better processing
   * @param {string} text - Input text
   * @returns {string} - Cleaned text
   */
  cleanText(text) {
    // Remove extra whitespace
    let cleaned = text.replace(/\s+/g, ' ');
    
    // Remove markdown artifacts
    cleaned = cleaned.replace(/[*_~`#\[\]()\-`]/g, '');
    
    // Remove URLs
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    
    // Trim and normalize
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  /**
   * Truncate text to maximum length
   * @param {string} text - Input text
   * @param {number} maxLength - Maximum length
   * @returns {string} - Truncated text
   */
  truncateText(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }
    
    // Truncate and add ellipsis
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Batch process multiple texts
   * @param {Array<string>} texts - Array of texts
   * @param {Array<Object>} fileMetadataList - Array of file metadata (optional)
   * @returns {Promise<Array<Array<number>>>} - Array of embeddings
   */
  async batchExtractEmbeddings(texts, fileMetadataList = null) {
    const embeddings = [];
    
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const fileMetadata = fileMetadataList ? fileMetadataList[i] : null;
      const embedding = await this.extractEmbeddings(text, fileMetadata);
      embeddings.push(embedding);
    }
    
    return embeddings;
  }
}

module.exports = NLPProcessor;