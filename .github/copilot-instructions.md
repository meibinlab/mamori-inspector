# Mamori Inspector の Copilot 指示

## プロジェクト概要
- Mamori Inspector は VS Code 拡張とリポジトリ内ランナーで構成され、複数の品質ツールを統合して SARIF で報告する。
- 公式仕様は [../docs/spec.md](../docs/spec.md)。変更は必ず仕様に整合させる。
- 現状は仕様と README 以外に実装ファイルがない。

## アーキテクチャ（予定）
- `.mamori/` 配下の Node ランナーが VS Code と git hooks の共通実行エンジン。
- 結果は SARIF に正規化し、VS Code Problems に反映する。
- ツール配布物は `.mamori/tools/` に固定バージョンで取得・検証・キャッシュする。
- Node 系ツール（Prettier/ESLint/Stylelint/htmlhint）は初回実行時に `.mamori/node/` へ導入する。

## 実行モデル
- 保存時: 非同期で整形 → 保存したファイルのみチェック（非ブロッキング、デバウンス、再帰防止）。
- pre-commit: 整形 → 再ステージ → ステージ済みのみチェック。失敗でブロック。
- pre-push: ワークスペース全体をチェック。失敗でブロック。SpotBugs は class が無ければ警告スキップ。
- 手動: 重いツール（Dependency-Check/Trivy から着手、他は将来）。

## ツール運用ルール（勝手に変更しない）
- Java: 保存時 + pre-commit で Checkstyle/PMD/Semgrep。pre-push で CPD/SpotBugs を追加。
- Web: ESLint/Stylelint/htmlhint は設定検出時のみ実行。pre-push 既定 ON。
- TypeScript: ESLint を用いてコードチェックを行う。
- Semgrep は `.semgrep.yml` があれば使用。無ければ `p/java` のみ。
- SpotBugs は class ルート（例: `target/classes`, `build/classes/java/main`）を使い、無ければ警告してスキップ。

## 設定解決の優先順位
- 明示設定 → ビルド定義（Maven/Gradle） → ヒューリスティック探索 → 組み込みデフォルト。
- 除外 glob はソース列挙のみに適用し、SpotBugs の class 探索には適用しない。

## 実装上の注意
- ランナーの終了コードは固定: 0 OK, 1 ルール違反, 2 実行エラー。
- ESLint/Stylelint/htmlhint はプロジェクトの `node_modules` を優先し、なければ `.mamori/node` にフォールバック。
- 保存時整形は非ブロッキングで、自己再帰を防止する。

## コーディング規約（本プロジェクト固有）
- 設定解決の優先順位（明示 → ビルド定義 → 探索 → デフォルト）を崩さない。
- 除外 glob はソース列挙のみに適用し、SpotBugs の class ルート探索には適用しない。
- ツール実行結果は必ず SARIF に正規化し、Problems に反映する流れを維持する。
- pre-commit の整形は再ステージまでを一連の処理として実装する。
- Google Style に準拠する。
- TypeScript は Google TypeScript Style に準拠する。
- 関数、インタフェース、変数およびその引数と戻り値は必ずコメントを記載する。
- コメントは必ず日本語で記載する。

## 参照先
- 仕様: [../docs/spec.md](../docs/spec.md)
- 概要: [../README.md](../README.md)

# AIチャット運用

- 回答は日本語で、簡潔・丁寧・実務的に行う。
- 質問の対象範囲にのみ回答し、不要な背景説明は省略する。
- コード変更前に「変更計画（3ステップ以内）」を提示する。
- 不明点や確証がない点は明示し、推測で断定しない。
- 参照元は `README.md` と `doc/` を最優先とする。
- 利用可能な MCP サーバーがある場合は、まず MCP で情報取得・確認を行う。
- 回答時は、使用した MCP サーバー名を先に示す（未使用時は不要）。
- ファイル確認は `filesystem`、API確認は `http`、ブラウザ確認は `playwright` を優先する。
- シンボル単位の調査・影響範囲確認・複数ファイル編集が必要な場合は `serena` を優先して使用する。
- MCP 実行が失敗した場合は 1 回再試行し、不可なら代替手段で継続する。
