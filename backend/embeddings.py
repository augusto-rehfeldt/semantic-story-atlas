import os
import json
import hashlib
import csv
import re
import time
from urllib.parse import quote
import numpy as np
from typing import List, Dict, Tuple, Optional
import threading

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    import umap
    HAS_UMAP = True
except ImportError:
    HAS_UMAP = False
    print("UMAP not available, falling back to PCA")

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False
    print("tqdm not available, progress bar disabled")


_TORCH = None
_SENTENCE_TRANSFORMER = None
_PCA = None


def _get_torch():
    global _TORCH
    if _TORCH is None:
        import torch as _torch
        _TORCH = _torch
    return _TORCH


def _get_sentence_transformer():
    global _SENTENCE_TRANSFORMER
    if _SENTENCE_TRANSFORMER is None:
        from sentence_transformers import SentenceTransformer as _SentenceTransformer

        _SENTENCE_TRANSFORMER = _SentenceTransformer
    return _SENTENCE_TRANSFORMER


def _get_pca():
    global _PCA
    if _PCA is None:
        from sklearn.decomposition import PCA as _PCAClass

        _PCA = _PCAClass
    return _PCA


def build_cache_stem(provider: str, model_name: str) -> str:
    """Build a stable filename stem for cache files."""
    provider_slug = re.sub(r"[^a-z0-9]+", "_", provider.lower()).strip("_")
    model_slug = re.sub(r"[^a-z0-9]+", "_", model_name.lower()).strip("_")
    return f"{provider_slug}_{model_slug}"


class EmbeddingsManager:
    def __init__(
        self,
        stories_folder: str = "../stories",
        cache_file: str = "embeddings_cache_qwen3_embedding_0_6b.json",
        projection_cache_file: str = "projection_cache_qwen3_embedding_0_6b.json",
        encoding_mode: str = "auto",
        max_batch_size: int = 32,
        min_batch_size: int = 4,
        cuda_memory_safety_mb: int = 1536,
        benchmark_encoding: bool = False,
        benchmark_sample_size: int = 8,
        embedding_provider: str = "sentence_transformers",
        model_name: Optional[str] = None,
        lm_studio_base_url: str = "http://127.0.0.1:1234/v1",
        lm_studio_api_key: str = "lm-studio",
        query_instruction: str = (
            "Given a book search query, retrieve relevant passages that answer the query."
        ),
    ):
        self.stories_folder = stories_folder
        self.cache_file = cache_file
        self.projection_cache_file = projection_cache_file
        self.encoding_mode = encoding_mode
        self.max_batch_size = max_batch_size
        self.min_batch_size = min_batch_size
        self.cuda_memory_safety_mb = cuda_memory_safety_mb
        self.benchmark_encoding = benchmark_encoding
        self.benchmark_sample_size = benchmark_sample_size
        self.embedding_provider = embedding_provider.lower().strip()
        if self.embedding_provider not in ("sentence_transformers", "lm_studio"):
            raise ValueError(
                f"Unsupported embedding_provider '{embedding_provider}'. "
                "Expected 'sentence_transformers' or 'lm_studio'."
            )
        self.model = None
        self.model_name = model_name or (
            "text-embedding-qwen3-embedding-0.6b"
            if self.embedding_provider == "lm_studio"
            else "Qwen/Qwen3-Embedding-0.6B"
        )
        self.lm_studio_base_url = lm_studio_base_url
        self.lm_studio_api_key = lm_studio_api_key
        self.query_instruction = query_instruction
        self.stories: Dict[str, Dict] = {}
        self.embeddings_matrix = None
        self.normalized_matrix = None  # Pre-normalized for fast cosine similarity
        self.story_keys = []
        self.story_index: Dict[str, int] = {}  # O(1) key -> index lookup
        self.projections_2d = None
        self.reducer = None
        self._lock = threading.Lock()
        self.status_callback = None
        self.is_loading = False
        self.is_ready = False
        self.load_error = None
        self._lm_studio_client = None

    def set_status_callback(self, callback):
        self.status_callback = callback

    def _emit_status(self, message: str):
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{timestamp}][STATUS] {message}")
        if self.status_callback:
            self.status_callback(message)

    def load_model(self):
        if self.model is None:
            if self.embedding_provider == "lm_studio":
                if OpenAI is None:
                    raise ImportError(
                        "openai is required for LM Studio embeddings. Install it with `pip install openai`."
                    )
                self._emit_status(
                    f"Connecting to LM Studio embeddings at {self.lm_studio_base_url} "
                    f"using model {self.model_name}..."
                )
                self._lm_studio_client = OpenAI(
                    base_url=self.lm_studio_base_url,
                    api_key=self.lm_studio_api_key,
                )
                self.model = self._lm_studio_client
                self._emit_status("LM Studio embedding client ready!")
            else:
                self._emit_status(
                    f"Loading embedding model ({self.model_name})..."
                )
                sentence_transformer_cls = _get_sentence_transformer()
                self.model = sentence_transformer_cls(self.model_name)
                self._emit_status("Embedding model loaded successfully!")
        return self.model

    def _get_file_hash(self, filepath: str) -> str:
        with open(filepath, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()

    def _load_cache(self) -> Dict:
        if os.path.exists(self.cache_file):
            try:
                self._emit_status("Loading cached embeddings...")
                with open(self.cache_file, "r") as f:
                    cache = json.load(f)
                self._emit_status(f"Found {len(cache)} cached embeddings")
                return cache
            except Exception as e:
                self._emit_status(f"Cache load failed: {e}")
                return {}
        self._emit_status("No embedding cache found, will generate fresh embeddings")
        return {}

    def _save_cache(self, cache: Dict):
        self._emit_status(f"Saving {len(cache)} embeddings to cache...")
        with open(self.cache_file, "w") as f:
            json.dump(cache, f)
        self._emit_status("Embeddings cached successfully!")

    def _load_projection_cache(self) -> Optional[Dict]:
        if os.path.exists(self.projection_cache_file):
            try:
                self._emit_status("Loading cached 2D projections...")
                with open(self.projection_cache_file, "r") as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def _save_projection_cache(self, projections: Dict):
        self._emit_status("Saving 2D projections to cache...")
        with open(self.projection_cache_file, "w") as f:
            json.dump(projections, f)

    def _get_target_devices(self) -> List[str]:
        torch = _get_torch()
        if not torch.cuda.is_available():
            return []

        if self.encoding_mode == "single":
            return ["cuda:0"]

        device_count = torch.cuda.device_count()
        if device_count <= 1 and self.encoding_mode == "auto":
            return ["cuda:0"]

        return [f"cuda:{i}" for i in range(device_count)]

    def _estimate_batch_size(self, devices: List[str]) -> int:
        torch = _get_torch()
        if not torch.cuda.is_available():
            return self.min_batch_size

        device_ids = [int(device.split(":")[1]) for device in devices] if devices else [0]
        free_memory_mb = []

        for device_id in device_ids:
            try:
                free_bytes, _ = torch.cuda.mem_get_info(device_id)
            except TypeError:
                with torch.cuda.device(device_id):
                    free_bytes, _ = torch.cuda.mem_get_info()
            free_memory_mb.append(free_bytes / (1024 * 1024))

        available_mb = max(0, min(free_memory_mb) - self.cuda_memory_safety_mb)
        estimated = int(available_mb // 350)
        return max(self.min_batch_size, min(self.max_batch_size, estimated or self.min_batch_size))

    def _build_embedding_text(self, record: Dict) -> str:
        """Build the text used for embedding from available metadata."""
        if record["summary"]:
            parts = [record["title"]]
            if record["author"]:
                parts.append(record["author"])
            if record.get("series"):
                series_text = record["series"]
                if record.get("series_index"):
                    series_text = f"{series_text} #{record['series_index']}"
                parts.append(series_text)
            parts.append(record["summary"])
            return ". ".join(parts)

        author_prefix = f"{record['author']}. " if record["author"] else ""
        series_prefix = ""
        if record.get("series"):
            series_text = record["series"]
            if record.get("series_index"):
                series_text = f"{series_text} #{record['series_index']}"
            series_prefix = f"{series_text}. "
        return f"{record['title']}. {author_prefix}{series_prefix}{record['content'][:1000]}"

    def _encode_texts(self, texts: List[str]):
        """Encode a batch of texts, using multi-process encoding when available."""
        if self.embedding_provider == "lm_studio":
            if not texts:
                return np.array([])

            cleaned_texts = [text.replace("\n", " ") for text in texts]
            embeddings: List[List[float]] = []
            batch_size = max(1, self.max_batch_size)
            total_batches = (len(cleaned_texts) + batch_size - 1) // batch_size

            pbar = tqdm(total=total_batches, desc="Encoding via LM Studio") if HAS_TQDM else None
            for batch_index in range(0, len(cleaned_texts), batch_size):
                batch = cleaned_texts[batch_index : batch_index + batch_size]
                self._emit_status(
                    f"Encoding {len(batch)} texts via LM Studio "
                    f"(batch {(batch_index // batch_size) + 1}/{total_batches})..."
                )
                response = self.model.embeddings.create(
                    input=batch,
                    model=self.model_name,
                )
                embeddings.extend(item.embedding for item in response.data)
                if pbar:
                    pbar.update(1)

            if pbar:
                pbar.close()

            return np.array(embeddings, dtype=np.float32)

        devices = self._get_target_devices()
        batch_size = self._estimate_batch_size(devices)

        if len(devices) > 1 and self.encoding_mode in ("auto", "multi"):
            self._emit_status(
                f"Encoding {len(texts)} stories on {len(devices)} GPUs (batch_size={batch_size})..."
            )
            pool = self.model.start_multi_process_pool(target_devices=devices)
            try:
                return self.model.encode(
                    texts,
                    pool=pool,
                    batch_size=batch_size,
                    show_progress_bar=True,
                )
            finally:
                self.model.stop_multi_process_pool(pool)

        if devices == ["cuda:0"]:
            self._emit_status(
                f"Encoding {len(texts)} stories on GPU with batch_size={batch_size}..."
            )
        else:
            self._emit_status(
                f"Encoding {len(texts)} stories on CPU with batch_size={batch_size}..."
            )

        return self.model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
        )

    def _count_tokens(self, texts: List[str]) -> int:
        """Best-effort token count for throughput reporting."""
        if not texts:
            return 0

        try:
            tokenized = self.model.tokenize(texts)
            if isinstance(tokenized, dict) and "attention_mask" in tokenized:
                attention_mask = tokenized["attention_mask"]
                if hasattr(attention_mask, "sum"):
                    return int(attention_mask.sum().item())
            if isinstance(tokenized, dict) and "input_ids" in tokenized:
                input_ids = tokenized["input_ids"]
                if hasattr(input_ids, "numel"):
                    return int(input_ids.numel())
        except Exception:
            pass

        # Fallback: rough heuristic based on character count.
        return max(1, sum(max(1, len(text) // 4) for text in texts))

    def _benchmark_encoding(self, texts: List[str]):
        """Run a small encode benchmark and log approximate throughput."""
        if not self.benchmark_encoding or not texts:
            return

        sample = texts[: self.benchmark_sample_size]
        if not sample:
            return

        devices = self._get_target_devices()
        batch_size = self._estimate_batch_size(devices)
        token_count = self._count_tokens(sample)

        self._emit_status(
            f"Benchmarking embedding throughput with {len(sample)} texts (batch_size={batch_size})..."
        )

        import time as _time

        start = _time.perf_counter()
        if len(devices) > 1 and self.encoding_mode in ("auto", "multi"):
            pool = self.model.start_multi_process_pool(target_devices=devices)
            try:
                self.model.encode(sample, pool=pool, batch_size=batch_size, show_progress_bar=False)
            finally:
                self.model.stop_multi_process_pool(pool)
        else:
            self.model.encode(sample, batch_size=batch_size, show_progress_bar=False)
        elapsed = max(_time.perf_counter() - start, 1e-6)
        tokens_per_second = token_count / elapsed
        mode = "multi-GPU" if len(devices) > 1 and self.encoding_mode in ("auto", "multi") else (
            "GPU" if devices == ["cuda:0"] else "CPU"
        )
        self._emit_status(
            f"Benchmark result: {tokens_per_second:,.0f} tokens/sec on {mode} with batch_size={batch_size} "
            f"({len(sample)} texts, {token_count} tokens, {elapsed:.2f}s)"
        )

    def _encode_query(self, query: str) -> np.ndarray:
        """Encode a search query using a retrieval-style instruction prompt."""
        query_text = (
            f"Instruct: {self.query_instruction}\n"
            f"Query: {query}"
        )
        if self.embedding_provider == "lm_studio":
            response = self.model.embeddings.create(
                input=[query_text.replace("\n", " ")],
                model=self.model_name,
            )
            return np.array(response.data[0].embedding, dtype=np.float32)

        try:
            return self.model.encode(query_text, prompt_name="query")
        except (TypeError, ValueError):
            return self.model.encode(query_text)

    def _cover_url_for_story(self, story_id: str) -> str:
        story = self.stories.get(story_id, {})
        if not story.get("cover"):
            return ""
        return f"/api/story/{quote(story_id, safe='')}/cover"

    def _create_reducer(self):
        if HAS_UMAP:
            return umap.UMAP(
                n_components=2,
                n_neighbors=15,
                min_dist=0.1,
                metric="cosine",
                random_state=42,
            )
        pca_cls = _get_pca()
        return pca_cls(n_components=2, random_state=42)

    def _normalize_projections(self, projections: np.ndarray) -> np.ndarray:
        """Normalize projections to [-1, 1] range."""
        min_vals = projections.min(axis=0)
        max_vals = projections.max(axis=0)
        return 2 * (projections - min_vals) / (max_vals - min_vals) - 1

    def _compute_2d_projections(self):
        method = "UMAP" if HAS_UMAP else "PCA"
        self._emit_status(f"Computing 2D projections using {method}...")

        self.reducer = self._create_reducer()
        self.projections_2d = self._normalize_projections(
            self.reducer.fit_transform(self.embeddings_matrix)
        )

        projection_data = {
            key: self.projections_2d[i].tolist()
            for i, key in enumerate(self.story_keys)
        }
        self._save_projection_cache(projection_data)
        self._emit_status("2D projections computed and cached!")

    def project_query(self, query_embedding: np.ndarray) -> Tuple[float, float]:
        if self.reducer is None:
            return (0.0, 0.0)

        try:
            projection = self.reducer.transform(query_embedding.reshape(1, -1))[0]

            min_vals = self.projections_2d.min(axis=0)
            max_vals = self.projections_2d.max(axis=0)

            projection = np.clip(projection, min_vals - 0.5, max_vals + 0.5)
            projection = 2 * (projection - min_vals) / (max_vals - min_vals) - 1
            projection = np.clip(projection, -1.2, 1.2)

            return (float(projection[0]), float(projection[1]))
        except Exception as e:
            print(f"[ERROR] Failed to project query: {e}")
            return (0.0, 0.0)

    def _build_index(self):
        """Build lookup structures after stories are loaded."""
        self.story_keys = list(self.stories.keys())
        self.story_index = {key: i for i, key in enumerate(self.story_keys)}
        self.embeddings_matrix = np.array(
            [self.stories[key]["embedding"] for key in self.story_keys]
        )
        # Pre-normalize for fast cosine similarity
        norms = np.linalg.norm(self.embeddings_matrix, axis=1, keepdims=True)
        self.normalized_matrix = self.embeddings_matrix / norms

    @staticmethod
    def _parse_frontmatter(text):
        """Parse optional YAML-style frontmatter from text content.

        Expected format:
            # Title
            ---
            key: value
            key: value
            ---
            Content...

        Returns (metadata_dict, content_without_frontmatter).
        """
        lines = text.split("\n")
        metadata = {}

        # Find title line first
        title_end = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped:
                title_end = i + 1
                break

        # Skip blank lines after title
        fm_start = None
        for i in range(title_end, len(lines)):
            stripped = lines[i].strip()
            if stripped == "---":
                fm_start = i
                break
            elif stripped:
                # Non-empty, non-delimiter line means no frontmatter
                break

        if fm_start is not None:
            fm_end = None
            for i in range(fm_start + 1, len(lines)):
                if lines[i].strip() == "---":
                    fm_end = i
                    break

            if fm_end is not None:
                for line in lines[fm_start + 1 : fm_end]:
                    line = line.strip()
                    if not line:
                        continue
                    colon_idx = line.find(":")
                    if colon_idx > 0:
                        key = line[:colon_idx].strip().lower()
                        value = line[colon_idx + 1 :].strip()
                        metadata[key] = value

                # Remove frontmatter block from content
                content_lines = lines[:title_end] + lines[fm_end + 1 :]
                return metadata, "\n".join(content_lines)

        return metadata, text

    @staticmethod
    def _normalize_field_name(name: str) -> str:
        return name.strip().lower().lstrip("#").replace(" ", "_").replace("-", "_")

    def _iter_story_records(self):
        """Yield normalized story records from .txt and .csv sources."""
        source_files = sorted(
            [
                f
                for f in os.listdir(self.stories_folder)
                if f.endswith(".txt") or f.endswith(".csv")
            ]
        )

        for filename in source_files:
            filepath = os.path.join(self.stories_folder, filename)

            if filename.endswith(".txt"):
                yield from self._iter_txt_story_records(filename, filepath)
            else:
                yield from self._iter_csv_story_records(filename, filepath)

    def _iter_txt_story_records(self, filename: str, filepath: str):
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        metadata, content = self._parse_frontmatter(content)
        lines = content.split("\n")
        title = lines[0].replace("#", "").strip() if lines else filename
        full_content = "\n".join(lines[1:]).strip() if len(lines) > 1 else content
        record = {
            "source_filename": filename,
            "story_id": filename,
            "file_hash": self._get_file_hash(filepath),
            "title": title,
            "author": metadata.get("author", ""),
            "summary": metadata.get("summary", ""),
            "cover": metadata.get("cover", ""),
            "series": metadata.get("series", ""),
            "series_index": metadata.get("series_index", ""),
            "genre": metadata.get("genre", ""),
            "tags": metadata.get("tags", ""),
            "year": metadata.get("year", ""),
            "content": full_content,
        }
        yield record

    def _iter_csv_story_records(self, filename: str, filepath: str):
        file_hash = self._get_file_hash(filepath)
        self._emit_status(f"Reading CSV file: {filename}")
        with open(filepath, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            base_name = os.path.splitext(filename)[0]
            for row_index, row in enumerate(reader, start=1):
                normalized = {
                    self._normalize_field_name(key): (value or "").strip()
                    for key, value in row.items()
                    if key is not None
                }
                content = (
                    normalized.get("content")
                    or normalized.get("summary")
                    or normalized.get("text")
                    or ""
                )
                if not content:
                    self._emit_status(
                        f"Skipping {filename} row {row_index}: no content or summary found"
                    )
                    continue

                title = normalized.get("title") or f"{base_name} {row_index}"
                cover = (
                    normalized.get("cover")
                    or normalized.get("cover_route")
                    or normalized.get("cover_path")
                    or ""
                )
                author = normalized.get("author") or normalized.get("authors") or ""
                series = normalized.get("series", "")
                series_index = (
                    normalized.get("series_index")
                    or normalized.get("seriesindex")
                    or normalized.get("series_no")
                    or ""
                )

                self._emit_status(
                    f"Queued CSV row {row_index}: {title}"
                    + (f" by {author}" if author else "")
                )

                yield {
                    "source_filename": filename,
                    "story_id": f"{base_name}_{row_index:04d}",
                    "file_hash": f"{file_hash}_row_{row_index}",
                    "title": title,
                    "author": author,
                    "summary": normalized.get("summary", ""),
                    "cover": cover,
                    "series": series,
                    "series_index": series_index,
                    "genre": normalized.get("genre", ""),
                    "tags": normalized.get("tags", ""),
                    "year": normalized.get("year", ""),
                    "content": content,
                }

    def load_stories(self):
        self.is_loading = True
        self.is_ready = False
        self.load_error = None

        try:
            self.stories = {}
            self.embeddings_matrix = None
            self.normalized_matrix = None
            self.story_keys = []
            self.story_index = {}
            self.projections_2d = None
            self.reducer = None

            self._emit_status("Starting to load stories...")
            self.load_model()
            self._emit_status("Scanning stories folder for .txt and .csv files...")
            cache = self._load_cache()

            story_records = list(self._iter_story_records())
            self._emit_status(f"Found {len(story_records)} story entries")

            if self.benchmark_encoding:
                benchmark_texts = [
                    self._build_embedding_text(record)
                    for record in story_records[: self.benchmark_sample_size]
                ]
                self._benchmark_encoding(benchmark_texts)

            updated_cache = {}
            story_entries = []
            new_embeddings_count = 0
            cached_embeddings_count = 0

            for idx, record in enumerate(story_records):
                cache_key = f"{record['source_filename']}_{record['file_hash']}"
                if cache_key in cache:
                    embedding = np.array(cache[cache_key]["embedding"])
                    cached_embeddings_count += 1
                    story_entries.append(
                        {"record": record, "cache_key": cache_key, "embedding": embedding}
                    )
                else:
                    self._emit_status(
                        f"Queueing embedding for: {record['title']} ({idx+1}/{len(story_records)})"
                    )
                    story_entries.append(
                        {"record": record, "cache_key": cache_key, "embedding": None}
                    )

            uncached_entries = [entry for entry in story_entries if entry["embedding"] is None]

            if uncached_entries:
                embeddings = self._encode_texts(
                    [self._build_embedding_text(entry["record"]) for entry in uncached_entries]
                )
                if isinstance(embeddings, np.ndarray) and embeddings.ndim == 1:
                    embeddings = np.expand_dims(embeddings, axis=0)

                for entry, embedding in zip(uncached_entries, embeddings):
                    entry["embedding"] = np.array(embedding)
                    updated_cache[entry["cache_key"]] = {
                        "embedding": (
                            embedding.tolist()
                            if isinstance(embedding, np.ndarray)
                            else embedding
                        ),
                        "title": entry["record"]["title"],
                    }
                    story_data = {
                        "title": entry["record"]["title"],
                        "content": (
                            entry["record"]["content"][:500] + "..."
                            if len(entry["record"]["content"]) > 500
                            else entry["record"]["content"]
                        ),
                        "embedding": np.array(embedding),
                        "filename": entry["record"]["source_filename"],
                        "author": entry["record"]["author"],
                    }
                    for key in (
                        "summary",
                        "cover",
                        "series",
                        "series_index",
                        "genre",
                        "tags",
                        "year",
                    ):
                        if entry["record"].get(key):
                            story_data[key] = entry["record"][key]
                    self.stories[entry["record"]["story_id"]] = story_data
                new_embeddings_count = len(uncached_entries)

            self._emit_status(
                f"Embedding reuse summary: {cached_embeddings_count} cached, {new_embeddings_count} new"
            )

            for entry in story_entries:
                if entry["embedding"] is None:
                    continue
                updated_cache[entry["cache_key"]] = {
                    "embedding": (
                        entry["embedding"].tolist()
                        if isinstance(entry["embedding"], np.ndarray)
                        else entry["embedding"]
                    ),
                    "title": entry["record"]["title"],
                }
                story_data = {
                    "title": entry["record"]["title"],
                    "content": (
                        entry["record"]["content"][:500] + "..."
                        if len(entry["record"]["content"]) > 500
                        else entry["record"]["content"]
                    ),
                    "embedding": entry["embedding"],
                    "filename": entry["record"]["source_filename"],
                    "author": entry["record"]["author"],
                }
                for key in (
                    "summary",
                    "cover",
                    "series",
                    "series_index",
                    "genre",
                    "tags",
                    "year",
                ):
                    if entry["record"].get(key):
                        story_data[key] = entry["record"][key]
                self.stories[entry["record"]["story_id"]] = story_data

            if new_embeddings_count > 0:
                self._emit_status(f"Generated {new_embeddings_count} new embeddings")

            self._save_cache(updated_cache)
            self._build_index()

            # Load or compute 2D projections
            projection_cache = self._load_projection_cache()
            if projection_cache and len(projection_cache) == len(self.story_keys):
                self._emit_status("Using cached 2D projections")
                self.projections_2d = np.array(
                    [projection_cache[key] for key in self.story_keys]
                )
                self._emit_status("Fitting reducer for query projection...")
                self.reducer = self._create_reducer()
                self.reducer.fit(self.embeddings_matrix)
                self._emit_status("Reducer fitted successfully!")
            else:
                self._compute_2d_projections()

            self._emit_status(
                f"Loaded {len(self.stories)} stories with embeddings and 2D projections"
            )
            self.is_ready = True
            return self.stories
        except Exception as e:
            self.load_error = str(e)
            self._emit_status(f"Failed to load stories: {e}")
            raise
        finally:
            self.is_loading = False

    def _get_story_position(self, story_id: str) -> dict:
        """Get the 2D projection position for a story."""
        idx = self.story_index[story_id]
        return {
            "x": float(self.projections_2d[idx][0]),
            "y": float(self.projections_2d[idx][1]),
        }

    def _story_metadata(self, key: str) -> Dict:
        """Extract optional metadata fields from a story."""
        story = self.stories[key]
        meta = {}
        for field in (
            "author",
            "summary",
            "cover",
            "series",
            "series_index",
            "genre",
            "tags",
            "year",
        ):
            if field in story:
                meta[field] = story[field]
        if story.get("cover"):
            meta["cover_url"] = self._cover_url_for_story(key)
        return meta

    def get_all_stories(self) -> List[Dict]:
        """Get all stories with their fixed 2D positions."""
        if not self.is_ready or self.projections_2d is None:
            return []
        results = []
        for key in self.story_keys:
            story = self.stories[key]
            entry = {
                "id": key,
                "title": story["title"],
                "content": story["content"][:200] + "...",
                "filename": key,
                "position": self._get_story_position(key),
            }
            entry.update(self._story_metadata(key))
            results.append(entry)
        return results

    def _compute_all_similarities(self, query: str) -> List[Tuple[int, str, float]]:
        """Compute cosine similarities between query and all stories (vectorized)."""
        query_embedding = self._encode_query(query)
        query_norm = query_embedding / np.linalg.norm(query_embedding)

        # Vectorized cosine similarity: dot product of normalized vectors
        similarities = self.normalized_matrix @ query_norm

        results = [
            (i, key, float(similarities[i]))
            for i, key in enumerate(self.story_keys)
        ]
        results.sort(key=lambda x: x[2], reverse=True)
        return results, query_embedding

    def compute_similarity(self, query: str) -> List[Tuple[str, float]]:
        """Compute similarity scores for all stories (non-streaming)."""
        with self._lock:
            results, _ = self._compute_all_similarities(query)
            return [(key, sim) for _, key, sim in results]

    def compute_similarity_streaming(self, query: str, delay_factor: float = 1.0):
        """Generator that yields similarity results one at a time."""
        with self._lock:
            all_similarities, query_embedding = self._compute_all_similarities(query)
            total_stories = len(all_similarities)

            # Project query to 2D
            query_position = self.project_query(query_embedding)
            qx, qy = query_position

            # Yield query position first
            yield {
                "type": "query_position",
                "position": {"x": qx, "y": qy},
            }

            # Group stories by similarity bands for radial positioning
            bands = self._group_into_bands(all_similarities)
            results = []

            # Yield results one by one
            for rank, (original_idx, key, similarity) in enumerate(all_similarities):
                radial_x, radial_y = self._compute_radial_position_banded(
                    key=key, bands=bands
                )

                result = {
                    "id": key,
                    "title": self.stories[key]["title"],
                    "content": self.stories[key]["content"][:200] + "...",
                    "similarity": similarity,
                    "originalPosition": {
                        "x": float(self.projections_2d[original_idx][0]),
                        "y": float(self.projections_2d[original_idx][1]),
                    },
                    "radialPosition": {"x": radial_x, "y": radial_y},
                    "rank": rank + 1,
                }
                result.update(self._story_metadata(key))
                results.append(result)

                yield {
                    "type": "update",
                    "story": result,
                    "progress": (rank + 1) / total_stories,
                    "processed": rank + 1,
                    "total": total_stories,
                }

            # Final complete result
            yield {
                "type": "complete",
                "results": results,
                "query_position": {"x": qx, "y": qy},
            }

    def _group_into_bands(self, sorted_similarities: list) -> Dict:
        """Group stories into similarity bands for radial layout."""
        band_definitions = [
            (0.9, 1.0, 0.08),   # 90%+   : innermost ring
            (0.8, 0.9, 0.18),   # 80-90% : second ring
            (0.7, 0.8, 0.28),   # 70-80% : third ring
            (0.6, 0.7, 0.38),   # 60-70% : fourth ring
            (0.5, 0.6, 0.48),   # 50-60% : fifth ring
            (0.4, 0.5, 0.58),   # 40-50% : sixth ring
            (0.3, 0.4, 0.68),   # 30-40% : seventh ring
            (0.2, 0.3, 0.78),   # 20-30% : eighth ring
            (0.1, 0.2, 0.88),   # 10-20% : ninth ring
            (0.0, 0.1, 0.96),   # 0-10%  : outermost ring
        ]

        bands = {i: [] for i in range(len(band_definitions))}
        story_band_map = {}

        for original_idx, key, similarity in sorted_similarities:
            for band_idx, (min_sim, max_sim, radius) in enumerate(band_definitions):
                if min_sim <= similarity < max_sim or (
                    band_idx == 0 and similarity >= max_sim
                ):
                    bands[band_idx].append((key, similarity))
                    story_band_map[key] = (band_idx, len(bands[band_idx]) - 1)
                    break

        return {
            "definitions": band_definitions,
            "bands": bands,
            "story_map": story_band_map,
        }

    def _compute_radial_position_banded(
        self, key: str, bands: Dict
    ) -> Tuple[float, float]:
        """Compute position in a circular band layout."""
        story_map = bands["story_map"]
        if key not in story_map:
            return (0.0, 0.0)

        band_idx, position_in_band = story_map[key]
        _, _, base_radius = bands["definitions"][band_idx]
        total_in_band = len(bands["bands"][band_idx])

        if total_in_band == 0:
            return (0.0, 0.0)

        band_offset = band_idx * 0.4

        if total_in_band == 1:
            angle = band_offset
        else:
            angle = (2 * np.pi * position_in_band / total_in_band) + band_offset

        radius_variation = 0.03 * np.sin(position_in_band * 2.5)
        radius = base_radius + radius_variation

        return (float(radius * np.cos(angle)), float(radius * np.sin(angle)))
