# Changelog

このファイルには、mamori-inspector の利用者に影響する主要な変更を記録します。

形式は Keep a Changelog を参考にしつつ、このリポジトリの実装状況に合わせて整理します。

## [Unreleased]

## [0.2.10] - 2026-04-04

### Fixed
- 手動 workspace 実行で付与された Diagnostics が、同じファイルの保存時再検査で解消したあとも Problems に残り続ける問題を修正しました。

## [0.2.9] - 2026-04-03

### Added
- manual/workspace で既存 PMD レポートを再利用する回帰テストを追加しました。

### Fixed
- manual/workspace 実行で、PMD が終了コード 1 を返して標準出力が空でも、既存の `target/pmd.xml` から finding を取り込めるようにしました。

## [0.2.8] - 2026-04-03

### Added
- ワークスペースフォルダー単位で保存時検証を有効化・無効化する `Enable In Workspace` / `Disable In Workspace` コマンドを追加しました。
- Mamori Inspector の有効状態をワークスペース設定として保持する回帰テストを追加しました。

### Changed
- 保存時検証の既定値を無効に変更し、対象ワークスペースで明示的に有効化した場合のみ実行するようにしました。
- README、README.ja、仕様書を、ワークスペース単位の有効化フローに合わせて更新しました。

## [0.2.7] - 2026-04-01

### Added
- 管理対象 Node ツールの setup 回帰をまとめて確認する `npm run test:managed-tools` を追加しました。
- setup 時の npm 起動失敗と、個別ツール導入失敗を検証する回帰テストを追加しました。

### Fixed
- `Mamori Inspector: Setup Managed Tools` の失敗時に、汎用メッセージではなく子プロセスの詳細エラーを表示するようにしました。
- 管理対象 Node ツールの自動導入をツール単位へ見直し、失敗したツール名をエラーメッセージへ含めるようにしました。

## [0.2.6] - 2026-04-01

### Added
- Windows で空白を含む npm 実行パスを使った setup 回帰テストを追加しました。

### Fixed
- `Mamori Inspector: Setup Managed Tools` で、`C:\Program` がコマンドとして解釈されて失敗する問題を解消しました。
- Windows の `.cmd` / `.bat` 実行を見直し、管理対象 Node ツールの自動導入が空白を含む実行パスでも継続できるようにしました。

## [0.2.5] - 2026-04-01

### Changed
- Windows で管理配布物の zip 展開を行う際、PowerShell の引数解決に依存しない実行方式へ変更しました。

### Fixed
- `Mamori Inspector: Setup Managed Tools` などの管理ツール準備で、`Expand-Archive` の `LiteralPath` が空扱いになって失敗する問題を解消しました。
- Windows の管理配布物テストを zip 展開経路込みで検証するようにし、Maven と Gradle の自動導入回帰を防ぐようにしました。

## [0.2.4] - 2026-04-01

### Added
- 管理対象ツールの事前セットアップとキャッシュ削除を行う `setup` / `cache-clear` CLI と VS Code コマンドを追加しました。
- Maven、Gradle、Semgrep、Prettier、ESLint、Stylelint、htmlhint の自動導入とキャッシュ配置を確認する回帰テストを追加しました。

### Changed
- README、README.ja に、管理ツールの自動導入先、優先順位、セットアップ手順を追記しました。
- 手動実行失敗時の VS Code 通知で、CLI が出力した warning の詳細を利用者へ表示するようにしました。

### Fixed
- `mvn`、`gradle`、Node 系 checker、Semgrep が見つからない環境でも、実行前に必要な管理ツールを導入して継続できるようにしました。
- 実行不要なコマンドで先に自動導入が走ってしまう問題を解消し、HTML 系チェックの回帰を防ぐようにしました。

## [0.2.3] - 2026-04-01

### Added
- 追加ワークスペースに含まれる外部 Java プロジェクトの PMD finding を、手動 workspace 実行で Problems に反映する結合テストを追加しました。

### Changed
- 手動 workspace 実行を multi-root 対応にし、存在しないワークスペースを除外しながら各フォルダーの結果を集約するようにしました。
- VS Code 統合テストの隔離実行設定と引数転送を見直し、個別テスト実行でも安定して再現できるようにしました。

### Fixed
- 対象ワークスペースにローカル runner が無い場合でも、拡張同梱 runner にフォールバックして実行できるようにしました。
- 手動実行と hooks 管理で対象ワークスペース解決を改善し、`Code.exe ENOENT` や削除済みフォルダー起因の失敗を防ぐようにしました。

## [0.2.2] - 2026-03-31

### Added
- TypeScript を ESLint の保存時チェック対象に含める CLI テストと拡張結合テストを追加しました。
- Maven の Checkstyle、PMD、CPD、SpotBugs が既定レポートファイル出力でも SARIF と Problems に反映される回帰テストを追加しました。

### Changed
- README、README.ja、仕様書を、TypeScript の保存時チェック条件と bundled fallback の扱いに合わせて更新しました。

### Fixed
- Maven 系ツールで stdout に結果が出ない場合でも、更新された既定レポートファイルから finding を取り込めるようにしました。
- TypeScript ファイルを保存時トリガーと VS Code 拡張の起動条件に含め、ESLint 設定がある場合に Problems へ反映されるようにしました。

## [0.2.1] - 2026-03-31

### Added
- manual/workspace で Checkstyle finding が Problems に反映される拡張結合テストを追加しました。
- prepush/workspace で Checkstyle finding が SARIF に含まれることを確認する CLI 統合テストを追加しました。

### Fixed
- SARIF ファイルが未生成の場合でも、拡張が読み込みエラーで失敗せず空の finding として扱うようにしました。
- 保存時と手動実行の Diagnostics 反映に関する回帰テストを補強しました。

## [0.2.0] - 2026-03-23

### Added
- Web checker の設定ファイルが無い場合でも動作する bundled minimal ESLint、Stylelint、htmlhint 設定を追加しました。
- bundled fallback 設定、root と nested module の共存、Windows 実行経路を含む回帰テストを追加しました。

### Changed
- Web checker の設定解決順序を、明示設定、検出設定、`package.json` 設定、bundled minimal config に統一しました。
- README、README.ja、仕様書を、bundled fallback と HTML inline check の挙動に合わせて更新しました。
- 拡張テストを utility suite と integration suite に分離し、通常テストと統合テストの責務を整理しました。

### Fixed
- Windows で `PATH` と `Path` の両方を考慮して Web checker を解決できるようにしました。
- nested module がある workspace でも、root 側の Web ファイルを fallback module として計画できるようにしました。
- 統合テストで pending になっていた JavaScript 保存時検証と hooks 検証を安定して通るようにしました。

## [0.1.0] - 2026-03-23

### Added
- HTML 内の inline script を ESLint の対象に追加しました。save、pre-commit、pre-push の各経路で、一時ファイルへ抽出して元の HTML 位置へ診断を逆写像します。
- HTML 内の inline style を Stylelint の対象に追加しました。save、pre-commit、pre-push の各経路で、一時ファイルへ抽出して元の HTML 位置へ診断を逆写像します。
- HTML inline script と inline style の逆写像、temporary file cleanup、staged HTML の再ステージ、package.json 設定継承、module script、MIME type 境界を確認する回帰テストを追加しました。

### Changed
- Web 向けの実行計画で HTML を ESLint / Stylelint の入力候補に含め、HTML 本体は htmlhint、埋め込み JS/CSS はそれぞれ ESLint / Stylelint に分担するようにしました。
- README、README.ja、仕様書に、HTML 内の JS / CSS チェック対象、除外条件、診断位置の扱いを追記しました。
- CHANGELOG を、未整備の雛形から実際の変更内容を記録する形式へ作り直しました。

### Fixed
- HTML の `script` / `style` 属性値に `>` を含む場合でも、本文抽出位置を誤らないようにしました。
- HTML inline script の `type="module"` を `.mjs` 一時ファイルとして処理するようにしました。
- `text/javascript; charset=utf-8`、`application/javascript; charset=utf-8`、`application/ecmascript; charset=utf-8` のような parameter 付き MIME type を正しく JavaScript と判定するようにしました。
- Stylelint が JSON を stderr に出力するケースでも、HTML inline style の finding を取り込めるようにしました。
- package.json の `eslintConfig` と `stylelint` 設定を、HTML から抽出した一時ファイル実行時にも解決できるようにしました。

## [0.0.1]

### Added
- VS Code 拡張としての Mamori Inspector の基本構成を追加しました。
- save、pre-commit、pre-push、manual の実行モードと、SARIF による結果統合の基盤を追加しました。
- Java、JavaScript、CSS、HTML を対象とした初期の実行計画と、Git hook 管理コマンドを追加しました。