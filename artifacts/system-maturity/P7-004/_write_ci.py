from pathlib import Path
content = """name: system-maturity-quarterly

on:
  workflow_dispatch:
  schedule:
    # 1st day of Jan/Apr/Jul/Oct 06:00 UTC
    - cron: '0 6 1 1,4,7,10 *'

jobs:
  quarterly:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6

      - name: Setup pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4

      - name: Setup Node.js
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6
        with:
          node-version: '24'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Sync INDEX from STATUS
        run: pnpm maturity:sync-index

      - name: Quarterly maturity audit
        run: pnpm maturity:quarterly

      - name: Seal evidence hashes
        run: pnpm maturity:seal
"""
Path('.github/workflows/system-maturity-quarterly.yml').write_text(content, encoding='utf-8', newline='\n')
print('ok', Path('.github/workflows/system-maturity-quarterly.yml').stat().st_size)

/* reseal-marker:cd87e3735 */
