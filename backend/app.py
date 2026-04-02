print("Booting Story Atlas backend...")

import os
import json
import time
import threading
from datetime import datetime
from flask import Flask, jsonify, request, Response, stream_with_context, send_from_directory, send_file
from flask_cors import CORS
from embeddings import EmbeddingsManager, build_cache_stem

# Serve frontend static files
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app = Flask(__name__, static_folder=frontend_path, static_url_path="")
CORS(app)

# Initialize embeddings manager
stories_path = os.path.join(os.path.dirname(__file__), "..", "stories")
covers_path = os.path.join(stories_path, "covers")
backend_path = os.path.dirname(__file__)
encoding_mode = os.getenv("EMBEDDING_ENCODING_MODE", "auto")
max_batch_size = int(os.getenv("EMBEDDING_MAX_BATCH_SIZE", "32"))
min_batch_size = int(os.getenv("EMBEDDING_MIN_BATCH_SIZE", "4"))
cuda_memory_safety_mb = int(os.getenv("CUDA_MEMORY_SAFETY_MB", "1536"))
benchmark_encoding = os.getenv("EMBEDDING_BENCHMARK", "0").lower() in ("1", "true", "yes", "on")
benchmark_sample_size = int(os.getenv("EMBEDDING_BENCHMARK_SAMPLE_SIZE", "8"))
embedding_provider = os.getenv("EMBEDDING_PROVIDER", "sentence_transformers").strip().lower()
embedding_model = os.getenv("EMBEDDING_MODEL", "").strip() or None
lm_studio_base_url = os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:1234/v1")
lm_studio_api_key = os.getenv("LM_STUDIO_API_KEY", "lm-studio")
query_instruction = os.getenv(
    "EMBEDDING_QUERY_INSTRUCTION",
    "Given a book search query, retrieve relevant passages that answer the query.",
)

default_model_name = (
    "text-embedding-qwen3-embedding-0.6b"
    if embedding_provider == "lm_studio"
    else "Qwen/Qwen3-Embedding-0.6B"
)
model_name = embedding_model or default_model_name

if embedding_provider == "sentence_transformers" and model_name == "Qwen/Qwen3-Embedding-0.6B":
    embeddings_cache_file = os.path.join(backend_path, "embeddings_cache_qwen3_embedding_0_6b.json")
    projection_cache_file = os.path.join(
        backend_path, "projection_cache_qwen3_embedding_0_6b.json"
    )
else:
    cache_stem = build_cache_stem(embedding_provider, model_name)
    embeddings_cache_file = os.path.join(backend_path, f"embeddings_cache_{cache_stem}.json")
    projection_cache_file = os.path.join(backend_path, f"projection_cache_{cache_stem}.json")

embeddings_manager = EmbeddingsManager(
    stories_folder=stories_path,
    cache_file=embeddings_cache_file,
    projection_cache_file=projection_cache_file,
    encoding_mode=encoding_mode,
    max_batch_size=max_batch_size,
    min_batch_size=min_batch_size,
    cuda_memory_safety_mb=cuda_memory_safety_mb,
    benchmark_encoding=benchmark_encoding,
    benchmark_sample_size=benchmark_sample_size,
    embedding_provider=embedding_provider,
    model_name=model_name,
    lm_studio_base_url=lm_studio_base_url,
    lm_studio_api_key=lm_studio_api_key,
    query_instruction=query_instruction,
)

_load_thread = None
_load_thread_lock = threading.Lock()


def ensure_story_loading_started():
    global _load_thread
    if embeddings_manager.is_loading or embeddings_manager.is_ready:
        return

    with _load_thread_lock:
        if _load_thread is not None and _load_thread.is_alive():
            return
        if embeddings_manager.is_loading or embeddings_manager.is_ready:
            return

        print(f"[{datetime.now().strftime('%H:%M:%S')}][BOOT] Starting story loading on demand...")
        _load_thread = threading.Thread(target=embeddings_manager.load_stories, daemon=True)
        _load_thread.start()


print(f"[{datetime.now().strftime('%H:%M:%S')}][BOOT] Boot complete. Stories will load on first request.")


@app.route("/")
def index():
    """Serve the frontend."""
    return send_from_directory(frontend_path, "index.html")


@app.route("/api/stories", methods=["GET"])
def get_stories():
    """Get all stories with positions."""
    ensure_story_loading_started()
    if not embeddings_manager.is_ready:
        return jsonify(
            {
                "stories": [],
                "count": 0,
                "loading": embeddings_manager.is_loading,
                "ready": embeddings_manager.is_ready,
                "stories_loaded": len(embeddings_manager.stories),
            }
        )
    stories = embeddings_manager.get_all_stories()
    return jsonify(
        {
            "stories": stories,
            "count": len(stories),
            "loading": embeddings_manager.is_loading,
            "ready": embeddings_manager.is_ready,
            "stories_loaded": len(embeddings_manager.stories),
        }
    )


@app.route("/api/covers/<path:filename>", methods=["GET"])
def get_cover(filename):
    """Serve cover images from stories/covers/."""
    return send_from_directory(covers_path, filename)


@app.route("/api/story/<path:story_id>/cover", methods=["GET"])
def get_story_cover(story_id):
    """Serve a story cover from either stories/covers/ or a local file path."""
    if story_id not in embeddings_manager.stories:
        return jsonify({"error": "Story not found"}), 404

    story = embeddings_manager.stories[story_id]
    cover = story.get("cover", "")
    if not cover:
        return jsonify({"error": "Cover not found"}), 404

    if os.path.isabs(cover) and os.path.exists(cover):
        return send_file(cover)

    if os.path.exists(cover):
        return send_file(cover)

    cover_name = os.path.basename(cover)
    local_cover = os.path.join(covers_path, cover_name)
    if os.path.exists(local_cover):
        return send_file(local_cover)

    fallback = os.path.join(stories_path, cover)
    if os.path.exists(fallback):
        return send_file(fallback)

    return jsonify({"error": "Cover not found"}), 404


@app.route("/api/search", methods=["POST"])
def search():
    """Search stories by query (non-streaming)."""
    ensure_story_loading_started()
    if not embeddings_manager.is_ready:
        return jsonify(
            {
                "error": "Stories are still loading",
                "loading": embeddings_manager.is_loading,
                "stories_loaded": len(embeddings_manager.stories),
            }
        ), 503
    data = request.get_json()
    query = data.get("query", "")

    if not query:
        return jsonify({"error": "Query is required"}), 400

    results = embeddings_manager.compute_similarity(query)

    formatted_results = []
    for idx, (story_id, similarity) in enumerate(results):
        story = embeddings_manager.stories[story_id]
        result = {
            "id": story_id,
            "title": story["title"],
            "content": story["content"][:200] + "...",
            "similarity": similarity,
            "position": embeddings_manager._get_story_position(story_id),
            "rank": idx + 1,
        }
        result.update(embeddings_manager._story_metadata(story_id))
        formatted_results.append(result)

    return jsonify({"query": query, "results": formatted_results})


@app.route("/api/search/stream", methods=["GET"])
def search_stream():
    """Stream search results for wave effect."""
    ensure_story_loading_started()
    if not embeddings_manager.is_ready:
        return jsonify(
            {
                "error": "Stories are still loading",
                "loading": embeddings_manager.is_loading,
                "stories_loaded": len(embeddings_manager.stories),
            }
        ), 503
    query = request.args.get("query", "")
    speed = request.args.get("speed", "normal")

    if not query:
        return jsonify({"error": "Query is required"}), 400

    delays = {"slow": 0.15, "normal": 0.08, "fast": 0.03}
    delay = delays.get(speed, 0.08)

    def generate():
        for update in embeddings_manager.compute_similarity_streaming(query):
            time.sleep(delay)
            yield f"data: {json.dumps(update)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/story/<story_id>", methods=["GET"])
def get_story(story_id):
    """Get a specific story."""
    ensure_story_loading_started()
    if not embeddings_manager.is_ready:
        return jsonify(
            {
                "error": "Stories are still loading",
                "loading": embeddings_manager.is_loading,
                "stories_loaded": len(embeddings_manager.stories),
            }
        ), 503
    if story_id not in embeddings_manager.stories:
        return jsonify({"error": "Story not found"}), 404

    story = embeddings_manager.stories[story_id]
    result = {
        "id": story_id,
        "title": story["title"],
        "content": story["content"],
        "filename": story["filename"],
        "position": embeddings_manager._get_story_position(story_id),
    }
    result.update(embeddings_manager._story_metadata(story_id))
    return jsonify(result)


@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint."""
    ensure_story_loading_started()
    return jsonify(
        {
            "status": "healthy",
            "stories_loaded": len(embeddings_manager.stories),
            "model": embeddings_manager.model_name,
            "has_projections": embeddings_manager.projections_2d is not None,
            "loading": embeddings_manager.is_loading,
            "ready": embeddings_manager.is_ready,
            "error": embeddings_manager.load_error,
        }
    )


if __name__ == "__main__":
    import socket

    port = 5000
    while port < 5100:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("localhost", port)) != 0:
                break
        print(f"[{datetime.now().strftime('%H:%M:%S')}][BOOT] Port {port} in use, trying {port + 1}...")
        port += 1

    print(f"[{datetime.now().strftime('%H:%M:%S')}][BOOT] Starting server on port {port}")
    app.run(debug=True, port=port, threaded=True, use_reloader=False)
