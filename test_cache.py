"""Exercise actual loading with a tiny offline encoder; no model downloads."""
import csv
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
with patch.dict(sys.modules, {'umap': None}):
    from backend import embeddings as module


class CacheTests(unittest.TestCase):
    def test_edit_replace_and_reorder_reuse_only_unchanged_embeddings(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            stories = root / 'stories'
            stories.mkdir()
            calls = []
            def encode(texts):
                calls.extend(texts)
                return np.array([list(hashlib.sha256(t.encode()).digest()[:4]) for t in texts], dtype=float)
            class Reducer:
                def fit_transform(self, matrix): return matrix[:, :2]
                def transform(self, matrix): return matrix[:, :2]
            def load(rows):
                with (stories / 'library.csv').open('w', newline='', encoding='utf-8') as stream:
                    writer = csv.DictWriter(stream, fieldnames=['id', 'title', 'summary'])
                    writer.writeheader()
                    writer.writerows(rows)
                manager = module.EmbeddingsManager(str(stories), str(root / 'embeddings.json'),
                                                    str(root / 'projection.json'))
                with patch.object(manager, 'load_model'), patch.object(manager, '_encode_texts', encode), \
                     patch.object(manager, '_create_reducer', return_value=Reducer()), \
                     patch.object(manager, '_emit_status'):
                    manager.load_stories()
                return manager
            rows = [{'id': 'library-1', 'title': 'One', 'summary': 'First'},
                    {'id': 'library-2', 'title': 'Two', 'summary': 'Second'}]
            manager = load(rows)
            self.assertEqual(len(calls), 2)
            before = manager.dataset_fingerprint
            self.assertEqual(manager.story_keys, ['library-1', 'library-2'])
            load(rows)
            self.assertEqual(len(calls), 2)
            rows[0]['summary'] = 'Changed'
            manager = load(rows)
            self.assertEqual(len(calls), 3)
            self.assertNotEqual(manager.dataset_fingerprint, before)
            self.assertEqual(json.loads((root / 'projection.json').read_text())['fingerprint'], manager.dataset_fingerprint)
            rows[0]['id'] = 'replacement'
            manager = load(list(reversed(rows)))
            self.assertEqual(len(calls), 3)
            self.assertEqual(manager.story_keys, ['library-2', 'replacement'])
            self.assertTrue(np.isfinite(manager.projections_2d).all())
            np.testing.assert_allclose(manager.project_query(manager.embeddings_matrix[0]), manager.projections_2d[0])
            self.assertEqual(load(rows[:1]).projections_2d.tolist(), [[0.0, 0.0]])
            self.assertEqual(load([]).get_all_stories(), [])


if __name__ == '__main__':
    unittest.main()
