# Layers

Layer specs describe subsystem conventions. Agents should read them when touching matching paths.

Suggested frontmatter:

```yaml
---
id: example-layer
title: Example Layer
type: layer-spec
pathPatterns:
  - src/example/**
---
```

Include ownership boundaries, local APIs, expected tests, naming conventions, and common traps for the subsystem.

