# Changelog

このファイルには、mamori-inspector の利用者に影響する主要な変更を記録します。

形式は Keep a Changelog を参考にしつつ、このリポジトリの実装状況に合わせて整理します。

## [0.2.29] - 2026-04-07

### Fixed
- Linux の最小 PATH 条件で managed Maven / Gradle 自動導入テストの wrapper がログ出力先を解決できない問題を修正しました。

## [0.2.28] - 2026-04-06

### Changed
- subtree として公開する standalone リポジトリ側でも VSIX を Git 管理対象に含めないよう、subtree 配下の `.gitignore` に `*.vsix` を追加しました。

## [0.2.27] - 2026-04-06

### Added
- VS Code 拡張と VSIX に表示される Mamori Inspector のロゴアイコンを追加しました。

## [0.2.26] - 2026-04-06

### Fixed
- ローカルディレクトリを managed tool ソースとして使う場合に、Maven / Gradle 配布物の中身をバージョンディレクトリ直下へ正しく展開するようにし、自動導入後の実行ファイル配置が Linux CI でも期待どおりになるよう修正しました。
- `cache-clear` が `.mamori/tools` 自体を削除せず親ディレクトリを残していたため、管理ツールキャッシュを完全に消去できるよう修正しました。
- 実行コマンド起動失敗の CLI 回帰テストを、自動導入仕様と両立する起動不能条件で確認するよう安定化しました。

## [0.2.25] - 2026-04-06

### Fixed
- `Run Workspace Check` と `manual/workspace` の Web 系ファイル探索で `.vscode-test` 配下の VS Code テスト配布物まで対象に含めていたため、不要に巨大な検査対象が組み立てられる問題を修正しました。

### Added
- `.vscode-test` 配下が workspace Web 検査の対象外であることを確認する CLI 回帰テストを追加しました。

## [0.2.24] - 2026-04-06

### Fixed
- VSIX から `manual/workspace` 実行に必要な `.mamori/tools/*.js` が除外されていたため、インストール後の `Run Workspace Check` で CLI が起動できない問題を修正しました。

### Changed
- VSIX では `.mamori/tools` 配下の実装ファイルを含めつつ、ダウンロード済みツール本体やキャッシュだけを引き続き除外するようにしました。

## [0.2.23] - 2026-04-06

### Fixed
- `manual/workspace` 実行の開始前に古い `combined.sarif` を削除し、最新の手動実行で再生成されなかった stale な manual SARIF を再利用しないようにしました。
- 手動全体チェック成功時のトースト件数を、保持済み Diagnostics 全体ではなく今回の手動実行で得られた件数だけで表示するようにしました。

### Added
- stale な manual SARIF が残っていても手動全体チェックで再利用しないことを確認する拡張回帰テストを追加しました。

## [0.2.22] - 2026-04-06

### Changed
- `manual/workspace` が、軽量な Java チェックに加えてワークスペース全体の ESLint、Stylelint、htmlhint も実行するようにしました。
- 手動全体チェック成功時に、同一ワークスペースへ反映済みの保存時 Diagnostics を最新の手動結果で置き換えるようにしました。

### Added
- manual/workspace の Web checker 実行と、JavaScript の stale save Diagnostics 置換を確認する CLI / 拡張回帰テストを追加しました。

## [0.2.21] - 2026-04-06

### Fixed
- 手動全体チェック成功時に、同一ワークスペースへ残っていた古い Java 保存時 Diagnostics を最新の手動結果で置き換えるようにしました。
- 空結果の手動全体チェック後に stale な save Diagnostics が Problems へ残らないことを確認する拡張回帰テストを追加しました。

## [0.2.20] - 2026-04-06

### Fixed
- 管理対象の Git hook が `$REPO_ROOT/.mamori/mamori.js` を見つけられない場合でも、stderr に warning を出して成功終了するようにしました。
- 管理対象の Git hook で、解決した `node` コマンドが利用できない場合も warning を出して成功終了するようにしました。
- runner 欠落時の安全終了と、通常時に runner の終了コードを返すことを確認する CLI 回帰テストを追加しました。

## [0.2.19] - 2026-04-06

### Fixed
- `setup` と `run --execute` で、ワークスペースルートの `/.mamori/` に加えて、リポジトリ配下で見つかった repo-relative な nested `.mamori` もローカルの `.git/info/exclude` へ best-effort で追加するようにしました。
- nested `.mamori` の追記、探索除外、既存 root 追記の回帰を確認する CLI テストを追加しました。

## [0.2.18] - 2026-04-06

### Fixed
- VSIX パッケージにワークスペースの `.mamori/tools` と `.mamori/node` が同梱されないよう `.vscodeignore` を更新しました。

## [0.2.17] - 2026-04-06

### Added
- `setup` と `run --execute` で、ワークスペースが Git リポジトリの場合にローカルの `.git/info/exclude` へ `/.mamori/` を best-effort で追加するようにしました。
- `.git/info/exclude` への追記と冪等性を確認する CLI 回帰テストを追加しました。

### Changed
- `Mamori Inspector: Setup Managed Tools` 成功時に warning があれば、成功通知に加えて warning 通知も表示するようにしました。

## [0.2.16] - 2026-04-05

### Added
- 外部実プロジェクトを使い、Java 保存時に Spotless、Checkstyle、PMD、Semgrep の個別トーストが表示されることを確認する結合テストを追加しました。

### Fixed
- 外部 multi-root ワークスペースを使う保存時結合テストで、Mamori Inspector の有効化設定を `ConfigurationTarget.Workspace` で安定して更新するようにしました。
- 外部実プロジェクト側の PMD 違反状態に依存せず、保存時再検査で Diagnostics が解消されることを確認できるよう既存テストを安定化しました。

## [0.2.15] - 2026-04-05

### Changed
- 保存時検証のトーストを、処理一覧を 1 回まとめて表示する方式から、実際に開始した各ツール名を個別に表示する方式へ変更しました。

### Added
- 保存時トーストが Spotless、Checkstyle、PMD、Semgrep を個別に表示することを確認する回帰テストを追加しました。

## [0.2.14] - 2026-04-05

### Fixed
- Java 保存時統合テストの fixture を一時ディレクトリ内へ閉じ込め、Semgrep を明示 override で実行するようにして timeout と後片付け漏れを防ぐようにしました。
- VSIX パッケージから、保存時統合テストで残りうる `pom.xml`、`mvnw*`、`bin/**`、`.mamori/out/**`、`.tmp-*` を除外するようにしました。

## [0.2.13] - 2026-04-05

### Added
- 保存時検証で、対象ファイル名と Mamori が実行中の整形・静的解析内容をトーストで確認できるようにしました。

### Fixed
- 保存時の Java 統合テストへ、進捗トーストに処理内容が出ることを確認する回帰テストを追加しました。

## [0.2.12] - 2026-04-05

### Added
- Semgrep 起動失敗時でも、保存時 SARIF に含まれる Checkstyle と PMD の Diagnostics を反映できる回帰テストを追加しました。

### Fixed
- 保存時検証で一部ツールが失敗しても、生成済みの部分 SARIF から Problems を更新できるようにしました。
- 保存時再検査の開始前に古い save SARIF を削除し、失敗時に前回結果を再利用しないようにしました。
- Windows で PATH に `py` が含まれていない場合でも、標準の `py` ランチャー配置から Semgrep の自動導入を継続できるようにしました。

## [0.2.11] - 2026-04-05

### Added
- 外部実プロジェクトを使い、保存時再検査で同じファイルの PMD Diagnostics が Problems と save 結果の両方から消えることを確認する結合テストを追加しました。

### Fixed
- 保存時検証の有効化設定を multi-root ワークスペースでも resource 単位で安定して解決できるようにしました。
- 外部実プロジェクトを使う VS Code 統合テストで、extension host へ検証用環境変数を引き渡せるようにしました。

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