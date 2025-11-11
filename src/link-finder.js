const path = require('path');

/**
 * LinkFinder - Module for finding conceptual links between notes
 */
class LinkFinder {
  /**
   * Constructor
   * @param {NLPProcessor} nlpProcessor - NLP processor instance
   * @param {Object} logger - Logger instance
   */
  constructor(nlpProcessor, logger) {
    this.nlpProcessor = nlpProcessor;
    this.logger = logger;
    
    // Similarity threshold for considering notes as related
    this.similarityThreshold = 0.5;
    
    // Maximum number of links to find per note
    this.maxLinksPerNote = 10;
    
    // Minimum threshold for iterative adjustment
    this.minAdjustmentThreshold = 0.1;
    
    // Adjustment step for iterative process
    this.adjustmentStep = 0.05;
  }

  /**
   * Find conceptual links between notes
   * @param {Array<Object>} notes - Array of note objects
   * @param {Object} options - Options for link finding
   * @returns {Promise<Array<Object>>} - Array of link objects
   */
  async findLinks(notes, options = {}) {
    try {
      this.logger.info(`Finding conceptual links between ${notes.length} notes`);
      
      // Apply options
      const threshold = options.threshold || this.similarityThreshold;
      const maxLinks = options.maxLinksPerNote || this.maxLinksPerNote;
      const adjustLowLinks = options.adjustLowLinks || false;
      const iterativeAdjustment = options.iterativeAdjustment || false;
      
      // Extract text content from notes
      const texts = notes.map(note => note.textContent || note.content);
      const noteNames = notes.map(note => note.name);
      
      this.logger.info('Extracting embeddings for all notes...');
      
      // Extract embeddings for all notes
      const embeddings = await this.nlpProcessor.batchExtractEmbeddings(texts);
      
      this.logger.info('Finding relationships between notes...');
      
      // Find links between notes
      const links = [];
      
      // Compare each note with every other note
      for (let i = 0; i < notes.length; i++) {
        const sourceNote = notes[i];
        const sourceEmbedding = embeddings[i];
        const sourceName = noteNames[i];
        
        // Store similarities for this note
        let similarities = [];
        
        // For iterative adjustment, we start with the base threshold
        let currentThreshold = threshold;
        
        // If iterative adjustment is enabled, we'll adjust the threshold until we have enough links
        if (iterativeAdjustment) {
          let iterationCount = 0;
          const maxIterations = Math.ceil((threshold - this.minAdjustmentThreshold) / this.adjustmentStep);
          
          do {
            similarities = [];
            
            for (let j = 0; j < notes.length; j++) {
              // Skip comparing note with itself
              if (i === j) continue;
              
              const targetNote = notes[j];
              const targetEmbedding = embeddings[j];
              const targetName = noteNames[j];
              
              // Calculate cosine similarity
              const similarity = this.nlpProcessor.cosineSimilarity(
                sourceEmbedding,
                targetEmbedding
              );
              
              // Only consider if above current threshold
              if (similarity >= currentThreshold) {
                similarities.push({
                  source: sourceName,
                  target: targetName,
                  similarity: similarity,
                  sourcePath: sourceNote.path,
                  targetPath: targetNote.path
                });
              }
            }
            
            // If we have enough links or we've reached the minimum threshold, break
            if (similarities.length >= 3 || currentThreshold <= this.minAdjustmentThreshold) {
              break;
            }
            
            // Reduce threshold for next iteration
            currentThreshold -= this.adjustmentStep;
            iterationCount++;
          } while (iterationCount < maxIterations);
        } else {
          // Standard approach without iterative adjustment
          for (let j = 0; j < notes.length; j++) {
            // Skip comparing note with itself
            if (i === j) continue;
            
            const targetNote = notes[j];
            const targetEmbedding = embeddings[j];
            const targetName = noteNames[j];
            
            // Calculate cosine similarity
            const similarity = this.nlpProcessor.cosineSimilarity(
              sourceEmbedding,
              targetEmbedding
            );
            
            // Only consider if above threshold
            if (similarity >= threshold) {
              similarities.push({
                source: sourceName,
                target: targetName,
                similarity: similarity,
                sourcePath: sourceNote.path,
                targetPath: targetNote.path
              });
            }
          }
        }
        
        // Sort by similarity and take top N
        similarities.sort((a, b) => b.similarity - a.similarity);
        let topSimilarities = similarities.slice(0, maxLinks);
        
        // Adjust similarity for notes with few links if enabled
        if (adjustLowLinks && topSimilarities.length <= 1) {
          // Reduce similarity by 5% for notes with 1 or fewer links
          topSimilarities = topSimilarities.map(link => ({
            ...link,
            similarity: link.similarity * 0.95
          }));
          this.logger.debug(`Adjusted similarity for note with few links: ${sourceName}`);
        }
        
        // Add to links array
        links.push(...topSimilarities);
        
        this.logger.debug(`Found ${topSimilarities.length} links for note: ${sourceName}`);
      }
      
      this.logger.info(`Found ${links.length} total conceptual links`);
      
      return links;
    } catch (error) {
      this.logger.error('Error finding links:', error);
      throw error;
    }
  }

  /**
   * Find links for a specific note against all others
   * @param {Object} sourceNote - Source note
   * @param {Array<Object>} allNotes - All notes for comparison
   * @param {Object} options - Options for link finding
   * @returns {Promise<Array<Object>>} - Array of link objects
   */
  async findLinksForNote(sourceNote, allNotes, options = {}) {
    try {
      const threshold = options.threshold || this.similarityThreshold;
      const maxLinks = options.maxLinksPerNote || this.maxLinksPerNote;
      const adjustLowLinks = options.adjustLowLinks || false;
      const iterativeAdjustment = options.iterativeAdjustment || false;
      
      // Extract text content
      const sourceText = sourceNote.textContent || sourceNote.content;
      
      this.logger.info(`Finding links for note: ${sourceNote.name}`);
      
      // Extract embedding for source note
      const sourceEmbedding = await this.nlpProcessor.extractEmbeddings(sourceText);
      
      // Find similarities
      let similarities = [];
      
      // For iterative adjustment, we start with the base threshold
      let currentThreshold = threshold;
      
      // If iterative adjustment is enabled, we'll adjust the threshold until we have enough links
      if (iterativeAdjustment) {
        let iterationCount = 0;
        const maxIterations = Math.ceil((threshold - this.minAdjustmentThreshold) / this.adjustmentStep);
        
        do {
          similarities = [];
          
          for (const targetNote of allNotes) {
            // Skip comparing note with itself
            if (sourceNote.path === targetNote.path) continue;
            
            // Extract text content
            const targetText = targetNote.textContent || targetNote.content;
            
            // Extract embedding for target note
            const targetEmbedding = await this.nlpProcessor.extractEmbeddings(targetText);
            
            // Calculate cosine similarity
            const similarity = this.nlpProcessor.cosineSimilarity(
              sourceEmbedding,
              targetEmbedding
            );
            
            // Only consider if above current threshold
            if (similarity >= currentThreshold) {
              similarities.push({
                source: sourceNote.name,
                target: targetNote.name,
                similarity: similarity,
                sourcePath: sourceNote.path,
                targetPath: targetNote.path
              });
            }
          }
          
          // If we have enough links or we've reached the minimum threshold, break
          if (similarities.length >= 3 || currentThreshold <= this.minAdjustmentThreshold) {
            break;
          }
          
          // Reduce threshold for next iteration
          currentThreshold -= this.adjustmentStep;
          iterationCount++;
        } while (iterationCount < maxIterations);
      } else {
        // Standard approach without iterative adjustment
        for (const targetNote of allNotes) {
          // Skip comparing note with itself
          if (sourceNote.path === targetNote.path) continue;
          
          // Extract text content
          const targetText = targetNote.textContent || targetNote.content;
          
          // Extract embedding for target note
          const targetEmbedding = await this.nlpProcessor.extractEmbeddings(targetText);
          
          // Calculate cosine similarity
          const similarity = this.nlpProcessor.cosineSimilarity(
            sourceEmbedding,
            targetEmbedding
          );
          
          // Only consider if above threshold
          if (similarity >= threshold) {
            similarities.push({
              source: sourceNote.name,
              target: targetNote.name,
              similarity: similarity,
              sourcePath: sourceNote.path,
              targetPath: targetNote.path
            });
          }
        }
      }
      
      // Sort by similarity and take top N
      similarities.sort((a, b) => b.similarity - a.similarity);
      let topSimilarities = similarities.slice(0, maxLinks);
      
      // Adjust similarity for notes with few links if enabled
      if (adjustLowLinks && topSimilarities.length <= 1) {
        // Reduce similarity by 5% for notes with 1 or fewer links
        topSimilarities = topSimilarities.map(link => ({
          ...link,
          similarity: link.similarity * 0.95
        }));
        this.logger.debug(`Adjusted similarity for note with few links: ${sourceNote.name}`);
      }
      
      this.logger.info(`Found ${topSimilarities.length} links for note: ${sourceNote.name}`);
      
      return topSimilarities;
    } catch (error) {
      this.logger.error(`Error finding links for note ${sourceNote.name}:`, error);
      throw error;
    }
  }

  /**
   * Set similarity threshold
   * @param {number} threshold - New threshold (0-1)
   */
  setSimilarityThreshold(threshold) {
    this.similarityThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * Set maximum links per note
   * @param {number} maxLinks - Maximum links per note
   */
  setMaxLinksPerNote(maxLinks) {
    this.maxLinksPerNote = Math.max(1, maxLinks);
  }

  /**
   * Filter links by minimum similarity
   * @param {Array<Object>} links - Array of link objects
   * @param {number} minSimilarity - Minimum similarity threshold
   * @returns {Array<Object>} - Filtered links
   */
  filterLinksBySimilarity(links, minSimilarity) {
    return links.filter(link => link.similarity >= minSimilarity);
  }

  /**
   * Group links by source note
   * @param {Array<Object>} links - Array of link objects
   * @returns {Object} - Links grouped by source note
   */
  groupLinksBySource(links) {
    const grouped = {};
    
    for (const link of links) {
      if (!grouped[link.source]) {
        grouped[link.source] = [];
      }
      grouped[link.source].push(link);
    }
    
    return grouped;
  }
}

module.exports = LinkFinder;