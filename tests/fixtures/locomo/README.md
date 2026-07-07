# LoCoMo Benchmark Fixture

## Source

- **Dataset**: LoCoMo (Long-term Conversational Memory)
- **Repository**: https://github.com/snap-research/locomo
- **Data file**: `data/locomo10.json`
- **Paper**: [Evaluating Very Long-Term Conversational Memory of LLM Agents](http://arxiv.org/abs/2402.17753)
- **License**: CC BY 4.0

## Structure

```
tests/fixtures/locomo/
├── README.md           # This file
├── conversations.json  # Preprocessed conversations (extracted from LoCoMo)
└── questions.json      # Preprocessed QA pairs (extracted from LoCoMo)
```

## Format

### conversations.json

Array of conversation objects:

```json
[
  {
    "conversationId": "conv_0",
    "speakers": ["Angela", "Brian"],
    "turns": [
      { "turnId": 0, "speaker": "Angela", "text": "Hi Brian!" },
      { "turnId": 1, "speaker": "Brian", "text": "Hey Angela, how are you?" }
    ]
  }
]
```

### questions.json

Array of question objects:

```json
[
  {
    "questionId": "q_0",
    "conversationId": "conv_0",
    "question": "What is Angela's job?",
    "answer": "She manages a gift shop in Chapel Hill.",
    "category": "single_hop"
  }
]
```

Categories: `single_hop`, `multi_hop`, `open_ended`, `adversarial`

## Regenerating from source

Run the download script to fetch and preprocess the real LoCoMo dataset:

```bash
node scripts/download-locomo.mjs
```

This downloads `locomo10.json` from the GitHub repository, extracts conversations and QA pairs, and writes them to `conversations.json` and `questions.json` in this directory.

## Current fixture

The current fixture is a **synthetic sample** (2 conversations, 20 turns each, 20 questions) that mirrors the LoCoMo format. It allows benchmark tests to run without network access. To use the real 10-conversation dataset, run the download script above.

## Citation

```bibtex
@article{maharana2024locomo,
  title={Evaluating Very Long-Term Conversational Memory of LLM Agents},
  author={Maharana, Adyasha and Lee, Dong-Ho and Tulyakov, Sergey and Bansal, Mohit and Barbieri, Francesco and Fang, Yuwei},
  journal={arXiv preprint arXiv:2402.17753},
  year={2024}
}
```
