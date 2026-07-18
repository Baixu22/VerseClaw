# ClawX System Maturity Program

## Rules

1. Phase 椤哄簭鍥哄畾锛歱hase0 鈫?phase7銆?2. 姣忎釜浠诲姟蹇呴』缁戝畾瀹¤ Finding銆丱wner銆丷eviewer銆乀ests銆丄cceptance銆?3. 浠诲姟鍙湁鍦ㄦ墍鏈?Acceptance 閫氳繃涓旇瘉鎹凡鍐欏叆 manifest 鍚庢墠鑳芥爣璁?done銆?4. 闃舵鍙湁鎵€鏈変换鍔′负 done 鎵嶈兘鏍囪 done銆?5. blocked 蹇呴』璁板綍澶栭儴闃绘柇锛沚locked 涓嶇瓑浜?done銆?6. 浠讳綍鍙戝竷鍓嶅繀椤婚€氳繃 phase0, phase1, phase2, phase6, phase7, phase8 residual gate銆?7. 浠诲姟浜や粯鏍煎紡瑙?DELIVERY-FORMAT.md銆?
## Status values

### Task status

- todo
- in_progress
- blocked
- done

### Phase status (`STATUS.json.phaseStatus`)

- planned
- in_progress
- blocked
- done

Task status and phase status are separate enums. `phaseStatus=done` is allowed only when every task in that phase is `done`.


## Status files

STATUS.json 鍙繚瀛?phaseStatus銆乼ask status銆乤llTasksDone锛屼笉鍐欒В閲娿€?
## Execution

鎵ц椤哄簭銆亀orktree 骞惰杈圭晫銆佷覆琛屼緷璧栧拰棣栦釜鍚姩浠诲姟瑙?[EXECUTION-ORDER.md](./EXECUTION-ORDER.md)銆?

## True-close rules (mandatory)

1. A task may be marked `done` only when its harness (if any) passes on the **committed** tree, not only mid-collection.
2. Delivery `TESTS` must match the commands recorded in that task's full-validation evidence; silent gate downgrades are forbidden.
3. `INDEX.md` Status must match each phase `STATUS.json.phaseStatus` (run `pnpm maturity:sync-index` before seal).
4. After any `maturity:validate` rewrite of reports, run `pnpm maturity:seal` so delivery hashes stay consistent.


## Phase 8 extension

Phase 8 residual-closure starts only after phase7 is done. It governs Partial+Act-now residuals that escaped earlier risk-acceptance policy.

