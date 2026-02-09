# Mamori Inspector 仕様（確定版）

## 1. 目的
複数の静的解析・Lint・整形ツールを統合し、以下のタイミングで自動実行して品質ゲートを提供する。

- 保存時: 非同期で整形 → チェック（対象ファイルのみ）
- pre-commit: 整形 → 再ステージ → チェック（ステージ済み対象のみ、失敗でコミット停止）
- pre-push: チェック（ワークスペース全体、失敗でプッシュ停止）
- 手動: 重いツールや全体処理の実行（将来拡張あり）

主目的は「品質」。

## 2. 対象言語
初期対応と将来拡張の前提を以下とする。

- 初期: Java
- 追加: JavaScript / CSS / HTML

## 3. 実行タイミング別の構成（確定）

### 3.1 保存時（on save, scope=file）
実行順序（確定）:
1) 整形（自動適用、非同期）
2) チェック
3) 結果を統合し、VS Code Problems（Diagnostics）に反映

整形:
- Java: Spotless（ビルド定義検出できる場合のみ）
- JavaScript/CSS/HTML: Prettier

チェック:
- Java: Checkstyle / PMD / Semgrep
- JavaScript: ESLint（設定がある場合のみ）
- CSS: Stylelint（設定がある場合のみ）
- HTML: htmlhint（設定がある場合のみ）

保存時の非同期整形仕様（確定）:
- 保存操作をブロックしない（保存完了後にバックグラウンドで処理）
- 保存が連続した場合はデバウンスし、最新状態のみを処理（古いジョブはキャンセル）
- 自動整形による更新を識別し、無限ループを防止する

### 3.2 pre-commit（scope=staged、失敗でブロック）
実行順序（確定）:
1) 整形（自動適用）
2) 整形で変更があれば自動で再ステージ（git addし直す）
3) チェック

整形:
- Java: Spotless（可能なら）
- JavaScript/CSS/HTML: Prettier

チェック:
- Java: Checkstyle / PMD / Semgrep
- JavaScript: ESLint（設定がある場合のみ）
- CSS: Stylelint（設定がある場合のみ）
- HTML: htmlhint（設定がある場合のみ）

### 3.3 pre-push（scope=workspace、失敗でブロック）
チェック（デフォルト有効）:
- Java: Checkstyle / PMD / Semgrep / CPD / SpotBugs
- JavaScript: ESLint（設定がある場合のみ、デフォルト有効・設定でOFF可）
- CSS: Stylelint（設定がある場合のみ、デフォルト有効・設定でOFF可）
- HTML: htmlhint（設定がある場合のみ、デフォルト有効・設定でOFF可）

SpotBugsの例外仕様（確定）:
- class files（例: `target/classes` や `build/classes/java/main`）が見つからない場合は警告ログを出してスキップし、pushは継続する

### 3.4 手動（manual、将来対応あり）
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
- 前提: Node必須（git hooksでも必須）

終了コード（確定）:
- 0: 成功（fail対象の指摘なし、または「スキップ許容」のみ）
- 1: ルール違反あり（ゲート失敗）
- 2: 実行エラー（ツールDL失敗、依存不足など。ゲート失敗）

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
- 設定が見つかった時だけ有効化（無ければスキップ）
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
  - `**/node_modules/**`
  - `**/target/**`
  - `**/build/**`
  - `**/dist/**`
  - `**/out/**`
  - `**/.gradle/**`

SpotBugsのclass探索は別系統（除外に巻き込まない）:
- 探索候補: `**/target/classes`、`**/build/classes/java/main`

## 9. Git hooks（確定）
- pre-commit / pre-push のhookを生成して、Nodeランナーを呼ぶ
- 失敗時はブロック（ただし `--no-verify` で回避可能）

## 10. コマンド（拡張が提供）
- セットアップ（Java系ツールDL、`.mamori/node` のnpm導入を明示実行）
- Git hooks インストール / アンインストール
- 手動全体チェック（manual）
- キャッシュ削除（`.mamori/tools` / `.mamori/node`）

## 11. 今後の拡張
- 手動ツールの追加（Dependency-Check/Trivyの取り込み強化、結果の詳細ビュー）
- TypeScript/Python等への拡張
- Gradle Kotlin DSLの設定抽出精度向上（必要になった時点で対応）
