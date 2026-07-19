"""T5.5 vt.search() — offline TF-IDF search over doc + mem graphs.

Tech selection (D30): the host machine is offline (PyPI blocked, no OpenAI
embedding API), so we cannot install `sentence-transformers` nor call any
embedding API. This module implements a 0-dependency TF-IDF + cosine
similarity search using stdlib only:

- Tokenizer: regex-based; CJK chars split per-grapheme, ASCII by word boundary.
- IDF: log((N + 1) / (df + 1)) + 1 (smoothed, never zero)
- TF: term frequency in document / total tokens
- Index: built lazily on first query; cached on the store; invalidated when
  mem writes change the graph (write() bumps an internal version counter).
- Cosine similarity over the resulting sparse vectors.
- Returns top_k results sorted by score desc, with format:
  [{"id": str, "score": float, "snippet": str}]

Caveats vs true embedding search (declared in D30):
- Lexical match only (no semantic similarity across synonyms)
- Adequate for ASCII/canonical ids and Chinese keyword overlap
- Pluggable: future embedding-backed implementation can replace this module's
  `SearchIndex` class without changing the `UnifiedStore.search` API.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field


# Tokenizer: ASCII words OR single CJK chars. \w covers [a-zA-Z0-9_] which is
# sufficient for ids like `auth.overview` (will produce ['auth', 'overview']).
_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]")


def tokenize(text: str) -> list[str]:
    """Split text into lowercase ASCII words + single CJK characters."""
    if not text:
        return []
    return [t.lower() if t.isascii() else t for t in _TOKEN_RE.findall(text)]


@dataclass
class _DocVector:
    """Sparse TF-IDF vector for one node."""
    id: str
    snippet: str
    tokens: list[str] = field(default_factory=list)
    tf: dict[str, int] = field(default_factory=dict)  # term -> count
    norm_sq: float = 0.0                              # ||v||^2 (weighted)


class SearchIndex:
    """TF-IDF in-memory index over a set of graphs.

    Usage:
        idx = SearchIndex()
        idx.build([graph1, graph2])
        results = idx.query("auth token ttl", top_k=5)
    """

    def __init__(self) -> None:
        self._docs: list[_DocVector] = []
        self._df: dict[str, int] = {}  # term -> document frequency
        self._idf: dict[str, float] = {}
        self._built = False

    def build(self, graphs: list) -> None:
        """Build the index from a list of SIRGraph instances (doc + mem)."""
        self._docs.clear()
        self._df.clear()
        self._idf.clear()
        self._built = False

        for g in graphs:
            if g is None:
                continue
            for node_id, node in g.nodes.items():
                # Document text = id + all facet contents concatenated
                text_parts = [node_id]
                for _type, content in node.parts:
                    if content:
                        text_parts.append(content)
                text = " ".join(text_parts)
                tokens = tokenize(text)
                if not tokens:
                    continue
                tf: dict[str, int] = {}
                for tok in tokens:
                    tf[tok] = tf.get(tok, 0) + 1
                # snippet: first ~80 chars of first facet content
                snippet = ""
                for _t, c in node.parts:
                    if c:
                        snippet = c[:80]
                        break
                self._docs.append(_DocVector(id=node_id, snippet=snippet,
                                              tokens=tokens, tf=tf))
                # update df
                for term in tf.keys():
                    self._df[term] = self._df.get(term, 0) + 1

        # Compute IDF (smoothed)
        n = len(self._docs)
        for term, df in self._df.items():
            self._idf[term] = math.log((n + 1) / (df + 1)) + 1.0

        # Precompute each doc's weighted norm^2
        for doc in self._docs:
            norm_sq = 0.0
            for term, count in doc.tf.items():
                weight = count * self._idf.get(term, 0.0)
                norm_sq += weight * weight
            doc.norm_sq = norm_sq

        self._built = True

    def query(self, query: str, top_k: int = 10) -> list[dict]:
        """Return top_k matches as [{'id', 'score', 'snippet'}] sorted desc."""
        if not self._built or top_k < 1:
            return []
        q_tokens = tokenize(query)
        if not q_tokens:
            return []
        # Build query TF
        q_tf: dict[str, int] = {}
        for t in q_tokens:
            q_tf[t] = q_tf.get(t, 0) + 1
        # Weighted query vector + norm
        q_weights: dict[str, float] = {}
        q_norm_sq = 0.0
        for term, count in q_tf.items():
            w = count * self._idf.get(term, 0.0)
            if w != 0.0:
                q_weights[term] = w
                q_norm_sq += w * w
        if q_norm_sq == 0.0:
            return []
        q_norm = math.sqrt(q_norm_sq)

        # Score each doc by cosine similarity
        scored: list[tuple[float, _DocVector]] = []
        for doc in self._docs:
            if doc.norm_sq == 0.0:
                continue
            # dot product over shared terms (query is smaller, iterate it)
            dot = 0.0
            for term, q_w in q_weights.items():
                tf_count = doc.tf.get(term, 0)
                if tf_count == 0:
                    continue
                d_w = tf_count * self._idf.get(term, 0.0)
                dot += q_w * d_w
            if dot == 0.0:
                continue
            d_norm = math.sqrt(doc.norm_sq)
            score = dot / (q_norm * d_norm)
            scored.append((score, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"id": doc.id, "score": round(score, 4), "snippet": doc.snippet}
                for score, doc in scored[:top_k]]
