import { VaultNote, NoteChunk, DEFAULT_CHUNK_TOKENS, DEFAULT_OVERLAP_TOKENS } from "./types.js";

/** Token estimation using word count heuristic */
export function estimateTokens(text: string): number {
  // Rough heuristic: 1 token ≈ ¾ of a word (English)
  // For multilingual: 1 token ≈ 1 word for CJK, ¾ for Latin
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.ceil(words / 0.75);
}

/** Section extracted from note with heading hierarchy */
interface Section {
  text: string;
  headingPath: string[];
  byteOffset: number;
}

/** Split markdown content by headings */
function splitByHeadings(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split("\n");

  let currentHeading: string[] = [];
  let currentText: string[] = [];
  let currentByteOffset = 0;

  // Regex to match markdown headings: #, ##, ###, etc.
  const headingRegex = /^(#{1,6})\s+(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(headingRegex);

    if (match) {
      // Save previous section if exists
      if (currentText.length > 0) {
        sections.push({
          text: currentText.join("\n"),
          headingPath: [...currentHeading],
          byteOffset: currentByteOffset,
        });
      }

      // Start new section with this heading
      const level = match[1].length;
      const headingText = match[1] + " " + match[2];

      // Update heading hierarchy: truncate to current level, then add new heading
      currentHeading = currentHeading.slice(0, level - 1);
      currentHeading.push(headingText);

      currentText = [line]; // Include heading line in section
      currentByteOffset = content.indexOf(line, currentByteOffset);
    } else {
      currentText.push(line);
    }
  }

  // Don't forget the last section
  if (currentText.length > 0) {
    sections.push({
      text: currentText.join("\n"),
      headingPath: [...currentHeading],
      byteOffset: currentByteOffset,
    });
  }

  return sections;
}

/** Split text by paragraphs (double newline) */
function splitByParagraphs(text: string): string[] {
  // Split on double newline, but preserve single newlines within paragraphs
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  return paragraphs;
}

/** Split a long paragraph by sentence boundaries */
function splitBySentences(paragraph: string, maxTokens: number): string[] {
  const sentences: string[] = [];
  // Sentence boundary regex: period/exclamation/question followed by space and capital letter or end
  const sentenceRegex = /([.!?]+\s+[A-Z])/g;

  let lastIndex = 0;
  let match;

  while ((match = sentenceRegex.exec(paragraph)) !== null) {
    const splitPoint = match.index + match[0].length;
    const sentence = paragraph.slice(lastIndex, splitPoint).trim();

    if (sentence.length > 0) {
      if (estimateTokens(sentence) > maxTokens) {
        // Even a single sentence is too long, force split at character boundary
        const forcedSplit = Math.floor(sentence.length / 2);
        sentences.push(sentence.slice(0, forcedSplit));
        sentences.push(sentence.slice(forcedSplit));
      } else {
        sentences.push(sentence);
      }
    }

    lastIndex = splitPoint;
  }

  // Add remaining text
  if (lastIndex < paragraph.length) {
    const remaining = paragraph.slice(lastIndex).trim();
    if (remaining.length > 0) {
      if (estimateTokens(remaining) > maxTokens) {
        const forcedSplit = Math.floor(remaining.length / 2);
        sentences.push(remaining.slice(0, forcedSplit));
        sentences.push(remaining.slice(forcedSplit));
      } else {
        sentences.push(remaining);
      }
    }
  }

  // If no sentences found (e.g., no punctuation), return as single chunk
  if (sentences.length === 0 && paragraph.trim().length > 0) {
    sentences.push(paragraph.trim());
  }

  return sentences;
}

/** Get last N tokens from text (for overlap) */
function getLastTokens(text: string, tokenCount: number): string {
  const words = text.split(/\s+/);
  const lastWords = words.slice(-Math.ceil(tokenCount * 0.75)); // Approximate
  return lastWords.join(" ");
}

/** Build a NoteChunk from accumulated text */
function buildChunk(
  notePath: string,
  chunkIndex: number,
  text: string,
  headingPath: string[],
  byteOffsetStart: number,
  byteOffsetEnd: number
): NoteChunk {
  return {
    chunkId: `${notePath}::chunk::${chunkIndex}`,
    notePath,
    chunkIndex,
    text: text.trim(),
    tokenCount: estimateTokens(text),
    headingPath,
    byteOffsetStart,
    byteOffsetEnd,
  };
}

/** Merge small chunks with their neighbors */
function mergeSmallChunks(chunks: NoteChunk[]): NoteChunk[] {
  const MIN_TOKENS = 50;
  const merged: NoteChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const current = chunks[i];

    if (current.tokenCount < MIN_TOKENS && merged.length > 0) {
      // Merge with previous chunk
      const previous = merged[merged.length - 1];
      const combinedText = previous.text + "\n\n" + current.text;
      const combinedTokenCount = estimateTokens(combinedText);

      merged[merged.length - 1] = {
        ...previous,
        text: combinedText,
        tokenCount: combinedTokenCount,
        byteOffsetEnd: current.byteOffsetEnd,
      };
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/** Main chunking function */
export function chunkNote(note: VaultNote): NoteChunk[] {
  const sections = splitByHeadings(note.content);
  const chunks: NoteChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const paragraphs = splitByParagraphs(section.text);
    let currentChunk = "";
    let currentTokens = 0;
    let byteOffset = section.byteOffset;

    for (const para of paragraphs) {
      const paraTokens = estimateTokens(para);

      // If paragraph alone exceeds max, split by sentences
      if (paraTokens > DEFAULT_CHUNK_TOKENS) {
        // Flush current chunk first if it has content
        if (currentChunk.trim()) {
          chunks.push(
            buildChunk(
              note.path,
              chunkIndex++,
              currentChunk,
              section.headingPath,
              byteOffset,
              byteOffset + currentChunk.length
            )
          );
          // Start new chunk with overlap
          currentChunk = getLastTokens(currentChunk, DEFAULT_OVERLAP_TOKENS);
          currentTokens = estimateTokens(currentChunk);
          byteOffset += currentChunk.length + 2;
        }

        // Split paragraph into sentences
        const sentences = splitBySentences(para, DEFAULT_CHUNK_TOKENS);
        for (const sentence of sentences) {
          const sentenceTokens = estimateTokens(sentence);

          if (currentTokens + sentenceTokens > DEFAULT_CHUNK_TOKENS) {
            if (currentChunk.trim()) {
              chunks.push(
                buildChunk(
                  note.path,
                  chunkIndex++,
                  currentChunk,
                  section.headingPath,
                  byteOffset,
                  byteOffset + currentChunk.length
                )
              );
            }
            currentChunk = sentence;
            currentTokens = sentenceTokens;
            byteOffset = section.byteOffset + para.indexOf(sentence);
          } else {
            currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
            currentTokens += sentenceTokens;
          }
        }
      } else if (currentTokens + paraTokens > DEFAULT_CHUNK_TOKENS) {
        // Flush current chunk
        if (currentChunk.trim()) {
          chunks.push(
            buildChunk(
              note.path,
              chunkIndex++,
              currentChunk,
              section.headingPath,
              byteOffset,
              byteOffset + currentChunk.length
            )
          );
        }

        // Start new chunk with overlap from current
        const overlap = getLastTokens(currentChunk, DEFAULT_OVERLAP_TOKENS);
        currentChunk = overlap + (overlap ? "\n\n" : "") + para;
        currentTokens = estimateTokens(currentChunk);
        byteOffset += overlap.length + 2;
      } else {
        // Add paragraph to current chunk
        currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
        currentTokens += paraTokens;
      }
    }

    // Flush final chunk of section
    if (currentChunk.trim()) {
      chunks.push(
        buildChunk(
          note.path,
          chunkIndex++,
          currentChunk,
          section.headingPath,
          byteOffset,
          byteOffset + currentChunk.length
        )
      );
    }
  }

  // Merge undersized chunks
  return mergeSmallChunks(chunks);
}