
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="Verse Claw Logo" />
</p>

<h1 align="center">Verse Claw</h1>

<p align="center">
  <strong>OpenClaw AIエージェントのためのデスクトップインターフェース</strong>
</p>

<p align="center">
  <a href="#機能">機能</a> •
  <a href="#なぜclawxなのか">なぜVerse Clawなのか</a> •
  <a href="#はじめに">はじめに</a> •
  <a href="#アーキテクチャ">アーキテクチャ</a> •
  <a href="#開発">開発</a> •
  <a href="#コントリビューション">コントリビューション</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/Verse Claw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語 | <a href="README.ru-RU.md">Русский</a>
</p>

---

## Capability Claim Boundary

Product capability statements must be checked against the canonical matrix in `shared/capability-claims.ts` and the generated status table in `artifacts/capability-claims/status-table.json` before being described as implemented, productized, stable, or end-to-end verified. The local gate `node scripts/check-capability-claims.mjs <files>` warns when high-confidence claims lack matrix, E2E, or real-runtime evidence.

## Windows x64 Controlled Preview の範囲

現在の first-product 検証対象は **Verse Claw Windows x64 - DCS Coding Controlled Preview** です。内部利用、単一 workspace、明示的な `opt-in` に限定し、Provider/Model 検証、制御された読み書きとテスト、undo、runtime acknowledgement、再起動後の復旧、kill/rollback、秘匿化 support bundle を対象にします。

書き込み後の自動検証も明示的な opt-in で、既定では無効です。有効化すると、Verse Claw は有界なプロジェクトテストコマンドを 1 つ検出し、既存の effective `exec` の policy、approval、sandbox、timeout 経路で実行します。成功、失敗、skip 理由、有界な出力末尾は会話に表示され、検証失敗によって成功済みの書き込みが rollback されることはありません。

フォアグラウンドコマンドの進捗には直近の出力を保持し、キャンセルまたは終了後は更新を止めます。ツールの成功・失敗後に届く進捗も返しません。引数やポリシーの準備中にキャンセルされたツールは起動せず、キャンセル後の遅延成功も返しません。非同期のポリシー確認と結果の観測中もキャンセルを尊重します。リモート `exec` は stdout、stderr、エラーテキスト、タイムアウト状態を保持し、直接実行と prepare 経由のどちらも元メッセージのルーティング情報を渡します。キャンセルされた `process` 呼び出しは、その後の入力書き込み、stdin のクローズ、出力の消費に進まず、poll 結果は実際の `exitCode` と `exitSignal` を保持します。重大なツールループの終了時はモデルのフォールバックも停止します。画像・音声・リソースの内容変化を進捗として認識し、process poll の待機時間は進捗に数えず、履歴ウィンドウは run ごとに設定された終了しきい値へ届く範囲まで拡張します。低く設定したしきい値でもループ警告を出し、ポリシーによる引数の書き換えやセッションのエイリアス統合後も、ループ検出に必要な履歴を保持します。ポリシー、承認、アダプタ経路のキャンセルはツール遮断に変換せず、キャンセルとして再送出します。`node.invoke` のローカル待機はキャンセル時に遅延成功を返しません。`process remove` はフォアグラウンドセッションを終了できず、`send-keys` は書き込み後もキャンセルを確認し、最初の poll は既に終了した子プロセスを観測します。ピンポン警告には無進捗の証拠が必要で、エイリアス統合は同じ活動周期の警告待機時間を保持して新しい進捗によるリセットを維持し、結果オブザーバの例外で成功結果を失敗に変えません。

未ラップのツール、クライアント委譲、承認登録、各ポリシー段階でもキャンセルを尊重します。キャンセル理由は遅れて届くツールの成功・失敗より優先され、キャンセルされた委譲は引き継ぎ待ちの記録を破棄します。プロセス入力のコールバック待機もキャンセルできますが、書き込み済みのバイトを取り消したり、バックグラウンドプロセスを終了したりはしません。子プロセスの終了後、poll は stdout と stderr の読み取り完了を待ってセッションを終了し、実行の所有者が記録した終端状態を保持します。削除済みプロセスは遅れて届く終了コールバックでも再表示されません。同じ run 内で記録済みのツール結果が重複して届いても、計数は一度だけです。ピンポン警告には少なくとも四つの完了済み交互呼び出し（`ABAB`）が必要で、両側それぞれで安定した結果の繰り返しを確認します。証拠と未検証項目は[第4バッチのローカル検証記録](docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r4-20260913.md)を参照してください。

ツールの準備やポリシーフックが戻る前でも、キャンセルでローカル待機を終了できます。プラグイン内部で既に始まった処理は停止しません。入力の確認中にプロセスが終了した場合、応答は実行所有者が記録した終了状態と出力を保持します。セッションのエイリアス統合では同じツール呼び出しを一度だけ数え、`process poll` の待機時間だけを変えても無進捗の検出はリセットしません。[第5バッチの検証記録](docs/dev/context-moat/reviews/tool-runtime-reliability-relay-r5-20260913.md)を参照してください。

DCS を有効にした coding turn では、knowledge、recent actions、tool registry の実際の provider-visible prompt 増加量を、既存の共有 turn-injection ledger に個別記録します。固定予算は拡大せず、有効な DCS projection には既存の有界容量を確保し、truncate と drop は明示的な会計証拠として残します。

Runtime Memory 注入、SEKB 自動 writeback、Browser の無監督または private-network 利用、C6/C7 自動切替、Coding WAL、本番 repository の自動 merge、複数 Forge/DAG 拡張は対象外です。現時点の証拠は engineering と実プロセステストであり、human canary と release approval は未完了です。コンポーネントごとの唯一の分類は [`docs/clawx-product-semantics.md`](docs/clawx-product-semantics.md#windows-x64-controlled-preview) を参照してください。

## 概要

**Verse Claw**は、強力なAIエージェントと日常のユーザーとの間のギャップを埋めます。[OpenClaw](https://github.com/OpenClaw)をベースに構築されており、コマンドラインによるAIオーケストレーションを、アクセスしやすく美しいデスクトップ体験に変換します。ターミナルは不要です。

ワークフローの自動化、AI搭載チャネルの管理、インテリジェントなタスクのスケジューリングなど、Verse ClawはAIエージェントを効果的に活用するために必要なインターフェースを提供します。

制御された自律実行が必要な複雑な作業向けに、Agents オーケストレーションパネルには有界な **タスクループ** があります。ロール別サブ Agent を編成し、証拠を自己チェックし、範囲を絞った修復を行い、ライブ状態を表示し、信頼度や権限が不足する場合は `blocked` として安定的に停止します。

同じ Agents -> Roles & Orchestration 画面には、ClawGraph YAML を書かずに一般的なワークフローを始められる **Lightweight Subagent Runner** もあります。Explorer、Reviewer、Tester、Compare 3 approaches から選び、目標を入力すると、既存の Gateway 権限経路で明示的なロール worker を起動し、Verse Claw がライブ worker 状態、要約、失敗理由、Observability trace リンクを表示します。
role-first のオーケストレーション実行では、読み取り専用の統合結果も表示し、検証判断、証拠数、trace 数、可視化された失敗理由をそのまま確認できます。

長い会話、チェックポイント、証拠レビュー、明示的な scheduled tick をまたいで継続する目標向けに、Agents パネルには **Mission Control** もあります。`mission.run` で Mission を開始または再開し、Mission 状態を永続化し、ResumeCheckpoint、Task Ledger、メモリ、trace 証拠から有界なコンテキストを再構築し、各 tick で内部 `task_loop` を実行してから、reviewer が続行、修復、休眠、ユーザー確認、完了、またはブロックを判断します。
Mission と Task loop は内部の Engineering Control Signals（`evidence_gap`、`validation_missing`、`scope_drift`、`unverified_claim`、`replan_required` など）も運びます。これらは checkpoint、lifecycle event、Task Ledger metadata に残り、trace だけ、または内部 loop の complete だけを長期目標の完了事実として扱わないためのガードになります。

多くの worker ターンにまたがる長期タスクを安定して分解するために、**ClawGraph Runtime** は workspace YAML ワークフロー、DAG 実行、ステートレスなロール worker handoff、監査チェック、ユーザーレビューを提供し、ワークフロー全体を 1 つの肥大化した chat transcript に詰め込まないようにします。

Verse Clawはベストプラクティスのモデルプロバイダーが事前設定されており、Windowsおよび多言語設定をネイティブにサポートしています。もちろん、**設定 → 開発者 → 開発者モード**から高度な設定を微調整することもできます。

<p align="center"><strong style="font-size:1.1em; text-decoration: underline;">完全なエンタープライズ版、専用のサービスサポート、または御社のビジネスシナリオに合わせた導入支援が必要な場合は、<a href="mailto:public@valuecell.ai">public@valuecell.ai</a> までお問い合わせください。</strong></p>

---
## スクリーンショット

<p align="center">
  <img src="resources/screenshot/jp/chat.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/cron.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/skills.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/channels.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/models.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/jp/settings.png" style="width: 100%; height: auto;">
</p>

---

## なぜVerse Clawなのか

AIエージェントの構築にコマンドラインの習得は不要であるべきです。Verse Clawはシンプルな哲学のもとに設計されました：**強力な技術には、あなたの時間を尊重するインターフェースがふさわしい。**

| 課題 | Verse Clawのソリューション |
|------|----------------------|
| 複雑なCLIセットアップ | ワンクリックインストールとガイド付きセットアップウィザード |
| 設定ファイル | リアルタイムバリデーション付きのビジュアル設定 |
| プロセス管理 | ゲートウェイライフサイクルの自動管理 |
| アプリ更新 | 組み込みの更新確認や上流更新通知はありません |
| 複数のAIプロバイダー | 統合プロバイダー設定パネル |
| スキル/プラグインのインストール | 組み込みのスキルマーケットプレイスと管理機能 |

### OpenClaw内蔵

Verse Clawは公式の**OpenClaw**コアを直接ベースに構築されています。別途インストールを必要とせず、アプリケーション内にランタイムを組み込むことで、シームレスな「バッテリー同梱」体験を提供します。開発ビルドでは編集可能な `openclaw_runtime` ツリーを既定で優先し、公開 npm パッケージへ戻したい場合は `VERSE_CLAW_OPENCLAW_RUNTIME=npm` を指定できます。

私たちはアップストリームのOpenClawプロジェクトとの厳密な整合性を維持することにコミットしており、公式リリースが提供する最新の機能、安定性の改善、エコシステムの互換性に常にアクセスできることを保証します。

開発者モードを有効にすると、サイドバー下部の `...` メニューからネイティブの Dreams ページを開き、Verse Claw 内で OpenClaw の記憶レビュー、夢日記、基本メンテナンス操作を扱えます。詳細な診断が必要な場合は、そのページから完全版の OpenClaw Dreams UI も開けます。

---

## 機能

### 🎯 ゼロ設定バリア
インストールから最初のAIインタラクションまで、すべてのセットアップを直感的なグラフィカルインターフェースで完了できます。ターミナルコマンド不要、YAMLファイル不要、環境変数の探索も不要です。

### 💬 インテリジェントチャットインターフェース
モダンなチャット体験を通じてAIエージェントとコミュニケーションできます。複数の会話コンテキスト、メッセージ履歴、Markdownによるリッチコンテンツレンダリング（GitHub 風テーブルや KaTeX による LaTeX 数式 `$インライン$`、`$$ブロック$$`、`\(インライン\)`、`\[ブロック\]` を含む）、計画・選択肢リスト・質問フロー・設定向けの構造化 Tool UI カードに加え、マルチエージェント構成ではメイン入力欄の `@agent` から対象エージェントへ直接ルーティングできます。
推論強度はランタイムポリシーとしても使われます。単一の強度コントロール（`auto`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`）は provider/model のダウングレード前にリクエストされた推論レベルを取得し、連動する実行時強度を導出します。minimal/low は prompt、Skill、tool result の注入密度を下げて低コストで簡潔なターンにし、medium/auto は baseline を維持し、high/xhigh はフル prompt を維持して明示的な `/loop`、ClawGraph、role/subagent、multi-model workflow を提案できます。provider の実際の effort マッピングは wire payload に保持されます（例：DeepSeek V4 は medium/xhigh を high にエイリアス）。権限やツール authority は変更せず、CLI-backed harness は `prompt-only` と正直に報告します。
左サイドバーには Workgroups ビューがあり、workspace 単位のタスクグループで会話を整理し、実行中・待機中・要対応などの集約状態を表示し、未分類の会話も残したまま、新しい workspace スコープの会話に現在のワークグループを継承させます。
固定ナビゲーションは **新しいタスク**、**受信トレイ**、**スケジュール済み**、**ナレッジ** に限定されています。受信トレイは一般の権限申請、Remote Tasks、承認待ち Browser Tasks をまとめ、実際のリスク、証拠、履歴、判断操作を表示します。Browser、Review、Task Ledger、ClawGraph は最下部の `...` メニューから引き続き利用できます。
チャットの作業モードはユーザー向けコントロールとして廃止されました。コンポーザーは毎ターンの knowledge scope、選択済み knowledge refs、タスクノード context、任意の毎ターン reasoning/intensity override を送信し、エージェントレベルの推論強度が永続デフォルトとして残ります。Main 所有の Work Provider は軽量 Office/Search 能力（レポート、表計算、スライド、PDF、調査、Webサイト、デザイン、日常業務）を引き続き提供し、内蔵ライブラリ、任意パッケージ、外部サービス、Custom HTTP、外部バイナリ、runtime skill、MCP server、OpenClaw plugin を同じ source model で扱えます。Search は provider を明示設定するまで `missingConfig` のままで、重い変換、crawler、OCR、dataframe runtime は任意のインターフェースです。これらのコントロールは workspace permission を自動変更せず、OpenClaw runtime のツールポリシーも上書きしません。
OfficeCLI も 設定 -> スキル -> 機能プラグイン から管理できます。Verse Claw はバイナリを検出し、インストールログをストリーミングし、Codeg 互換の `/officecli-*` スキルを同期し、`officecli watch` で `.docx`、`.xlsx`、`.pptx` をライブプレビューします。
コンポーザーから挿入した Skill は `/skill-name` 形式のチップとして表示され、チップをクリックすると右側のプレビュー側欄でその Skill の `SKILL.md` を開けます。
コンポーザーで `/` を入力すると、Context Palette が開き、Wiki 検索、読み取り専用ナレッジ範囲の変更、レビュー、CI 修復、テスト作成、diff 説明、Task Ledger、Mission Control、圧縮、セッション fork のクイックアクションを使えます。いずれも既存の Chat / Session フローを使います。セッションライフサイクルコマンド（`/new`、`/resume <キーワード>`、`/rename <名前>`、`/archive`、`/delete`、`/clear`、`/copy`）はサイドバーと同じ store/host 経路を使用します：`/new` で新しいチャットを開始、`/resume` でキーワードに一致するセッションに切替、`/rename` で現在のセッション名を変更、`/archive` と `/delete` でアーカイブまたは完全削除、`/clear` でローカルメッセージ表示をリセット、`/copy` でセッション記録を markdown としてコピーします。
`@agent` で別のエージェントを選ぶと、Verse Claw はデフォルトエージェントを経由せず、そのエージェント自身の会話コンテキストへ直接切り替えます。各エージェントのワークスペースは既定で分離されていますが、より強い実行時分離は OpenClaw の sandbox 設定に依存します。
Verse Claw は既定で軽量な `policy-light` サンドボックス層を使い、Main プロセスの権限ゲート、ワークスペースルート検査、Gateway RPC 承認、OpenClaw exec approval を組み合わせて制御します。Docker と SSH は明示的に選択する `strong` provider として残り、起動要件ではありません。
コマンドのリスク判定は前方一致ではなくサブコマンド単位で行うため、先頭のグローバルフラグでコマンドの実体を隠すことはできません。`git` では、任意コード実行につながるフラグ（`core.pager`/`core.editor`/`alias.*` を設定する `-c`、`--config-env`）、helper バイナリの探索先を差し替えるフラグ（`--exec-path`）、操作を別リポジトリへ移すフラグ（`-C`、`--git-dir`、`--work-tree`、`--namespace`）は、後続のサブコマンドが何であっても高リスクとして扱われます。グローバルフラグによって破壊的操作やネットワーク操作が通常の write に格下げされることもありません。
通常の編集が自動承認されるワークスペース内であっても、Git リポジトリのメタデータへの書き込みは承認付きのままです。そこに書かれた hook や config は次の Git 実行時に動作するためで、ネストしたリポジトリ、submodule、linked worktree が使う `.git` ポインタファイルも対象になります（`.gitignore`、`.gitattributes`、`.github/` は通常のファイルのままです）。破壊的な Git 操作の承認プロンプトは一般的な警告ではなく判定根拠を示します。push の対象リモートと branch、その branch が共有 branch かどうか、branch 未指定時に適用される refspec の範囲、reset が作業ツリーの変更を破棄するのか branch ポインタを移動するだけなのか、を提示します。
Docker サンドボックスが Windows ホスト上で動作し、デーモンが WSL2（または `DOCKER_HOST` 経由の他の Linux デーモン）にある場合、バインドソースは自動的に WSL2 マウント名前空間へ変換されます（`C:\...\workspace` → `/mnt/c/.../workspace`、`\wsl$\<distro>\...` → POSIX）。`invalid volume specification` でボリュームマウントが失敗しなくなり、ローカルの Windows named-pipe デーモンと macOS/Linux ホストには影響しません。
Settings、Doctor、diagnostics は同じ effective sandbox policy を表示し、要求/有効 provider、runtime level、exec/network policy、Docker の利用可否、縮退理由を確認できます。
Settings → System & Runtime には Project Rules Center もあり、現在の workspace の `AGENTS.md` を確認し、`.clawx/rules/*.md` を一覧表示し、決定的な検証 warning を示し、欠落時には新しいルール真実源を作らずに保守的な `AGENTS.md` テンプレートを作成できます。
各 Agent は `provider/model` の実行時設定を個別に上書きできます。上書きしていない Agent は引き続きグローバルの既定モデルを継承します。
各永続 Agent は Agents、Chat、オーケストレーション、Observability で同じ有効な identity projection を使用します。`main` は既定で Verse ブランドのアバターを使用し、その他の Agent は決定的なローカル DiceBear アバターを使用します。エディターは許可済み preset と生成 SVG を `.clawx/avatar/` に保存し、DiceBear の公開 API は呼び出しません。一時的な Role は独立した人物ではなく、所有 Agent のアバターに重ねるバッジとして表示されます。
コンポーザーのコンテキスト状態には、確認付きの「現在のセッションを圧縮」操作が追加され、トークン圧力、非表示メッセージ数、前回の圧縮時刻、圧縮品質を確認できます。長期タスク状態は巨大な transcript に依存せず、Task Ledger / Context Pack に保持します。圧縮は高密度 recovery artifact も保存し、Handoff は transcript 証拠へ戻る前にそれを優先して使います。Runtime はまず手動または明示 opt-in の圧縮で段階的な tiered compression plan を使い、自動圧縮は品質ゲートで安定が確認されるまで telemetry を記録するだけです。
コンポーザーは長い会話の checkpoint 回復状態も表示します。キュー済みフォローアップ、最新の介入/checkpoint、回復警告、そしてセッションがアイドルのときに永続化されたキューを今送信する操作を確認でき、これらのキューは Gateway 再起動後も復元できます。
Gateway の再起動で実行中の main Agent turn が中断された場合、再起動回復は未完了の assistant/tool transcript の末尾を再開し、完了済み・エラー・承認待ちの turn は重複実行から保護します。
実行中は Queue、Guide、Interrupt を別々の操作として維持し、主操作は送信から checkpoint を保存する一時停止へ切り替わり、セッションを開き直しても再開可能な状態を表示します。
Chat のロールバック計画はレビュー優先の復旧パネルとして、安全/確認/危険の件数、チェックポイント、キュー、コンテキスト、ターミナル、Git、Task Ledger、メモリ信号を表示します。破壊的操作は承認付きツールへ誘導し、メモリ事実は Knowledge draft または proposal にします。

Agents オーケストレーションパネルには、制御された自律作業向けの有界な **タスクループ** 操作もあります。既存の Gateway RPC 経路で `task_loop.run` を開始し、ロール別サブ Agent の編成、自己チェック、範囲を絞った修復ラウンドを実行し、画面にはリアルタイムのフェーズ、反復回数、reviewer 判定、最終状態、trace 証拠を表示します。renderer から Gateway への直接接続は追加しません。

同じパネルには、ClawGraph YAML を不要にするプリセット型の並列フローとして **Lightweight Subagent Runner** もあります。Explorer は planner と architect worker で解決案を探し、Reviewer は現在の staged / unstaged Git diff をレビューし、Tester は tester と reviewer にテスト不足を確認させ、Compare 3 approaches はラベル付きの architect worker を 3 つ起動します。Runner はコードを自動マージせず、完了した実行を Observability trace にリンクします。
直接ロールオーケストレーション結果にもこの bounded な統合ビューが含まれ、検証失敗や証拠が要約の裏に隠れません。
Chat のオーケストレーション進捗はレスポンシブな Wave タイムラインで表示されます。安定した task node / role instance ID により、同じ Role の複数実行も計画、ライブ lifecycle、最終 result bundle まで別々に維持され、狭い画面ではページ全体の横スクロールを発生させず縦型タイムラインに切り替わります。

同じパネルには、より長い目標向けの **Mission Control** もあります。`mission.run` で Mission を開始または再開し、Mission 状態を OpenClaw state DB に保存し、ResumeCheckpoint、Task Ledger、メモリ、trace 証拠から有界なコンテキストを再構築します。各 tick で内部 `task_loop` を実行し、Mission reviewer が反映、checkpoint 書き込み、メモリ候補提案を行い、UI には pause/resume/cancel、tick フェーズ、decision、next wake、blocked reason、trace 証拠が表示されます。scheduled tick は明示的な有効化が必要で、完了判定は常に証拠から行われます。
Engineering Control Signals は evidence gap、scope drift、validation missing、unverified claim を既存の checkpoint、Mission/Task reviewer、HostEvent、Task Ledger metadata の経路に明示します。Verse Claw は第二の進捗ファイルを作らず、Observability trace を自動的に完了事実として扱いません。

Chat 入力欄には、プレビュー優先の **新しい会話への Handoff** もあります。Verse Claw は ResumeCheckpoint、runtime recovery context、Task Ledger、Git 状態、最近の trace/error 状態、transcript fallback 証拠から編集可能な決定的な引き継ぎ草稿を作成し、新しい workspace スコープのセッションにその草稿を入力済みにします。自動送信はしません。

セッションメニューには **チェックポイント** も追加されました。Verse Claw は長タスクの `ResumeCheckpoint` スナップショット（Mission の tick ごとに 1 つ）を一覧表示し、選択したチェックポイント以降に書き込みジャーナルへ記録されたエントリをロールバックしてワークスペースを復元できます。これは runtime replay-rollback authority の手動側です（自動側は `runtime.mission.rollback.enabled` でゲートされ、既定では無効）。
**新しい会話への Fork** は分岐型の対になる機能です。現在のセッションがアイドル状態のとき、Verse Claw は runtime に active transcript branch を継承した子セッションを作成させ、すぐに切り替えます。親セッションは変更せず、Task Ledger の真実をコピーせず、prompt の生成や自動送信も行いません。
Composer にはローカル preflight でおすすめされた継続アクションだけを表示し、短い healthy/risky/blocked の状態ヒントを添えます。セッションのドロップダウンには Fork と Handoff の両方を残して小さな Recommended マーカーと軽量な Fork 元情報を付けます。失敗時は Prepare handoff などの明示的な代替操作だけを提示し、自動で意味を切り替えません。

### ClawGraph Runtime
ClawGraph ページは、現在の workspace の `.clawx/clawgraph/*.yaml` ワークフローを一覧表示し、検証済み DAG にコンパイルして制御された run を開始し、ノード状態、読み取り専用 DAG、append-only イベント、レビュー項目を表示します。Worker は有界なロール別サブ Agent として実行され、構造化された `clawgraph_handoff` JSON だけを返します。監査失敗や不確かなグラフ変更は、真実として受け入れずユーザーレビューで停止します。ClawGraph は実行状態を記録し、Task Ledger は長期目標とレビュー台帳を担います。

### Agent Trace ワークベンチ
Observability ページは、Verse Claw 管理のローカル JSON/JSONL trace インデックスに、マスク済み trace envelope を既定で 30 日または 1000 件まで保持し、Agent 実行をインタラクティブな診断トレースグラフとして表示します。クエリ駆動の trace 一覧には issue chip、ソース鮮度（`live`、`stale`、`rehydrated`、`partial`）、エラー、成果物、リトライ、token/cost、遅いホットスポットを表示し、Root Cause、Critical Path、Artifacts、Cost のビューで問題をすばやく絞り込めます。ワークベンチは概要/根本原因ストリップから始まり、Graph、実行ツリー、スイムレーン表示、集中/標準/全件のグラフ密度切り替え、trace 比較、よく使う一覧ビューの保存、ローカルレビュー メモを備えています。グラフ検索、フェーズ/種類/状態フィルター、パン/ズーム、ミニマップ、重要経路の強調、タイムライン連動、Issues・イベント・マスク済み I/O 概要・成果物・許可済み属性を含むノード診断ドロワーも引き続き備えています。Chat の実行カードは trace データがある場合、該当 trace または issue ノードへ直接移動できます。`clearTraces()` は Verse Claw observability のインデックスとキャッシュだけを消去し、transcript/trajectory の元ファイルは削除しません。詳細は既定で概要中心で、完全な raw prompt、出力、tool args、tool output は露出しません。

Runtime には、Gateway から見える `tools.invoke` 呼び出しと runtime validation input 向けの security / verification shadow layer もあります。既定では無効で、ポリシーで有効にすると、マスク済みのインメモリ security decision、tool-call/event-log/checkpoint の deterministic verification summary、runId で相関できる result filter、集計 health count を `security.*` / `verification.*` RPC と追加 Observability span に記録します。ツールをブロックせず、外部テストや LLM judge を実行せず、raw tool args/result/events/checkpoints も永続化しません。

### タスク台帳
Task Ledger ページは、長期作業のために workspace 単位かつ Agent 中立の構造化記録を保持します。目標、サブタスク、依存関係、ブロック、レビュー対象、決定、逸脱、セッションリンクを append-only JSONL イベントとしてローカル OpenClaw 設定ディレクトリに保存し、Chat の横に要約を表示し、Tree、DAG、History、Review を含む単一のオフライン HTML として出力できます。

### 受信トレイとリモートタスク
受信トレイは、一般の権限申請、構造化 Remote Task envelope、監督対象 Browser Tasks を一つのローカル判断キューにまとめます。リモート設定パッチは変更プレビューを表示し、ユーザーが明示的に承認した後にだけ Main プロセスが許可リスト内の設定更新を適用します。処理済みの権限申請と Remote Task は「履歴」に残り、ローカル Remote Task テスト envelope の作成機能は **設定 → 開発者** に移動しました。旧 `/remote-tasks` ルートは Remote Tasks フィルター付きの受信トレイを開きます。

### Code Review Center
Review Center は、未コミット変更、ベースブランチとの差分、または指定 commit に対して読み取り専用の AI review を実行します。severity 付きの findings、file/line アンカー、サニタイズ済み review trace を生成し、finding または review 全体を Task Ledger review node に変換できます。stage、commit、ファイル編集は行いません。Git patch は共有の構造化 patch contract で検証され、malformed または producer-truncated の diff はモデルレビュー開始前に停止します。Chat では、write journal で裏付けられた成功済みの `edit` とファイル全体の `write` に rich diff と同一 text patch のコピー操作を表示します。mutation lineage が欠落、古い、または不完全な場合、Renderer の状態から diff を推測して再構築しません。Remote PR タブは Main-owned host API を通じて GitHub PR の detail、commits、files、構造化 diff、checks、reviews、branch protection、および指定ファイル内容を上限付きで読み取ります。完全性、capability、readiness は明示され、不足、truncated、unauthorized、unknown の証拠が ready と解釈されることはありません。review、line comment、thread reply、許可リスト内の metadata 更新は既定で draft に留まり、完全一致する一回限りの action-bound approval を消費した場合だけ公開されます。head/version drift は fail closed となり、partial または ambiguous な結果は無条件再試行ではなく reconciliation を表示します。制御された merge も同じ Main-owned policy を使い、実行直前に head と readiness を再取得し、正確な strategy と policy 証拠に結び付いた短時間・一回限りの approval を消費して expected head SHA を送信します。本番 repository は allowlist 外、Agent merge は既定で無効であり、merge 後の refresh または audit の失敗は merge 再試行ではなく reconciliation として表示されます。

### セッションワークスペース
Chat のワークスペースは、連続したコンパクトな作業面として `Review`、`Terminal`、`Browser`、`Files`、`Artifacts`、`Audit` の 6 タブを表示します。Changes は Review に、ファイルプレビューは Files に含まれます。Browser には Preview と監督付き Live があり、Terminal は同じシェルセッションを保ったまま下部パネルとサイドタブを切り替えられます。狭い画面では Files がツリーとプレビューの単一ビューを切り替えます。既存の Main 所有 Browser、Terminal、Git、Review、スクリーンショット、snapshot、承認 API を引き続き利用し、`/browser` と `/code-review` は対応するワークスペースを開く互換ルートとして残しています。Task Ledger と ClawGraph はワークスペースのコンテキスト入口から全画面ツールとして開けます。

### Knowledge Hub
Knowledge ページは OpenClaw `memory-wiki` を通じて、出典付き wiki コンテキストを管理します。既定では Verse Claw 管理の隔離 native vault を使い、unsafe local-vault モードへ切り替えずに、制限されたテキストファイルやフォルダーを取り込めます。また、ローカル OKF v0.1 Markdown bundle を検証して `wiki.ingest` 上の薄い互換アダプターとしてインポートできます。状態確認、検索、結果確認、compile、lint、Knowledge Inbox、draft/proposal レビュー、provenance、ガバナンスの流れを備えています。Inbox は Chat、Task Ledger、ファイル、OKF、ClawGraph、agent 由来の候補知識を正式な wiki の外に保持し、ユーザーがドラフトへ昇格または破棄するまで書き込みません。provenance は出典参照と読み取り/参照イベントだけを記録し、wiki ページを変更しません。Chat の知識範囲（`None`、`Memory`、`Wiki`、`All`）は読み取り範囲だけを表します。Agent は search/get で文脈を読めますが、scope が有効でも書き込み、更新、アーカイブ、削除、マージ、apply はできません。Chat では `/wiki` で検索し、明示的な wiki 参照を visible chip として添付してから送信できます。`/memory`、`/all`、`/none`、`/scope` は読み取り範囲だけを変更し、書き込み権限にはなりません。知識呼び出しモードの既定は Suggest で、関連知識は任意の chip として表示されます。Auto-read は明示的に有効化した場合のみ、少数の新しく高信頼な読み取り専用参照を添付します。セッション由来の知識や agent/Knowledge Steward の提案は編集可能な draft/proposal に入り、ユーザーの明示的な確認後にだけ wiki へ適用されます。Obsidian は任意の拡張であり、必須依存ではありません。ガバナンスダッシュボードはオンデマンドの健全性チェックにより矛盾、陳腐化、未解決参照を可視化します。監視ディレクトリはプロジェクト文書を pending Inbox にだけ入れ、正式な wiki への direct-ingest や synthesis 作成は自動実行しません。

高度な SEKB 診断では、既定でオフの `runtime.contextBlock.sekb.shadowEvaluation.enabled` を明示的に有効化できます。`runtime.contextBlock.sekb.enabled` も必要であり、`OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED` は shadow フラグだけを上書きします。この機能は capture と completion の証拠用に有界で決定的な advisory metadata を保存するだけで、trajectory の除外、principle の書き込み、タスク完了判定の変更は行いません。

任意の `runtime.contextBlock.sekb.batchDistillationAssistant.enabled` も既定ではオフで、SEKB の主ゲートが必要です。`OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED` はこの assistant のフラグだけを上書きします。operator は明示的に手動実行する必要があります。Host/CLI は DEEPSEEK_API_KEY があればそれを使い、なければ deterministic fallback になります。この assistant が送信するのは、有界かつ秘匿化した trajectory projection と有界な既存 principle summary だけです。可観測な 30 秒の retry は一度だけで、provider unavailable、timeout、無効な JSON/schema、または上限到達時には既存の決定的な distillation suggestion を返します。安全な集約 trace/cost evidence だけを記録し、既存の `confirm_and_save` 確認パスより前に Principle、Memory、ContextBlock、index、trajectory state を書き換えることはありません。

Knowledge > Runtime Lessons は既存の typed 経路を使い、決定的な提案、正確な候補レビュー、明示的な確認または却下、確認済み原則の取得を提供します。提案とレビューは書き込みを行いません。確認には可視のセッション系譜が必要で、引き続き `confirm_and_save` を使います。取得結果は有界な助言テキストとして表示するだけで、Chat へ自動添付しません。Hermes の shadow export/protocol/report と batch 運用は引き続き CLI/Host 専用です。すべての feature flag は既定オフのままで、principle / memory / ContextBlock / index / trajectory state を自動書き込みしません。`artifacts/sekb-hermes-phase-a5/` のオフライン成果物は非権威の評価証跡です。

ローカル CLI/Host ops は `openclaw_runtime/dist/knowledge/sekb/index.js` を読み込みます。`pnpm build:runtime` または `pnpm exec node scripts/build-openclaw-runtime.mjs --sekb-only` で構築してください。dist がない場合 Host は `runtimeUnavailable` に降格し、CLI はビルド案内を出します。`pnpm sekb:hermes:gate` に dist は不要です。

CLI:

- `pnpm sekb:hermes:export` - プライバシー境界付き shadow export
- `pnpm sekb:hermes:protocol` - 二重レビュー protocol サンプルと reviews テンプレート
- `pnpm sekb:hermes:report -- --reviews <path>` - オフライン report（昇格ゲート通過前は `shadow_only`）
- `pnpm sekb:hermes:suggest` / `--batch` - 決定的 suggestion；batch は flag が必要。DEEPSEEK_API_KEY があれば Host/CLI が利用、なければ deterministic fallback
- `pnpm sekb:hermes:confirm` / `pnpm sekb:hermes:reject` - 既存 DistillationTool 境界
- `pnpm sekb:hermes:gate` - focused tests + contract + harness validate

Host API（`knowledge.*`）: `runtimeLessonsReport`, `sekbShadowEvaluationExport`, `sekbShadowEvaluationProtocol`, `sekbShadowEvaluationReport`, `sekbSuggestPrinciples`, `sekbBatchDistillSuggest`, `sekbConfirmPrinciple`, `sekbRejectSuggestion`, `sekbRetrieveForTask`。

Shadow V1 のスコアリングと閾値 50 は凍結。ラベリング kit の準備完了は昇格準備完了を意味しません。Phase C/D の filtering / scheduling は延期です。

### Workspace Git コントロール
Workspace サイドバーはまずコンパクトな入口ランチャーを開きます。現在の workspace が Git リポジトリの場合だけ Review 入口が表示され、Git ではないプロジェクトには Git コントロールを表示しません。
Workspace サイドバーには Git ワークベンチがあり、リポジトリ状態、side-by-side ファイル diff、stage、patch コピー、承認付きのファイル revert、commit、branch、stash、worktree、merge、rebase、reset、GitHub Pull Request を扱えます。コンパクトな Audit タブは権限判断と最新の `git reflog --all` エントリーをまとめて表示し（有界ビュー、上限を超えた古い項目は明示）、commit、checkout、reset、rebase、その他の参照移動を示します。上部の readiness strip はローカル Git、組み込み Agent Git tools、worktree 数、`gh` 認証状態を数値化し、今使える能力をその場で確認できます。Worktree 追加は新規 branch と既存 branch の両方に対応し、新しい worktree は既定でリポジトリの隣に作られます。統一 diff は構造化された patch エンジンを通じて適用、revert、または書き込みなしの事前チェックができ、適用済み・skip・conflict のパスをそれぞれ個別に報告します。形式が壊れているか切り詰められた patch は、ファイルに触れる前に拒否され、部分適用されることはありません。読み取り専用の base 比較は HEAD を最も近いリモート祖先（明示的な ref、branch の upstream、または `origin/HEAD`）と diff し、そのどれを使ったかを報告します。リモート祖先が存在しない場合や、両者に共通 commit がない場合は、base を推測せずに比較を利用不可として報告します。同じ Main プロセスの Git service が組み込み `clawx-git` MCP server も支えるため、Agent は shell コマンドを直接組み立てず、Verse Claw の権限管理を通じて制御された Git / PR ツールを呼び出します。revert、pull、push、merge、rebase、reset、patch の適用/revert、worktree remove/prune、PR 作成など状態を書き換えたり公開したりする操作は承認付きです。

### 📡 マルチチャネル管理
複数のAIチャネルを同時に設定・監視できます。各チャネルは独立して動作するため、異なるタスクに特化したエージェントを実行できます。
現在は各チャンネルで複数アカウントを扱え、Channels ページでアカウントの Agent 紐付けやデフォルトアカウント切替を直接管理できます。
同じページで、各チャンネル/アカウントの DM、グループ、ネイティブ承認ポリシーの概要も表示し、許可リストの具体的なメンバーやシークレットは公開しません。
カスタムのチャンネルアカウント ID には、ルーティング不一致を防ぐため OpenClaw 互換の正規形式（`[a-z0-9_-]`、英小文字、最大 64 文字、先頭は英小文字または数字）を必須にしています。
Verse Claw には Tencent 公式の個人 WeChat チャンネルプラグインも同梱されており、Channels ページからアプリ内 QR フローで直接 WeChat を連携できます。

### ⏰ Cronベースの自動化
AIタスクを自動的に実行するようスケジュール設定できます。トリガーを定義し、間隔を設定することで、手動介入なしにAIエージェントを24時間稼働させることができます。
定期タスク画面では外部配信を「送信アカウント」と「受信先ターゲット」の 2 段階セレクターで設定できるようになりました。対応チャネルでは、受信先候補をチャネルのディレクトリ機能や既知セッション履歴から自動検出するため、`jobs.json` を手で編集する必要はありません。
定期タスクでは Agent Browser 自動化も実行できます。URL、ブラウザ profile/auth state、安全ポリシー、成功/失敗条件、保守的な安全ステップ再試行、診断項目を指定すると、チェックイン、ページ監視、ドラフト公開などのジョブが内部 managed browser の永続ログイン状態を再利用し、失敗時には簡潔な証拠を表示できます。

**スケジュール済み** ページでは、Cron ジョブと監督対象 Browser run を、バックエンドモデルを統合せずに一つのコンパクトなリストへ投影します。Cron では作成、編集、有効化/一時停止、削除、即時実行、配信設定、実行履歴を引き続き利用でき、Browser run では承認、拒否、再試行、キャンセル、順序付き手順、時刻、型付きの結果またはエラー証拠を確認できます。幅 960px では、混雑した 3 列表示にせず、詳細がリストを置き換えます。Browser profile と既存の資格情報 Vault は **設定 > Browser** で管理し、送信したパスワードは Main プロセスだけが保持して Renderer へ再表示しません。

Agent Browser ワークベンチと旧 `/browser` ルートは、サイドバー下部の `...` メニューから開く互換エントリとして引き続き残り、Main プロセス所有のランタイムを通じて分離されたタブとライブ session を提供します。これらのライブ session を Chat ワークスペースへ移す作業は後続の移行段階です。Chat は送信前に実 transcript 使用量から token/cost 予算を判定し、永続化・描画される tool 出力を制限し、キャンセルまたはハードタイムアウト時には基盤の実行を中止します。

監督対象の Browser タスクは、ブラウザーに副作用を発生させる前に承認待ちとして永続化されます。承認画面には目的、対象サイト、承認済みドメイン、モード、権限範囲、順序付き実行計画が表示され、ユーザーの明示的な承認後にのみ Main プロセスが上限付きの移動、待機、クリック手順を実行し、型付きの成功または失敗判定を返します。このフローは無人ブラウジングやプライベートネットワークアクセスを許可せず、認証情報は Main プロセス所有の Vault 参照に留まります。

Verse Claw には、Web、RSS、V2EX、雪球、Bilibili、YouTube、GitHub、Twitter、小紅書に対応する読み取り専用の Reach Readers プラグインも既定で含まれます。各プラットフォームの API/CLI を優先し、既存の Agent Browser profile は安全なページ fallback または可視ログイン引き継ぎにのみ使用され、Cookie や token がモデルへ公開されることはありません。


### 🧩 拡張可能なスキルシステム
事前構築されたスキルでAIエージェントを拡張できます。統合 Skills ページはローカル優先で、管理ディレクトリや workspace のスキルをスキャンし、Gateway に依存せず有効/無効を切り替えられます。エンタープライズ拡張がある場合は、その拡張が提供する marketplace も表示できます。
Verse Claw はドキュメント処理スキル（`pdf`、`xlsx`、`docx`、`pptx`）もフル内容で同梱し、起動時に管理スキルディレクトリ（既定 `~/.openclaw/skills`）へ自動配備し、初回インストール時に既定で有効化します。追加の同梱スキル（`find-skills`、`self-improving-agent`、`tavily-search`）も既定で有効化されますが、必要な API キーが未設定の場合は OpenClaw が実行時に設定エラーを表示します。
Skills ページでは OpenClaw の複数ソース（管理ディレクトリ、workspace、追加スキルディレクトリ）から検出されたスキルを表示でき、各スキルの実際のパスを確認して実フォルダを直接開けます。OpenClaw 同梱の bundled skill については、コミュニティ版ではパッケージにも表示にも `skill-creator` のみを残し、dev 起動時と packaged 起動時の両方で他の bundled skill を物理的に削除します。さらに、削除済み bundled skill の古い `openclaw.json` エントリも一緒に掃除します。
チャット入力欄では、検出済みローカル Skill の有効化や貼り付けた MCP JSON の登録など、ローカル優先の能力管理リクエストを送信前に検出し、確認ダイアログでローカル監査結果も表示します。監査でブロックされていない操作だけを host API 経由で適用し、その結果を信頼済み Verse Claw メタデータとして今回のメッセージに注入します。能力オーケストレーションは `capability-management` Observability trace も出力し、監査、登録、reload、heartbeat、tool list の各ステップを記録するため、インストール/登録フローを Agent runtime trace と並べて調査できます。v1 の監査は説明可能なローカルゲートで、Skill メタデータと MCP command/URL/env のリスクを確認します。リモート marketplace パッケージの自動ダウンロードや npm/npx テンプレート実行は行いません。

主な検索スキルで必要な環境変数:
- `TAVILY_API_KEY`: `tavily-search` 用（上流ランタイムで OAuth 対応の場合あり）

### 🔐 セキュアなプロバイダー統合
複数のAIプロバイダー（OpenAI、Anthropicなど）に接続でき、資格情報はシステムのネイティブキーチェーンに安全に保存されます。OpenAI は API キーとブラウザ OAuth（Codex サブスクリプション）の両方に対応しています。
開発者モードでは、専用の Image Generation ページで、独立した OpenAI 互換の画像生成エンドポイント（Base URL、API キー、`gpt-image-2` などのモデル名）を設定でき、画像生成だけ専用の `/v1/images/generations` サービスを使い、チャットは通常の OpenAI Provider のまま継続できます。
OpenAI-compatible ゲートウェイを **Custom プロバイダー** で使う場合、**設定 → AI Providers → Provider 編集** でカスタム `User-Agent` を設定でき、互換性が必要なエンドポイントで有効です。
互換ゲートウェイで `/models` が認証以外の理由で使えない場合、Verse Claw は API キー検証時に軽量な `/chat/completions` または `/responses` プローブへ自動フォールバックします。
`openclaw.json` の環境変数 SecretRef で設定したプロバイダーも、Verse Claw が変数を読み取れ、secret provider が許可していれば利用可能と認識されます。環境変数のキーは設定ファイルへコピーされません。

### 🌙 アダプティブテーマ
ライトモード、ダークモード、またはシステム同期テーマ。Verse Clawはあなたの好みに自動的に適応します。

Windows、macOS、Linux では UI v2 が既定で有効になりました。FakeCoding に合わせたニュートラルなグレースケールの作業面、28-36 px のコンパクトなコントロール、白黒反転の主要操作、サンセリフの管理画面見出し、120-180 ms の控えめなモーションを採用し、各プラットフォーム固有のウィンドウ操作は維持します。設定のディープリンクは背後のページを保持し、閉じた後にフォーカスを復元します。段階的な移行中は `?uiVersion=legacy` で旧 UI と比較できます。

### 🚀 自動起動設定
**設定 → 一般** から **システム起動時に自動起動** を有効化すると、ログイン後に Verse Claw が自動的に起動します。

### 🔔 更新通知
Verse Claw には組み込みの更新確認や上流更新通知はありません。二次配布では独自のパッケージングまたはリリース経路を使用してください。

---

## はじめに

### システム要件

- **オペレーティングシステム**: macOS 11以上、Windows 10以上、またはLinux（Ubuntu 20.04以上）
- **メモリ**: 最低4GB RAM（8GB推奨）
- **ストレージ**: 1GBの空きディスク容量

### インストール

#### ビルド済みリリース（推奨）

[Releases](https://github.com/ValueCell-ai/Verse Claw/releases)ページから、お使いのプラットフォーム向けの最新リリースをダウンロードしてください。

#### ソースからビルド

```bash
# リポジトリをクローン
git clone https://github.com/ValueCell-ai/Verse Claw.git
cd Verse Claw

# プロジェクトの初期化
pnpm run init

# 開発モードで起動
pnpm dev
```
### 初回起動

Verse Clawを初めて起動すると、**セットアップウィザード**が以下の手順をガイドします：

1. **言語と地域** – 使用する言語・地域の設定
2. **AIプロバイダー** – APIキーまたは OAuth（ブラウザ/デバイスログイン対応プロバイダー）で追加
3. **スキルバンドル** – 一般的なユースケース向けの事前設定スキルを選択
4. **検証** – メインインターフェースに入る前に設定をテスト

サポート対象のシステム言語がある場合、ウィザードはその言語を初期選択し、未対応の場合は英語にフォールバックします。

### プロキシ設定

Verse Clawには、Electron、OpenClaw Gateway、またはTelegramなどのチャネルがローカルプロキシクライアントを介してインターネットにアクセスする必要がある環境向けに、組み込みのプロキシ設定が含まれています。

**設定 → 開発者 → プロキシ**を開いて以下を設定します：

- **プロキシサーバー**: すべてのリクエストのデフォルトプロキシ
- **バイパスルール**: 直接接続すべきホスト（セミコロン、カンマ、または改行で区切る）
- **開発者モード**では、オプションで以下をオーバーライドできます：
  - **HTTP プロキシ**
  - **HTTPS プロキシ**
  - **ALL_PROXY / SOCKS**

推奨されるローカル設定例：

```text
プロキシサーバー: http://127.0.0.1:7890
```
注意事項：

- `host:port`のみの値はHTTPとして扱われます。
- 高度なプロキシフィールドが空の場合、Verse Clawは`プロキシサーバー`にフォールバックします。
- プロキシ設定を保存すると、Electronのネットワーク設定が即座に再適用され、ゲートウェイが自動的に再起動されます。
- Verse ClawはTelegramが有効な場合、プロキシをOpenClawのTelegramチャネル設定にも同期します。
- Verse Clawのプロキシが無効な状態では、Gatewayの通常再起動時に既存のTelegramチャネルプロキシ設定を保持します。
- OpenClaw設定のTelegramプロキシを明示的に消したい場合は、プロキシ無効の状態で一度「保存」を実行してください。
- **設定 → 開発者** では **OpenClaw Doctor** を実行でき、Gateway と同じ選択済みランタイムに対する診断出力をアプリ内で確認できます。
- Windows のパッケージ版では、同梱された `openclaw` CLI/TUI は端末入力を安定させるため、同梱の `node.exe` とパッケージ済みの `openclaw-runtime` エントリーポイント経由で実行されます。

---

## アーキテクチャ

Verse Clawは、**デュアルプロセス + Host API 統一アクセス**構成を採用しています。Renderer は単一クライアント抽象を呼び出し、プロトコル選択とライフサイクルは Main が管理します：

```
┌────────────────────────────────────────────────────────────────────┐
│                        Verse Claw デスクトップアプリ                       │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Electron メインプロセス                            │  │
│  │  • ウィンドウ＆アプリケーションライフサイクル管理                    │  │
│  │  • ゲートウェイプロセスの監視                                     │  │
│  │  • システム統合（トレイ、通知、キーチェーン）                       │  │
│  │  • リリースパッケージングのみ                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              │ IPC（権威ある制御プレーン）             │
│                              ▼                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              React レンダラープロセス                           │  │
│  │  • モダンなコンポーネントベースUI（React 19）                      │  │
│  │  • Zustandによるステート管理                                    │  │
│  │  • 統一 host-api/api-client 呼び出し                           │  │
│  │  • リッチなMarkdownレンダリング                                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               │ 型付き IPC リクエスト
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                Main Host Services と Gateway Manager              │
│                                                                 │
│  • host:invoke 型付きサービスディスパッチ                            │
│  • 設定、ファイル、セッション、スキル、プロバイダー、診断サービス          │
│  • Main が Gateway WebSocket とプロセス監視を所有                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Main 所有 WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw ゲートウェイ                         │
│                                                                 │
│  • AIエージェントランタイムとオーケストレーション                       │
│  • メッセージチャネル管理                                           │
│  • スキル/プラグイン実行環境                                        │
│  • プロバイダー抽象化レイヤー                                       │
└─────────────────────────────────────────────────────────────────┘
```
### 設計原則

- **プロセス分離**: AIランタイムは別プロセスで動作し、重い計算処理中でもUIの応答性を確保します
- **フロントエンド呼び出しの単一入口**: Renderer は host-api/api-client を通じて呼び出し、下位プロトコルに依存しません
- **Mainによるトランスポート制御**: Gateway WebSocket は Electron Main のみが所有し、Renderer は型付き IPC で Main と通信します
- **拡張 IPC コントリビューション**: Main プロセス拡張は HTTP route ではなく、型付き IPC レジストリを通じて host-api action を提供します
- **グレースフルリカバリ**: 再接続・タイムアウト・バックオフで一時的障害を自動処理します
- **セキュアストレージ**: APIキーや機密データは、OSのネイティブセキュアストレージ機構を活用します
- **CORSセーフ設計**: Renderer はローカル Gateway や Host API HTTP エンドポイントを直接呼び出しません

### プロセスモデルと Gateway トラブルシューティング

- Verse Claw は Electron アプリのため、**1つのアプリインスタンスでも複数プロセス（main/renderer/zygote/utility）が表示される**のが正常です。
- 単一起動保護は Electron のロックに加え、ローカルのプロセスロックファイルも併用し、デスクトップ IPC / セッションバスが不安定な環境でも重複起動を防ぎます。
- ローリングアップグレード中に旧版/新版が混在すると、単一起動保護の挙動が非対称になる場合があります。安定運用のため、デスクトップクライアントは可能な限り同一バージョンへ揃えてください。
- ただし OpenClaw Gateway の待受は常に**単一**であるべきです。`127.0.0.1:18789` を Listen しているプロセスは1つだけです。
- Gateway の readiness は `system-presence`、`health`、`status` などの OpenClaw コア信号を基準にし、memory、Dreams、チャネルの失敗はグローバルな Gateway 障害ではなく capability degradation として表示します。
- Listen プロセスの確認例:
  - macOS/Linux: `lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows (PowerShell): `Get-NetTCPConnection -LocalPort 18789 -State Listen`
- ウィンドウの閉じるボタン（`X`）は既定でトレイへ最小化する動作で、完全終了ではありません。完全終了する場合はトレイメニューの **Quit Verse Claw** を使用してください。

### VerseShell typed ACI の制御付き canary

VerseShell は Windows x64 の内部 canary 向けに限定した任意の実行バックエンドです。既定では無効であり、正式リリースやネイティブ shell の無条件な代替を意味しません。明示的に有効化しても、Agent の `exec` は最初に OpenClaw の allowlist/approval を通過する必要があります。その後、検証済みの同梱 `ae.exe` が workspace jail、リポジトリ所有の strict policy、唯一の `shell.exec` capability、アクションに束縛された一回限りの approval token で実行します。runtime、protocol、catalog、workspace、capability、policy の不一致は fail-closed となり、governed 経路はネイティブ shell へフォールバックしません。

同梱 runtime は [`resources/verseshell/source-inputs.json`](resources/verseshell/source-inputs.json) に記録された対応ソースだけから受け入れます。固定 commit、順序付き tracked patch、許可リスト化した復元入力、lock 済み Rust 全量検証、現在の interpreter による Python 検証、二つの byte-identical な Windows build が必要です。詳細は [`SOURCE.md`](resources/verseshell/SOURCE.md)、[`BUILD.md`](resources/verseshell/BUILD.md)、[P0-02 evidence](docs/dev/verseshell-foundation/P0-REPRODUCIBLE-BUNDLE-EVIDENCE-2026-08-14.md) を参照してください。この source/build gate は canary を有効化せず、default-off の rollout lock も変更しません。実際の governed approval denial、一回限りの token 隔離 retry、bounded artifact recovery、native fallback 無効化を検証した P0-03 engineering probe は [P0-03 evidence](docs/dev/verseshell-foundation/P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md) に記録しています。この結果は provider-backed canary や製品承認を意味しません。
P1 の supervised ACI kernel は `starting`/`handshaking`/`ready`/`backoff`/`stopped`/`failed` の lifecycle、host 所有の request/trace/deadline correlation、有界の lifecycle error、明示 opt-in の read-only retry、fail-closed の operator kill switch を記録します。[P1-01 evidence](docs/dev/verseshell-foundation/P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md) を参照してください。これは engineering evidence のままで、rollout を有効化しません。
外部 `resources/verseshell-mcp` compatibility adapter は root workspace と frozen SDK lockfile で管理される独立 package になり、product profile は deny-by-default、pinned runtime の capability vocabulary と strict agent policy、package/runtime/protocol identity を検証します。`verseshell_eval` と shell-string compatibility は development profile 専用で、effectful compatibility tool は deferred、shell path は explicit argv のみを受け付け、ClawX 内部の実行経路にはなりません。[P1-03 evidence](docs/dev/verseshell-foundation/P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md) を参照し、MCP compatibility、write、native fallback、canary、rollout は既定で無効のままにしてください。

P2-01 read-only facade は、安定した `read_file`、`search_content`、`result_query` だけを host-owned typed ACI 経路へ接続します。五つの readiness flag が明示的に有効で kill switch が解除されている場合だけ materialize され、それ以外は model tool surface に現れません。workspace 外、絶対パス、NUL、無制限 query、壊れた result handle、期限切れ artifact、owner drift は fail-closed です。cache identity は workspace、revision、policy、operation、args を含みます。これは engineering evidence であり、command profile、write、canary、default-on、GA、product approval を有効化しません。[P2-01 evidence](docs/dev/verseshell-foundation/P2-READONLY-FACADE-EVIDENCE-2026-08-14.md) を参照してください。

P2-02 argv-only command profile は、OpenClaw の承認前 command analysis を不変の host-owned execution plan へ収束します。通常の test/build/lint/git コマンドは direct argv で実行され、pipeline・chain・redirect・heredoc・inline evaluation・明示的 interpreter は独立した terminal-shell payload のままです。profile（`pnpm`/`npm`/`corepack` の `exec`/`dlx` runner パススルーを含む）は host が導出し、model が profile、interpreter、PATH/PATHEXT、policy、approval token を選ぶことはありません。Windows の `.exe`/`.com` は direct argv のまま、`.cmd`/`.bat` は監査済み `cmd.exe` interpreter の下で resolved script identity を保持し、承認後に display command を再解釈しません。cwd/env/argv/timeout/output の境界違反は fail-closed で、native/MCP/legacy fallback はありません。これは engineering evidence であり、diagnostics、write、canary、default-on、GA、product approval を有効化しません。[P2-02 evidence](docs/dev/verseshell-foundation/P2-COMMAND-PROFILES-EVIDENCE-2026-08-14.md) を参照してください。

P3 external-write policy は、compiler、script、Git hook、terminal shell、その他の副作用を持ちうる process command を不変の command plan 上で external write として明示します。既存の OpenClaw exec approval が唯一の承認面であり、静的な警告は command text や credential を複製しません。これらの process write は ClawX write journal の外にあり、`rollbackClaim=false` で、自動 rollback も行いません。この engineering slice は write、canary traffic、default-on、GA、product approval を有効化しません。[P3 evidence](docs/dev/verseshell-foundation/P3-EXTERNAL-WRITE-POLICY-EVIDENCE-2026-09-02.md) を参照してください。

保守的な `openclaw.json` 設定は次のとおりです。

```json
{
  "tools": {
    "exec": {
      "host": "verseshell",
      "security": "allowlist",
      "ask": "on-miss"
    }
  },
  "runtime": {
    "verseShellFoundation": {
      "verifiedRuntime": true,
      "typedAci": true,
      "facade": true,
      "governedExec": true,
      "artifactResults": true
    }
  }
}
```

`tools.exec.host=verseshell` は、オペレーターがグローバルまたは Agent ごとの cohort に対して選択する設定です。設定がオーバーライドを許可している場合、セッション指令 `/exec host=verseshell security=allowlist ask=on-miss` でも同じバックエンドを選択できますが、モデルが呼び出しごとに VerseShell host を選択することはできません。sandbox、node、remote/provider-native、elevated の実行は既存の owner を維持します。大きな出力は `result://sha256/...` handle を返し、Agent は `verseshell_result` で範囲を制限した断片を取得できます。handle と lineage は runtime が所有する content-addressed 情報であり、期限切れ、欠落、digest 不一致、owner 不一致の artifact は fail-closed になります。切り捨て時は retained/omitted bytes を返し、出力を黙って破棄しません。`legacyEval`、`mcpCompatibility`、`compatibilityNativeFallback` は無効のままにしてください。緊急停止は `runtime.verseShellFoundation.killSwitch` を `true` にするか、`VERSE_VERSESHELL_FOUNDATION_KILL_SWITCH=1` を設定して Gateway を再起動します。ローカルの engineering coverage は、実 cohort、provider usage、ROI、soak、製品 graduation の証拠にはなりません。

---

## ユースケース

### 🤖 パーソナルAIアシスタント
質問への回答、メールの下書き、ドキュメントの要約、日常タスクのサポートなど、汎用的なAIエージェントを設定できます。すべてクリーンなデスクトップインターフェースから操作できます。

### 📊 自動モニタリング
ニュースフィード、価格追跡、特定イベントの監視などを行うスケジュールエージェントを設定できます。結果はお好みの通知チャネルに配信されます。

### 💻 開発者の生産性向上
AI を開発ワークフローに統合できます。エージェントを使用して、コードレビュー、ドキュメント生成、反復的なコーディングタスクの自動化が可能です。

### 🔄 ワークフロー自動化
複数のスキルを連鎖させて、高度な自動化パイプラインを作成できます。データの処理、コンテンツの変換、アクションのトリガーを、すべてビジュアルにオーケストレーションできます。

---

## 開発

### Runtime Lifecycle Governance（Phase 2、デフォルト無効）

Runtime Lifecycle Governance は段階的に提供されます。Phase 0 では共有基盤を、Phase 1 では canonical cleanup finalizer と drain パイプラインを、Phase 2 では delete operation journal、`operationId` 駆動の Electron mirror gate、端末 keep-on-leave を追加しました。Phase 3 ではデフォルト無効の同一 Gateway goal wake loop（1 つの SQLite immediate arm トランザクション、完全 idle 後の `turnBarrier` ack、mission owner/lead 限定の `goal_wait`、`exec(background=true, wait="goal")`、プロセス終了 level-check と重複 wake 除去）を追加しました。Phase 4 ではデフォルト無効の durable helper ファイルプロトコル（`intent.json -> started.json -> exit.json`、`<trusted-root>/background-processes/<runId>/`）、`ProcessRunReconciler` の起動/低頻度 sweep 復旧、session reset/delete の ownerEpoch 失効、runDir クォータ/TTL/redaction、Windows detached helper パスを追加しました。復旧はコマンドを再実行せず、`intent` に `started` がなく live helper もない場合は `lost` と判定します。Phase 5 では `SessionActivity` 読み取りモデルを拡張し、既存の読み取り専用プローブ（`mission_runs`、goal-wake `flow_runs`/`task_runs`、bash process registry、supervisor snapshot、subagent lineage）だけを情報源とする goal / process / lineage 投影を追加しました。Electron サービスは転送と型付き集約のみを行い、Chat のセッション状態パネルは `react-i18next` と既存デザイントークンで新しい状態を表示し、ライフサイクルボタンや削除・復旧操作は追加しません。読み取りモデルテストは `activitySnapshotWriteFindings=0` を報告します。監査は `armTxCount=1`、`processPollToolCalls=0`、Phase 4 で `secretPersistenceFindings=0` を維持し、通常の Chat と既定の `background=true` 動作は変わりません。Phase 6 では evidence-only の本番クローズアウトを完了しました。`audit-0.json` から `audit-6.json` までが `pnpm run runtime-lifecycle-audit --phase all` ですべて検証され、旧フェーズの一時プロンプトは削除済みです。クローズアウトは `docs/dev/handoffs/LATEST.md` とタスクフォレスト `TF-0077` に記録し、将来のアイデアは `future-work.json` に保持しています。2026-08-19 の GA hardening で packaged Electron durable-helper 検証と 10 サイクルの実プロセス goal-wake canary を追加し、RLG-only 受け入れは無条件 PASS になりました。goal-wake / durable-helper のデフォルトとすべての製品ロックは変更していません。詳細は `docs/dev/runtime-lifecycle-governance/README.zh-CN.md`、`artifacts/runtime-lifecycle-governance/audit-6.json`、`artifacts/runtime-lifecycle-governance/ga-acceptance.json` を参照してください。

### 前提条件

- **Node.js**: 22以上（LTS推奨）
- **パッケージマネージャー**: pnpm 9以上（推奨）またはnpm
- **Linux（Ubuntu/Debian）**: Electron を実行する前に、必要なシステムライブラリをインストールしてください:
  ```bash
  sudo apt-get install -y libnss3 libgtk-3-0 libxss1 libxtst6 libatspi2.0-0 libnotify4 xdg-utils
  ```
  Ubuntu 24.04以降では、一部のパッケージに `t64` サフィックスが付いています。上記コマンドを実行すると `apt` が自動的に適切なバリアントを選択します。

### プロジェクト構成

```Verse Claw/
├── electron/                 # Electron メインプロセス
│   ├── services/            # 型付き Host API、Provider/Secrets/ランタイムサービス
│   │   ├── providers/       # provider/account モデル同期ロジック
│   │   └── secrets/         # OS キーチェーンと秘密情報管理
│   ├── shared/              # 共通 Provider スキーマ/定数
│   │   └── providers/
│   ├── main/                # アプリ入口、ウィンドウ、IPC 登録
│   ├── gateway/             # OpenClaw ゲートウェイプロセスマネージャー
│   ├── preload/             # セキュア IPC ブリッジ
│   └── utils/               # ユーティリティ（ストレージ、認証、パス）
├── src/                      # React レンダラープロセス
│   ├── lib/                 # フロントエンド統一 API とエラーモデル
│   ├── stores/              # Zustand ストア（settings/chat/gateway）
│   ├── components/          # 再利用可能な UI コンポーネント
│   ├── pages/               # Setup/Dashboard/Chat/Billing/Channels/Skills/Cron/Settings
│   ├── i18n/                # ローカライズリソース
│   └── types/               # TypeScript 型定義
├── tests/
│   ├── e2e/                 # Playwright による Electron E2E スモークテスト
│   └── unit/                # Vitest ユニット/統合寄りテスト
├── resources/                # 静的アセット（アイコン、画像）
└── scripts/                  # ビルド/ユーティリティスクリプト
```
### 利用可能なコマンド

```bash
# 開発
pnpm run init             # 依存関係のインストール + バンドルバイナリ（uv、agent-browser）のダウンロード
pnpm dev                  # ホットリロードで起動（不足時は同梱スキルを自動準備）

# コード品質
pnpm lint                 # ESLintを実行
pnpm typecheck            # TypeScriptの型チェック

# テスト
pnpm test                 # ユニットテストを実行
pnpm run test:e2e         # Electron E2E スモークテストを実行
pnpm run test:e2e:headed  # 表示付きウィンドウで Electron E2E を実行
pnpm run comms:replay     # 通信リプレイ指標を算出
pnpm run comms:baseline   # 通信ベースラインを更新
pnpm run comms:compare    # リプレイ指標をベースライン閾値と比較

# Agent harness
pnpm harness context --spec harness/specs/tasks/connect-clawx-to-openclaw-runtime.md
pnpm harness validate --spec harness/specs/tasks/connect-clawx-to-openclaw-runtime.md

# Agent dev/test control plane
pnpm agent-dev:make <page|e2e|host-route|skill|channel|plugin|scenario> my-scenario
# scenario scaffolds register shared/agent-dev/scenarios.ts and generate snapshot-backed E2E
pnpm contract:check
pnpm i18n:lint
pnpm channel:conformance my-channel
pnpm agent-dev:workbench
pnpm agent-dev:promote-scenario artifacts/agent-dev-scenarios/example.scenario.json my-scenario
pnpm agent-dev:deep-test
pnpm agent-dev:deep-test:reuse     # 日常ループ: build 再利用、cached typecheck、Workbench E2E smoke
pnpm agent-dev:deep-test:reuse:full  # build と cached typecheck を再利用しつつ full Agent Dev E2E を実行
pnpm agent-dev:audit               # 既存 evidence から Agent Dev maturity を採点
pnpm agent-dev:audit:report        # 同じ audit report を生成するが shell は失敗させない
pnpm agent-dev:unit:fast           # 日常ユニット高速パス。レビュー証跡は agent-dev:unit を使用
pnpm run typecheck:agent-dev       # node+web typecheck を並列実行する日常ループ
pnpm run test:e2e:agent-dev-quality:smoke  # Workbench E2E smoke ループのみ
pnpm run typecheck:cached          # Fingerprint-cached repeat typecheck for local diagnosis
pnpm run typecheck:force           # Force a fresh uncached typecheck cache refresh
pnpm agent-dev:validate
pnpm vtoken:test
pnpm vtoken:worker

# ビルド＆パッケージ
pnpm run build:vite       # フロントエンドのみビルド
pnpm build                # フルプロダクションビルド（パッケージアセット含む）
pnpm package              # 現在のプラットフォーム向けにパッケージ化（同梱プリインストールスキルを含む）
pnpm package:mac          # macOS向けにパッケージ化
pnpm package:win          # Windows向けにパッケージ化
pnpm package:linux        # Linux向けにパッケージ化
```

Verse Claw は active project workspace と OpenClaw agent workspace に `.clawx/harness/` の project harness ドキュメント骨格を生成します。rules、scenarios、task contracts、guides、layers、context-pack recipes、Task Ledger bridge docs を Verse Claw 独自の構造で扱い、並行する `.trellis/` や Markdown タスク状態の事実源は作りません。

Agent が作成するページ開発と機能テストでは、typed `hostApi.agentDev` control plane を使って state seed、`?devScenario=...`、host-api record/replay、diagnostics snapshot、transport trace、visual preset、selector contract を扱えます。deep-test report には machine-readable な `decision` と rolling timing history evidence も含まれます。詳しくは [`docs/agent-dev-control-plane.md`](docs/agent-dev-control-plane.md) を参照してください。

ヘッドレス Linux では Electron テストに表示サーバーが必要です。`xvfb-run -a pnpm run test:e2e` を利用してください。

### 通信回帰チェック

PR が通信経路（Gateway イベント、Chat 送受信フロー、Channel 配信、トランスポートのフォールバック）に触れる場合は、次を実行してください。

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CI の `comms-regression` が必須シナリオと閾値を検証します。
### 技術スタック

| レイヤー | 技術 |
|---------|------|
| ランタイム | Electron 40以上 |
| UIフレームワーク | React 19 + TypeScript |
| スタイリング | Tailwind CSS + shadcn/ui |
| ステート管理 | Zustand |
| ビルド | Vite + electron-builder |
| テスト | Vitest + Playwright |
| アニメーション | Framer Motion |
| アイコン | Lucide React |

---

## コントリビューション

コミュニティからのコントリビューションを歓迎します！バグ修正、新機能、ドキュメントの改善、翻訳など、あらゆる貢献がVerse Clawをより良くするのに役立ちます。

### コントリビューション方法

1. リポジトリを**フォーク**する
2. フィーチャーブランチを**作成**する（`git checkout -b feature/amazing-feature`）
3. 明確なメッセージで変更を**コミット**する
4. ブランチに**プッシュ**する
5. **プルリクエスト**を作成する

### ガイドライン

- 既存のコードスタイルに従う（ESLint + Prettier）
- 新機能にはテストを書く
- 必要に応じてドキュメントを更新する
- コミットはアトミックかつ説明的に保つ

---

## 謝辞

Verse Clawは優れたオープンソースプロジェクトの上に構築されています：

- [OpenClaw](https://github.com/OpenClaw) – AIエージェントランタイム
- [Electron](https://www.electronjs.org/) – クロスプラットフォームデスクトップフレームワーク
- [React](https://react.dev/) – UIコンポーネントライブラリ
- [shadcn/ui](https://ui.shadcn.com/) – 美しくデザインされたコンポーネント
- [Zustand](https://github.com/pmndrs/zustand) – 軽量ステート管理

---

## コミュニティ

コミュニティに参加して、他のユーザーとつながり、サポートを受け、体験を共有しましょう。

| 企業微信 | Feishuグループ | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QRコード" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QRコード" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QRコード" /> |

### Verse Claw パートナープログラム 🚀

Verse Claw パートナープログラムを開始します。特に、カスタム AI エージェントや自動化ニーズを持つより多くの顧客に Verse Claw を紹介してくださるパートナーを募集しています。

パートナーの皆さまには、見込みユーザーや案件との接点づくりを担っていただき、Verse Claw チームは技術サポート、カスタマイズ、統合を全面的に提供します。

AI ツールや自動化に関心のある顧客とお仕事をされている方は、ぜひご一緒できればうれしいです。

詳細は DM いただくか、[public@valuecell.ai](mailto:public@valuecell.ai) までメールでご連絡ください。

---

## スター履歴

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/Verse Claw&type=Date" alt="スター履歴チャート" />
</p>

---

## ライセンス

Verse Clawは[MITライセンス](LICENSE)の下でリリースされています。本ソフトウェアの使用、変更、配布は自由に行えます。

---

<p align="center">
  <sub>ValueCell Teamが❤️を込めて開発</sub>
</p>
