# Quantitative Scorecard

Status: internal_continuation_ready_not_production_ready.

## Current Score

| Dimension | Weight | Score | Status |
| --- | ---: | ---: | --- |
| False-block safety | 30 | 30 | pass |
| Trigger correctness | 20 | 20 | pass |
| Owner/boundary integrity | 15 | 15 | pass |
| Rollback/default-off proof | 15 | 15 | pass |
| Real-data feedback quality | 15 | 8 | warning |
| Sanitization/report hygiene | 5 | 5 | pass |
| Aggregate | 100 | 93 | continue_with_separate_accepted_spec |

## Real-Data Feedback

Sanitized local transcript scan result:

```json
{
  "transcriptsScanned": 1,
  "recordsParsed": 2,
  "parseErrors": 0,
  "toolInvocationCount": 0,
  "mutationCapableToolInvocationCount": 0,
  "unknownToolInvocationCount": 0,
  "candidateMetadataCount": 0,
  "wouldBlockCount": 0,
  "wouldAllowCount": 0,
  "parseSuccessRate": 1,
  "mutationCapableToolRate": 0,
  "shadowBlockRate": 0,
  "feedbackStatus": "real_data_observed"
}
```

No raw prompt, tool args/results, stdout/stderr, path, secret, env, or workspace content is retained in the scorecard.

## Decision

The line may continue only through a separate accepted spec. The current score does not approve production/default-on behavior.
