# Obsidian Linker

Find hidden conceptual connections between notes in an Obsidian vault and insert them as inline wiki-links.

Obsidian Linker builds a local vector index of your notes, retrieves semantically related passages, and uses an LLM (or an offline similarity fallback) to classify and explain the relationships. Results can be reviewed as JSON or inserted directly into your notes as `[[target|anchor]]` links.

## Features

- Scans Markdown notes in an Obsidian vault
- Chunks notes and generates embeddings locally with Transformers.js
- Stores vectors in an embedded [LanceDB](https://lancedb.com/) database inside the vault
- Retrieves candidate notes with RAG and classifies connections (causal, elaboration, contradiction, supporting, sequential, comparison, generalization, reference)
- Works offline with a similarity-based fallback when no LLM API key is available
- Inserts links at contextually appropriate anchor phrases
- Can remove previously inserted links using an insertion marker
- Incremental indexing for large vaults
- CLI with progress output

## Requirements

- Node.js 18 or newer
- npm
- A vault you are willing to modify (back it up or use version control first)

Native modules (`@lancedb/lancedb`, `onnxruntime-node`) are installed by `npm install`. The embedding model is downloaded on first use and cached in `./models`.

## Installation

```bash
git clone https://github.com/nik1138/obsidian-linker.git
cd obsidian-linker
npm install
npm run build
```

Run the CLI directly:

```bash
node dist/index.js --help
```

Or link it globally:

```bash
npm link
obsidian-linker --help
```

## Configuration

Copy the example config and edit the vault path:

```bash
cp config.example.json config.json
```

```json
{
  "vaultPath": "/path/to/your/obsidian/vault",
  "outputFile": "obsidian-links.json",
  "similarityThreshold": 0.5,
  "maxLinksPerNote": 10,
  "incremental": false,
  "clearCache": false,
  "verbose": false,
  "modelCacheDir": "./models"
}
```

`config.json` is ignored by git. All values can also be supplied through CLI flags.

### LLM API key

Online analysis uses an OpenAI-compatible StepFun endpoint. Set the key in your environment:

```bash
export STEPFUN_API_KEY="your-api-key"
```

You can also pass `--api-key`, but environment variables are safer because CLI arguments may be stored in shell history.

Without a key, the analyzer falls back to local embedding similarity.

## Usage

### Analyze a vault

```bash
node dist/index.js analyze --vault /path/to/vault
```

```bash
# Custom output file and threshold
node dist/index.js analyze --vault /path/to/vault \
  --output obsidian-links.json \
  --threshold 0.5 \
  --max-links 10

# Incremental indexing
node dist/index.js analyze --vault /path/to/vault --incremental

# Verbose output
node dist/index.js analyze --vault /path/to/vault --verbose
```

### Insert links

```bash
# Preview first
node dist/index.js insert --input obsidian-links.json --dry-run

# Insert
node dist/index.js insert --input obsidian-links.json

# Limit links per note
node dist/index.js insert --input obsidian-links.json --limit 5
```

Inserted links look like this:

```markdown
Some sentence with a [[Related Note|anchor phrase]]<!-- obsidian-linker: inserted -->.
```

The HTML comment marker lets `remove` find and delete links that were inserted by this tool.

### Remove inserted links

```bash
node dist/index.js remove --input obsidian-links.json
```

### CLI reference

#### `analyze`

| Option | Description | Default |
| --- | --- | --- |
| `-v, --vault <path>` | Path to the Obsidian vault | from config |
| `-o, --output <file>` | Output JSON file | `obsidian-links.json` |
| `-t, --threshold <number>` | Minimum confidence (0–1) | `0.5` |
| `-m, --max-links <number>` | Maximum connections per note | `10` |
| `--incremental` | Only index changed notes | `false` |
| `--clear-cache` | Clear cache before analysis | `false` |
| `--verbose` | Verbose output (API key is redacted) | `false` |
| `--api-key <key>` | StepFun API key (prefer env var) | — |
| `--max-candidates <number>` | Candidate notes sent to the LLM | `5` |
| `--top-k <number>` | Similar chunks retrieved per source chunk | `10` |
| `--max-chunks-per-candidate <number>` | Chunks kept per candidate note | `3` |

#### `insert`

| Option | Description | Default |
| --- | --- | --- |
| `-i, --input <file>` | Connections JSON file | `obsidian-links.json` |
| `--dry-run` | Preview without writing | `false` |
| `-l, --limit <number>` | Limit links per note | `10` |

#### `remove`

| Option | Description | Default |
| --- | --- | --- |
| `-i, --input <file>` | Connections JSON file | `obsidian-links.json` |

## How it works

1. Scan the vault for Markdown files.
2. Split notes into overlapping chunks.
3. Embed chunks locally with `Xenova/all-MiniLM-L6-v2` (384 dimensions).
4. Store chunks and vectors in `<vault>/.obsidian-linker/lancedb`.
5. For each note, retrieve similar chunks from other notes.
6. Send the source note and candidate excerpts to the LLM, which returns typed connections and anchor phrases as JSON.
7. If the LLM is unavailable, fall back to embedding similarity.
8. Optionally insert links into the source notes.

## Output format

```json
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "vaultPath": "/path/to/vault",
  "totalNotes": 42,
  "connections": [
    {
      "sourcePath": "/path/to/vault/Note.md",
      "sourceName": "Note",
      "connections": [
        {
          "targetNote": "Related Note",
          "targetPath": "/path/to/vault/Related Note.md",
          "type": "elaboration",
          "confidence": 0.87,
          "explanation": "Related Note expands on the same concept.",
          "anchors": [
            {
              "sourcePhrase": "exact phrase from the source note",
              "reason": "Why this is a good anchor",
              "position": 123
            }
          ]
        }
      ]
    }
  ]
}
```

## Development

```bash
npm install
npm run build        # compile TypeScript to dist/
npm run dev          # watch mode
npm test             # run the Vitest suite
npm run test:coverage
```

The project uses TypeScript with ESM (`NodeNext`). Tests live in `test/`, with a small fixture vault in `test/fixtures/small-vault`.

## Project structure

```
src/
  index.ts             CLI entry point
  config.ts            Config loading and CLI overrides
  cli/                 analyze, insert, remove commands
  backend/             chunking, embeddings, LanceDB, RAG, LLM client
  links/               link finding and insertion/removal
  vault/               vault scanning and Markdown parsing
test/                  Vitest unit and integration tests
```

## Security

- No API keys are committed. Use `STEPFUN_API_KEY` or your local `config.json` (ignored by git).
- The tool writes to notes in place. Use version control or a backup, and start with `insert --dry-run`.

## License

MIT