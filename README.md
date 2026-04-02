# Embedding Query Prototype

A semantic search visualization tool that lets you explore a collection of texts using natural language queries. Texts are encoded into vector embeddings and displayed in 2D space — search results animate as a radial "wave" ranked by similarity.

![Architecture: Flask backend + vanilla JS frontend with canvas visualization]

## How It Works

1. Text files in `stories/` are loaded and encoded using either [sentence-transformers](https://www.sbert.net/) or an OpenAI-compatible embedding server such as LM Studio
2. Embeddings are projected to 2D using UMAP (or PCA fallback) for visualization
3. When you search, your query is encoded and compared against all texts via cosine similarity
4. Results stream in real-time with two view modes:
   - **Radial View** — results arranged in concentric rings by similarity (closest = most similar)
   - **Fixed View** — texts plotted at their true embedding-space positions

## Quick Start

### Option A: Local sentence-transformers model

```bash
# 1. Clone and set up
git clone <this-repo>
cd embedding-query-prototype
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Add your texts (see "Using Custom Datasets" below)
#    Or generate sample stories:
python generate_stories.py

# 4. Run
python backend/app.py
```

Open `http://localhost:5000` in your browser.

### Option B: LM Studio embeddings

1. Open LM Studio and load `Qwen/Qwen3-Embedding-0.6B-GGUF` or another embedding model.
2. Make sure the local server is running at `http://127.0.0.1:1234/v1`.
3. Set the embedding provider before starting the backend:

PowerShell:

```powershell
$env:EMBEDDING_PROVIDER = "lm_studio"
$env:EMBEDDING_MODEL = "text-embedding-qwen3-embedding-0.6b"
$env:LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1"
$env:LM_STUDIO_API_KEY = "lm-studio"
python backend\app.py
```

`set EMBEDDING_PROVIDER=...` is for `cmd.exe`, not PowerShell.

On macOS/Linux, use `export` instead.

## Using Custom Datasets

**Yes, this works with any text dataset** — books, articles, notes, research papers, etc. The system reads plain `.txt` files from the `stories/` folder.
It also reads `.csv` files, which is the easiest way to bulk import rows with fields like `title`, `author`, `cover`, and `content`.

### File Format

Each file should be a `.txt` file with a title on the first line (prefixed with `#`) followed by the content:

```
# Title of Your Text

The actual content goes here. This can be as long as you want,
but only the first ~1000 characters are used for the embedding,
and ~500 characters are shown in the preview.
```

### Optional Metadata (Frontmatter)

You can add optional metadata between `---` delimiters right after the title. All fields are optional — files without frontmatter continue to work exactly as before.

```
# Moby Dick
---
author: Herman Melville
summary: A whaling captain's obsessive quest for a white whale.
cover: moby_dick.jpg
genre: Adventure
tags: sea, whaling, obsession
year: 1851
---

Call me Ishmael...
```

| Field | Description |
|-------|-------------|
| `author` | Author name, shown below the title |
| `summary` | Short description — used for the embedding (much better search quality for books) and shown as the card excerpt |
| `cover` | Filename of a cover image in `stories/covers/` (e.g. `moby_dick.jpg`) |
| `genre` | Genre tag displayed on the card |
| `tags` | Comma-separated tags (for future use) |
| `year` | Publication year |

### CSV Import

You can also drop a `.csv` file into `stories/` with one row per item. Column names are normalized a bit, so `authors` maps to `author` and `#summary` maps to `summary`.

### Using CSV With The App

1. Put your CSV file in the `stories/` folder.
2. Make sure it has columns like `title`, `authors`, `cover`, `series`, `series_index`, and `#summary`.
3. Restart the backend app.
4. If the new stories do not appear, clear the caches and restart again:
   ```bash
   rm -f backend/embeddings_cache_qwen3_embedding_0_6b.json backend/projection_cache_qwen3_embedding_0_6b.json
   ```

Required column:

| Column | Description |
|--------|-------------|
| `content` | Text to embed and preview |

Optional columns:

| Column | Description |
|--------|-------------|
| `title` | Title shown on the card. If omitted, the filename plus row number is used |
| `author` / `authors` | Author name. Leave blank if you do not have one |
| `cover` | Cover image filename in `stories/covers/` |
| `cover_route` | Alias for `cover` |
| `cover path` | Alias for `cover` |
| `series` | Series name |
| `series_index` | Series number / position |
| `summary` / `#summary` | Short summary used for embedding and preview. If `content` is missing, this will be used as the text body |
| `genre` | Genre tag displayed on the card |
| `tags` | Comma-separated tags |
| `year` | Publication year |

Example:

```csv
title,authors,cover,series,series_index,#summary
Moby Dick,Herman Melville,moby_dick.jpg,Classic Sea Tales,1,A whaling captain's obsessive quest for a white whale.
Untitled Essay,,,Misc Essays,,First paragraph of the essay...
```

### Cover Images

Place cover images in the `stories/covers/` folder and reference them by filename in the frontmatter:

```
stories/
  covers/
    moby_dick.jpg
    gatsby.png
  001_moby_dick.txt
  002_great_gatsby.txt
```

When a cover image is provided, it replaces the auto-generated emoji gradient. Books without a `cover` field still get the default generated covers.

### Adding Your Own Books / Texts

1. **Create `.txt` files** in the `stories/` folder — one per text/chapter/section
2. **Clear the caches** (if you previously ran with different data):
   ```bash
   rm -f embeddings_cache.json projection_cache.json
   rm -f backend/embeddings_cache.json backend/projection_cache.json
   ```
3. **Start the server** — embeddings are generated automatically on first run

### Organizing a Book Collection

There are several strategies depending on your goal:

#### Option A: One file per book (best for comparing whole books)
```
stories/
  001_moby_dick.txt
  002_great_gatsby.txt
  003_pride_and_prejudice.txt
```

#### Option B: One file per chapter (best for searching within a book)
```
stories/
  moby_dick_ch01_loomings.txt
  moby_dick_ch02_the_carpet_bag.txt
  moby_dick_ch03_the_spouter_inn.txt
  gatsby_ch01.txt
  gatsby_ch02.txt
```

#### Option C: Chunked passages (best for long texts / precise search)
```
stories/
  moby_dick_001.txt    # first ~1000 chars
  moby_dick_002.txt    # next ~1000 chars
  ...
```

> **Tip:** The embedding model uses the first ~1000 characters of content. For long books, splitting into chapters or chunks gives much better search precision.

### Example Files

See the `examples/` folder for reference files showing the expected format.

### Converting Books to Text

```bash
# From PDF (requires pdftotext)
pdftotext mybook.pdf mybook.txt

# From EPUB (requires Calibre)
ebook-convert mybook.epub mybook.txt

# From HTML
python -c "
from html.parser import HTMLParser
from io import StringIO

class HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = StringIO()
    def handle_data(self, d):
        self.text.write(d)

s = HTMLStripper()
s.feed(open('mybook.html').read())
print(s.text.getvalue())
" > mybook.txt
```

Then add a `# Title` line at the top and place in `stories/`.

## Project Structure

```
embedding-query-prototype/
├── backend/
│   ├── app.py              # Flask API server
│   ├── embeddings.py       # Embedding generation, caching, similarity
│   └── requirements.txt    # Python dependencies (symlink)
├── frontend/
│   ├── index.html          # UI structure
│   ├── styles.css          # Dark-mode styling
│   └── script.js           # Canvas visualization + search logic
├── stories/                # Your text files go here
│   └── covers/             # Cover images referenced in frontmatter
├── examples/               # Reference format examples
├── generate_stories.py     # Generate sample stories for testing
├── requirements.txt        # Python dependencies
├── .gitignore
└── README.md
```

## Requirements

- Python 3.8+
- ~500 MB disk space for the sentence-transformer model (downloaded on first run)
- Dependencies: Flask, sentence-transformers, numpy, scikit-learn, umap-learn (optional)

## Configuration

| Setting | Location | Default |
|---------|----------|---------|
| Embedding provider | `app.py` / `EMBEDDING_PROVIDER` | `sentence_transformers` |
| Embedding model | `app.py` / `EMBEDDING_MODEL` | `Qwen/Qwen3-Embedding-0.6B` or `text-embedding-qwen3-embedding-0.6b` for LM Studio |
| LM Studio base URL | `app.py` / `LM_STUDIO_BASE_URL` | `http://127.0.0.1:1234/v1` |
| LM Studio API key | `app.py` / `LM_STUDIO_API_KEY` | `lm-studio` |
| Query instruction | `app.py` / `EMBEDDING_QUERY_INSTRUCTION` | `Given a book search query, retrieve relevant passages that answer the query.` |
| Content used for embedding | `embeddings.py` | Summary (if provided) or first 1000 chars |
| Preview length | `embeddings.py` | First 500 chars |
| Stories folder | `app.py:14` | `../stories` |
| Covers folder | `app.py:15` | `../stories/covers` |
| Server port | `app.py` | 5000 (auto-increments if busy) |
| Encoding mode | `EMBEDDING_ENCODING_MODE` | `auto` |
| Max batch size | `EMBEDDING_MAX_BATCH_SIZE` | `32` |
| Min batch size | `EMBEDDING_MIN_BATCH_SIZE` | `4` |
| CUDA safety buffer | `CUDA_MEMORY_SAFETY_MB` | `1536` |
| Benchmark mode | `EMBEDDING_BENCHMARK` | `0` |
| Benchmark sample size | `EMBEDDING_BENCHMARK_SAMPLE_SIZE` | `8` |

Cache files are automatically separated by provider and model so LM Studio and sentence-transformers runs do not overwrite each other.

### GPU Encoding

The loader already batches embeddings, and it can also use multiple GPUs when available.

- `auto` mode uses one GPU for a single-card machine and multi-process encoding when more than one CUDA device is available.
- Batch size is chosen from the available free GPU memory with a safety buffer, so it backs off before hitting OOM.
- You can override the behavior with environment variables if you want to be more aggressive on a larger GPU.
- If benchmark mode is enabled, startup prints an approximate tokens/sec readout using a small sample of books.

Example:

```bash
set EMBEDDING_ENCODING_MODE=multi
set EMBEDDING_MAX_BATCH_SIZE=64
set CUDA_MEMORY_SAFETY_MB=2048
set EMBEDDING_BENCHMARK=1
python backend\app.py
```

## License

MIT
