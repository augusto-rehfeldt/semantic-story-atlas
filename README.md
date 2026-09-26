# Shelfscape

Shelfscape (formerly Semantic Story Atlas) is a Flask + vanilla JavaScript app for exploring a text collection with embeddings. It indexes `.txt` and `.csv` content, projects embeddings into 2D, and lets you search the library with natural-language queries while the results animate in the UI.

## What it does

- Indexes your text collection into embeddings
- Projects stories into 2D for visualization
- Searches by semantic similarity using a natural-language query
- Shows the library as a 2D map; a search moves every book into similarity rings around the query, best matches first
- Supports series-aware grouping and story detail cards
- Press `/` to focus the search box; clearing it returns to the map view

## Repository layout

```text
shelfscape/
├── backend/
│   ├── app.py          # Flask server and API routes
│   └── embeddings.py   # Loading, caching, embedding, and projection logic
├── frontend/
│   ├── index.html      # UI shell
│   ├── styles.css      # App styling
│   └── script.js       # Canvas graph, search UX, and interaction logic
├── examples/
│   ├── sample_book.txt
│   └── sample_chapter.txt
├── generate_stories.py # Helper to generate sample stories into stories/
├── requirements.txt    # Python dependencies
└── README.md
```

## Requirements

- Python 3.8+
- Packages from `requirements.txt`
- Optional: a GPU for faster local encoding
- Optional: `umap-learn` for better 2D projections; the app falls back to PCA if it is unavailable

## Quick start

From the repository root:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Add your content to a `stories/` folder at the repo root. The app expects plain text files there, and optionally CSV files and cover images:

```text
stories/
├── 001_my_story.txt
├── 002_another_story.txt
└── covers/
    └── my_cover.jpg
```

You can also generate sample data:

```bash
python generate_stories.py
```

Then start the backend:

```bash
python backend/app.py
```

Open the app in your browser at:

```text
http://localhost:5000
```

## Text formats

### TXT

Each `.txt` file should start with a title line:

```text
# Title of Your Text

The content goes here.
```

You can optionally add frontmatter right after the title:

```text
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

### CSV

Drop `.csv` files into `stories/` for bulk import.

Required column:

- `content`

Optional columns:

- `title`
- `author` or `authors`
- `summary` or `#summary`
- `cover`
- `series`
- `series_index`
- `genre`
- `tags`
- `year`

## Embedding providers

By default, the backend uses `sentence_transformers` with `Qwen/Qwen3-Embedding-0.6B`.

To use LM Studio instead, set these environment variables before starting the backend:

```bash
export EMBEDDING_PROVIDER=lm_studio
export EMBEDDING_MODEL=text-embedding-qwen3-embedding-0.6b
export LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
export LM_STUDIO_API_KEY=lm-studio
python backend/app.py
```

Useful tuning variables:

- `EMBEDDING_ENCODING_MODE` — `auto`, `single`, or `multi`
- `EMBEDDING_MAX_BATCH_SIZE`
- `EMBEDDING_MIN_BATCH_SIZE`
- `CUDA_MEMORY_SAFETY_MB`
- `EMBEDDING_BENCHMARK`
- `EMBEDDING_BENCHMARK_SAMPLE_SIZE`
- `EMBEDDING_QUERY_INSTRUCTION`

## API endpoints

The backend currently exposes:

- `GET /` — frontend
- `GET /api/health` — health check
- `GET /api/stories` — all indexed stories with 2D positions and a short excerpt
- `GET /api/story/<story_id>` — one story, with its full summary
- `GET /api/story/<story_id>/cover` — story cover lookup
- `GET /api/covers/<filename>` — cover image from `stories/covers/`
- `POST /api/search` with `{"query": "..."}` — every story ranked best first as `{id, similarity, rank, radialPosition}`

## Caches

The backend writes embedding (`.npz`) and projection (`.json`) caches under `backend/`.
An older JSON embedding cache is converted on first start.
They are keyed by provider/model so different embedding setups do not overwrite each other.
If you change your dataset and want a clean rebuild, delete the cache files and restart the server.

## Notes

- The app loads stories from `stories/` relative to the repo root.
- Cover images can live in `stories/covers/` or be referenced by path in story metadata.
- `examples/` contains sample text files you can copy into your own dataset.
- If the configured port is busy, the backend automatically tries the next port up to 5099.

## Calibre/book-watch integration

From book-watch, run `python book_watch.py export-atlas --output data/atlas/library.csv`.
Then, from this project, run `python backend/app.py --stories ../book-watch/data/atlas`.
This selects the exported library without mixing it into the original stories folder.
The summarizer plugin's custom column feeds the export; book comments are a fallback.

CSV may include `id` and `calibre_id`. Explicit IDs survive sorting and re-export;
duplicate IDs are rejected. Files without explicit IDs retain their legacy row IDs.
Embedding caches use the actual per-record embedding text, provider and model, so an
edited CSV row does not re-encode every other row. Projection caches fingerprint the
ordered dataset; replacing/editing stories rebuilds positions automatically. Legacy
caches are rebuilt once. Restart the backend after updating a collection.

Offline cache checks (tiny synthetic encoder, no downloads):
`python -B -m unittest -q test_cache`.
