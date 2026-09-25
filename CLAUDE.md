# Semantic Story Atlas

## What This Is
Flask + vanilla JS: embeddings index of a text collection, 2D projection, natural-language search with animated results.

## Non-Negotiables
- Never commit secrets from `.env`.

## Commands
- Run: `python backend/app.py`
- Deps: `pip install -r requirements.txt`
- Sample content: `python generate_stories.py`

## Cache and library contract

- CSV IDs are stable when supplied; reject duplicates. `calibre_id` is source metadata.
- Hash embedding inputs per record and fingerprint projections by ordered dataset.
- `--stories` selects a collection; never combine exports with an existing collection implicitly.
- Check: `python -B -m unittest -q test_cache` (no model/network needed).

## Embeddings providers

- `sentence_transformers` runs in-process. `lm_studio` (any OpenAI-compatible `/embeddings`)
  goes through book writer's shared AIService (`shared_embedding_service()`, `AIService.embed`;
  sibling `book writer` folder or `ATLAS_BOOK_WRITER`) — no provider client of its own.
