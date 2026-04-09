# Mamori Inspector 仕様（確定版）

## 1. 目的
複数の静的解析・Lint・整形ツールを統合し、以下のタイミングで自動実行して開発者へ通知する。

- 保存時: 非同期で整形 → チェック（対象ファイルのみ）
- pre-commit: 整形 → 再ステージ → チェック（ステージ済み対象のみ、失敗時は通知してコミット継続）
- pre-push: チェック（ワークスペース全体、失敗時は Problems と通知を更新してプッシュ継続）
- 手動: 重いツールや全体処理の実行（将来拡張あり）

主目的は「品質」。

## 2. 対象言語
初期対応と将来拡張の前提を以下とする。

- 初期: Java
- 追加: JavaScript / TypeScript / CSS / HTML

## 3. 実行タイミング別の構成（確定）

### 3.1 保存時（on save, scope=file）
保存時検証の有効条件（確定）:
- ワークスペース単位の設定 `mamori-inspector.enabled` が `true` の場合のみ実行する
- 既定値は `false` とし、拡張コマンドで切り替える
- 保存時検証の有効化や整形のために、VS Code の `editor.defaultFormatter`、`editor.formatOnSave`、`editor.codeActionsOnSave` は自動変更しない

実行順序（確定）:
1) 整形（自動適用、非同期）
2) チェック
3) 結果を統合し、VS Code Problems（Diagnostics）に反映

- 保存時実行が一部ツール失敗で終了コード 2 となっても、生成済みの SARIF がある場合は、その時点までの Diagnostics を Problems に反映し、失敗詳細はログへ残す
- 保存時検証では、対象ファイルに対して実際に開始した formatter / checker ごとに、ファイル名と単一ツール名だけをステータスバーへ表示する

整形:
- Java: Spotless（ビルド定義検出できる場合のみ）
- JavaScript / TypeScript direct file: `eslint --fix` を Prettier の代わりに実行する（明示設定 → discovery → `package.json#eslintConfig` を利用できる場合のみ。HTML 内 inline script は対象外）
- JavaScript fallback / CSS / HTML: Prettier

チェック:
- Java: Checkstyle / PMD / Semgrep
- JavaScript: ESLint（明示設定 → discovery → `package.json#eslintConfig` を優先し、無ければ Mamori 同梱の最小設定を使用）
- TypeScript: ESLint（明示設定 → discovery → `package.json#eslintConfig` を優先し、TypeScript では Mamori 同梱の JavaScript 向け最小設定は使用しない）
- HTML 内 inline script: ESLint（対象は `src` なしで JavaScript と判定されたものに限る。設定解決は明示設定 → discovery → `package.json#eslintConfig` → Mamori 同梱の最小設定。HTML 本体は引き続き htmlhint）
- CSS: Stylelint（明示設定 → discovery → `package.json#stylelint` を優先し、無ければ Mamori 同梱の最小設定を使用）
- HTML 内 inline style: Stylelint（対象は CSS と判定されたものに限る。設定解決は明示設定 → discovery → `package.json#stylelint` → Mamori 同梱の最小設定。HTML 本体は引き続き htmlhint）
- HTML: htmlhint（明示設定 → discovery → `package.json#htmlhint` を優先し、無ければ Mamori 同梱の最小設定を使用）

HTML inline script の扱い（確定）:
- `src` を持たない inline script のみを一時 JavaScript ファイルへ抽出して ESLint 実行対象に含める
- `type` が未指定、空文字、`module`、または `text/javascript`、`application/javascript`、`application/ecmascript` など JavaScript MIME type の場合のみ対象に含める
- `text/javascript; charset=utf-8` のような parameter 付き JavaScript MIME type は parameter を除去して判定する
- `text/plain` など JavaScript 以外の `type` を持つ inline script は対象外とする
- `type="module"` は一時 `.mjs` ファイルとして抽出する
- ESLint の診断位置は元の HTML 位置へ逆写像する
- 一時ファイルは各実行後に削除する

HTML inline style の扱い（確定）:
- CSS と互換な `type` を持つ inline style のみを一時 CSS ファイルへ抽出して Stylelint 実行対象に含める
- `type` が未指定、空文字、`text/css`、または `text/css; ...` の場合のみ対象に含める
- CSS 以外の `type` を持つ inline style は対象外とする
- Stylelint の診断位置は元の HTML 位置へ逆写像する
- 一時ファイルは各実行後に削除する

保存時の非同期整形仕様（確定）:
- 保存操作をブロックしない（保存完了後にバックグラウンドで処理）
- 保存が連続した場合はデバウンスし、最新状態のみを処理（古いジョブはキャンセル）
- 自動整形による更新を識別し、無限ループを防止する

### 3.2 pre-commit（scope=staged、失敗時は通知して継続）
実行順序（確定）:
1) 整形（自動適用）
2) 整形で変更があれば自動で再ステージ（git addし直す）
3) チェック

整形:
- Java: Spotless（可能なら）
- JavaScript / TypeScript direct file: `eslint --fix` を Prettier の代わりに実行する（明示設定 → discovery → `package.json#eslintConfig` を利用できる場合のみ。HTML 内 inline script は対象外）
- JavaScript fallback / CSS / HTML: Prettier

チェック:
- Java: Checkstyle / PMD / Semgrep
- JavaScript: ESLint（明示設定 → discovery → `package.json#eslintConfig` を優先し、無ければ Mamori 同梱の最小設定を使用）
- TypeScript: ESLint（明示設定 → discovery → `package.json#eslintConfig` を優先し、TypeScript では Mamori 同梱の JavaScript 向け最小設定は使用しない）
- HTML 内 inline script: ESLint（対象は `src` なしで JavaScript と判定されたものに限る。設定解決は明示設定 → discovery → `package.json#eslintConfig` → Mamori 同梱の最小設定。HTML 本体は引き続き htmlhint）
- CSS: Stylelint（明示設定 → discovery → `package.json#stylelint` を優先し、無ければ Mamori 同梱の最小設定を使用）
- HTML 内 inline style: Stylelint（対象は CSS と判定されたものに限る。設定解決は明示設定 → discovery → `package.json#stylelint` → Mamori 同梱の最小設定。HTML 本体は引き続き htmlhint）
- HTML: htmlhint（明示設定 → discovery → `package.json#htmlhint` を優先し、無ければ Mamori 同梱の最小設定を使用）

pre-commit の通知仕様（確定）:
- managed pre-commit が終了コード 1 または 2 で失敗した場合、runner は最新結果メタデータを `.mamori/out/latest-precommit-result.json` へ保存する
- VS Code 拡張は最新結果を検知した場合、staged 内容とエディタ表示内容の差異を考慮して Problems は自動更新せず、Output を開く、または手動ワークスペースチェックを実行する選択肢付き通知を表示する
- managed pre-commit が成功した場合、runner は同じ結果メタデータを成功状態で更新し、拡張は古い失敗通知を再利用しない

### 3.3 pre-push（scope=workspace、失敗時は通知して継続）
チェック（デフォルト有効）:
- Java: Checkstyle / PMD / Semgrep / CPD / SpotBugs
- JavaScript: ESLint（デフォルト有効・設定でOFF可。設定解決は明示設定 → discovery → `package.json#eslintConfig` → Mamori 同梱の最小設定）
- TypeScript: ESLint（設定解決は明示設定 → discovery → `package.json#eslintConfig`。TypeScript では Mamori 同梱の JavaScript 向け最小設定は使用しない）
- HTML 内 inline script: ESLint（デフォルト有効・設定でOFF可。対象は `src` なしで JavaScript と判定されたものに限る。設定解決は明示設定 → discovery → `package.json#eslintConfig` → Mamori 同梱の最小設定。HTML 本体は引き続き htmlhint）
- CSS: Stylelint（デフォルト有効・設定でOFF可。設定解決は明示設定 → discovery → `package.json#stylelint` → Mamori 同梱の最小設定）
- HTML 内 inline style: Stylelint（デフォルト有効・設定でOFF可。対象は CSS と判定されたものに限る。設定解決は明示設定 → discovery → `package.json#stylelint` → Mamori 同梱の最小設定。HTML 本体は引き続き htmlhint）
- HTML: htmlhint（デフォルト有効・設定でOFF可。設定解決は明示設定 → discovery → `package.json#htmlhint` → Mamori 同梱の最小設定）

SpotBugsの例外仕様（確定）:
- class files（例: `target/classes` や `build/classes/java/main`）が見つからない場合は警告ログを出してスキップし、pushは継続する

pre-push の通知仕様（確定）:
- managed pre-push が終了コード 1 で失敗した場合、runner は最新結果メタデータを `.mamori/out/latest-prepush-result.json` へ保存する
- VS Code 拡張は最新結果を検知した場合、生成済み SARIF があれば Problems を更新し、pre-push チェック失敗と Problems 確認を促す warning 通知を表示する
- managed pre-push が終了コード 2 で失敗した場合も、生成済み SARIF があれば Problems を更新し、Problems と Output Channel の確認を促す error 通知を表示する
- managed pre-push が成功した場合、runner は同じ結果メタデータを成功状態で更新し、拡張は以前の pre-push 由来 Diagnostics を消去できるようにする

### 3.4 手動（manual、将来対応あり）
現行実装:
- Java: Checkstyle / PMD / Semgrep の軽量チェックを実行する
- JavaScript / TypeScript: ESLint を実行する
- CSS: Stylelint を実行する
- HTML: htmlhint を実行し、inline script は ESLint、inline style は Stylelint で追加検査する
- Web 系ツールの設定解決と inline HTML の扱いは pre-push と同じとする
- manual 実行開始時は、開始を知らせる短時間のトースト通知を表示する
- 保存時と manual 実行の静的解析進捗表示はステータスバーへ統一する
- 拡張の manual 実行が成功した場合、同一ワークスペースに対して反映済みの保存時 Diagnostics は、manual の最新結果で置き換える

優先実装:
- OWASP Dependency-Check
- Trivy

将来対応（導入難易度が高いもの）:
- Error Prone
- CodeQL
- PiTest
- ArchUnit
- CK Metrics
- JDepend

## 4. 実行エンジン構成

ランナーのファイル構成は [docs/runner-structure.md](docs/runner-structure.md) を参照。

### 4.1 共通Nodeランナー（VS Code/フック共通）
リポジトリ内に `.mamori/` を置き、VS Code拡張とgit hooksが同じランナーを呼ぶ。

- 目的: VS Code外（git hooks）でも確実に同じ処理を実行する
- 前提: 通常の git hooks 検証には Node が必要だが、管理対象 hook は解決した `node` コマンドが利用できない場合に warning を出して成功終了する
- 拡張の `hooks install` と `setup` は、同梱 runner の静的 runtime をワークスペース直下の `.mamori/` へ同期してから実行する
- 拡張の activate 時と workspace 追加時は、既に `.mamori/` が存在するワークスペースに対して同梱 runner の静的 runtime を best-effort で再同期する
- 同期する `.mamori/` には `type: commonjs` を持つ `package.json` を含め、導入先ワークスペースの `package.json#type` に依存せず runner を CommonJS として起動できるようにする
- `setup` と `run --execute` では、ワークスペースが Git リポジトリであれば、ローカルの `.git/info/exclude` へワークスペースルートの `/.mamori/` と、リポジトリ配下で見つかった repo-relative な nested `.mamori` を best-effort で追加する
- `.git/info/exclude` の更新失敗は warning として扱い、Mamori の処理自体は継続する

終了コード（確定）:
- 0: 成功（fail対象の指摘なし、または「スキップ許容」のみ）、または pre-commit / pre-push の managed 実行で結果を通知して継続した場合
- 1: ルール違反あり（save/manual など停止対象の実行ではこの終了コードを返し、pre-commit / pre-push の managed 実行では結果メタデータへ保持する）
- 2: 実行エラー（ツールDL失敗、依存不足など。save/manual など停止対象の実行ではこの終了コードを返し、pre-commit / pre-push の managed 実行では結果メタデータへ保持する）

### 4.2 結果フォーマット
- SARIFを統合フォーマットの軸とする
- 直接SARIFを出せないツールは結果をパースしてSARIFに変換する
- 統合SARIF（例: `combined.sarif`）を生成し、VS Code Problemsに反映する

## 5. ツール配布・自動導入（確定）

### 5.1 Java系・単体CLI（自動ダウンロード＋検証＋キャッシュ）
- 公式配布物を自動取得し、sha256検証したうえでキャッシュする
- バージョンはpin固定（更新は拡張更新で実施）
- オフライン時はキャッシュがあれば実行、無ければ失敗（明確な案内）

Java 17互換のpin例:
- Checkstyle: 12.3.1（13系はJava 21要件のため避ける）
- PMD(+CPD): 7.21.0
- SpotBugs: 4.9.8
- Semgrep: 1.151.0（`.semgrep.yml`が無ければ `p/java` を既定）
- Dependency-Check: 12.2.0（手動枠）
- Trivy: 0.69.1（手動枠）

### 5.2 Node系（Prettier / ESLint / Stylelint / htmlhint）
- `.mamori/node/` に「本体のみ」を自動導入する（pin固定）
- 初回実行時に自動でインストールする
- ネット制限環境向けに、セットアップコマンドで明示的にインストールも可能にする

実行の優先順位（確定）:
1) プロジェクト `node_modules` が存在し、設定も解決できる場合はそれを使用（最も整合性が高い）
2) 1が満たせない場合は `.mamori/node` の本体で実行を試みる（ただしプラグイン必須設定では失敗し得る）

## 6. 設定ファイル解決（確定）

### 6.1 優先順位
1) 明示指定（Mamori設定 / VS Code設定）
2) ビルド定義から抽出（Maven/Gradle）
3) 探索（慣習ディレクトリ＋軽いglob）
4) 組み込みデフォルト

### 6.2 ビルド定義からの抽出
- Maven: `pom.xml` から該当plugin設定を抽出し、モジュール単位で解決
- Gradle: `build.gradle` / `build.gradle.kts` はヒューリスティックで抽出（取れなければフォールバック）

### 6.3 Semgrep
- `.semgrep.yml` があればそれを使用
- 無ければ `p/java` 固定

### 6.4 ESLint / Stylelint / htmlhint
- 明示設定 → discovery → `package.json` 設定 → 組み込みデフォルト の順で解決する
- 設定ファイルや `package.json` 設定が無い場合でも、Mamori 同梱の最小 ESLint / Stylelint / htmlhint 設定で有効化する
- ESLint の組み込み最小設定は互換性を優先し、core rule のみで構成する
- HTML の inline script は ESLint 設定解決後に抽出・実行する
- HTML の inline style は Stylelint 設定解決後に抽出・実行する
- HTML の inline script / inline style 抽出に使う一時ファイルは、ワークスペースルート直下の `.mamori-inline-tmp/` に作成し、各実行後に削除する
- 設定検出例:
  - ESLint: `eslint.config.*`、`.eslintrc*`、`package.json#eslintConfig`
  - Stylelint: `stylelint.config.*`、`.stylelintrc*`、`package.json#stylelint`
  - htmlhint: `.htmlhintrc*`、`package.json#htmlhint`

## 7. マルチモジュール対応（確定）
- pre-push/manualは「各モジュールごとに設定解決して実行」
- 保存時は「保存ファイルから最寄りのモジュール定義を探索して実行」

## 8. 除外ルール（確定）
- デフォルト除外はソース列挙（Checkstyle/PMD/Semgrep/CPD等）にのみ適用
- デフォルト除外例:
  - `**/.git/**`
  - `**/.mamori/**`
  - `**/.mamori-inline-tmp/**`
  - `**/node_modules/**`
  - `**/target/**`
  - `**/build/**`
  - `**/dist/**`
  - `**/out/**`
  - `**/.gradle/**`

SpotBugsのclass探索は別系統（除外に巻き込まない）:
- 探索候補: `**/target/classes`、`**/build/classes/java/main`

Git のローカル除外（確定）:
- `setup` と `run --execute` は、ワークスペースが Git リポジトリであれば、ローカルの `.git/info/exclude` へワークスペースルートの `/.mamori/` と、リポジトリ配下で見つかった repo-relative な nested `.mamori` を best-effort で追加する
- `setup` と `run --execute` は、ワークスペースルートの `/.mamori-inline-tmp/` もローカルの `.git/info/exclude` へ best-effort で追加する
- これはリポジトリ共有の `.gitignore` を変更しない
- 既に Git で追跡されているファイルには影響しない

## 9. Git hooks（確定）
- pre-commit / pre-push のhookを生成して、Nodeランナーを呼ぶ
- managed hook は runner の実行結果を結果メタデータへ保存したうえで、問題や実行エラーがあっても warning を出して成功終了する
- 管理対象 hook は、`$REPO_ROOT/.mamori/mamori.js` が見つからない場合に stderr へ warning を出して成功終了する
- 管理対象 hook は、解決した `node` コマンドが利用できない場合も stderr へ warning を出して成功終了する
- runner が存在する通常ケースでも、managed hook は runner の最新結果メタデータを VS Code 拡張へ受け渡し、Git 操作自体は継続する

Git hooks の競合時仕様（確定）:
- `pre-commit` または `pre-push` が既に存在し、Mamori が生成した管理対象hookでない場合は上書きしない
- 上書きしなかった hook はそのまま保持し、install は他の対象 hook の処理を継続する
- uninstall は Mamori 管理対象hookのみ削除し、手動作成された hook は削除しない
- 競合や未削除があった場合は warning として扱い、CLI 標準出力と VS Code 拡張の通知で理由を表示する

warning の例:
- `pre-commit already exists and was left unchanged`
- `pre-push already exists and was left unchanged`
- `pre-commit is not managed by Mamori Inspector and was left unchanged`
- `pre-push is not managed by Mamori Inspector and was left unchanged`

## 10. コマンド（拡張が提供）
- ワークスペース単位の保存時検証 有効化 / 無効化
- セットアップ（Java系ツールDL、`.mamori/node` のnpm導入を明示実行）
- Git hooks インストール / アンインストール
- 手動全体チェック（manual）
- キャッシュ削除（`.mamori/tools` / `.mamori/node`）

コマンドの設定変更範囲（確定）:
- `Enable In Workspace` / `Disable In Workspace` が変更するのは `mamori-inspector.enabled` のみとする
- VS Code の `editor.defaultFormatter`、`editor.formatOnSave`、`editor.codeActionsOnSave` は Mamori Inspector のコマンドから自動変更しない

Git hooks コマンドの通知仕様（確定）:
- install / uninstall が成功した場合は情報通知を表示する
- 競合や未変更 hook がある場合は成功通知に加えて warning 通知を表示する
- warning は CLI の `mamori: hooks warnings=...` 行から拡張側で抽出し、Output Channel にも記録する

## 11. 今後の拡張
- 手動ツールの追加（Dependency-Check/Trivyの取り込み強化、結果の詳細ビュー）
- Python等への拡張
- Gradle Kotlin DSLの設定抽出精度向上（必要になった時点で対応）
