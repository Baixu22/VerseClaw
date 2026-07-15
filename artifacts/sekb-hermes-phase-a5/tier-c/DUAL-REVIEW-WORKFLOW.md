# SEKB Hermes Tier C Dual-Person Workflow

## Roles
- Reviewer A / B: independent labelers
- Adjudicator: resolves disagreements by consensus re-label only
- Operator: runs campaign; never invents labels

## Steps
1. Operator export/protocol with stable --key
2. Reviewers fill worksheets offline
3. Operator merges worksheets
4. Report; adjudicate if needed
5. Closed loop: suggest -> human edit -> confirm_and_save

## Commands
```bash
node scripts/sekb-tier-c-campaign.mjs --expand 100
node scripts/sekb-tier-c-campaign.mjs
node scripts/sekb-tier-c-campaign.mjs --merge-worksheets
pnpm sekb:hermes:suggest
pnpm sekb:hermes:confirm -- --suggestion <file> --edits <edits.json>
```
Suggest never writes durable principles; only confirm_and_save does.
