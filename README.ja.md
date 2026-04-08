# Mamori Inspector

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/meibinlab.mamori-inspector?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=meibinlab.mamori-inspector) [![License: Apache%202.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/meibinlab/mamori-inspector/blob/main/LICENSE)

Mamori Inspector は、複数の解析ツールを統合し、開発者が扱いやすい形で VS Code 上に結果を集約するコード検査プラットフォームです。

- English: [README.md](README.md)
- Marketplace 表示名: Mamori Inspector: Code Quality Guard

## 導入方法
1. VS Code に Mamori Inspector 拡張をインストールします。Marketplace では Mamori Inspector: Code Quality Guard と表示されます。
2. 対象リポジトリを VS Code のワークスペースとして開きます。
3. 保存時検証を使いたいワークスペースフォルダーで、コマンド `Mamori Inspector: Enable In Workspace` を実行します。
4. 対応ファイルを保存すると、保存時検証が始まります。
5. commit と push 時の検証も有効にしたい場合は、コマンド `Mamori Inspector: Install Git Hooks` を一度実行します。

## CI
- GitHub Actions は `push`、`pull_request`、`workflow_dispatch` で実行します。
- quality ジョブでは Ubuntu と Windows の両方で `npm ci`、`npm run compile`、`npm run lint`、`npm test` を実行します。
- integration ジョブでは、quality 成功後に Ubuntu 上で `xvfb-run -a npm run test:integration` を実行します。
- prerelease ではない GitHub Release を公開すると、release tag と `package.json` の version が一致することを確認したうえで、`vX.Y.Z` と `X.Y.Z` の両形式を許容して `VSCE_PAT` を使い VS Code Marketplace へ公開します。prerelease の公開では同じ確認を行いますが、Marketplace への公開は行いません。

## 初期セットアップ時の注意
- 保存時検証は既定で無効です。対象ワークスペースフォルダーごとに `Mamori Inspector: Enable In Workspace` を実行したあとで開始します。
- Git hook 検証は、拡張をインストールしただけでは開始しません。管理対象の hook を明示的にインストールする必要があります。
- `Mamori Inspector: Install Git Hooks` は、管理対象 hook を生成する前に、同梱 runner の静的 runtime をワークスペースの `.mamori/` へ同期します。同期される runtime には `type: commonjs` を持つ `.mamori/package.json` も含まれるため、導入先プロジェクトが `"type": "module"` の場合でも repo-local runner を正しく起動できます。
- 既にワークスペースに `.mamori/` がある場合、Mamori は拡張の有効化時と workspace 追加時にも管理 runtime を自動再同期します。そのため、利用者は通常、拡張更新後に一度 VS Code で対象 workspace を開けば setup や hook install を再実行する必要はありません。
- 管理対象の pre-commit / pre-push hook は、`$REPO_ROOT/.mamori/mamori.js` が無い場合や、解決した `node` コマンドが利用できない場合に stderr へ warning を出して成功終了するため、古い hook が残っていても commit / push を妨げません。
- 初回の検証実行前に管理ツール一式を先に取得したい場合は、`Mamori Inspector: Setup Managed Tools` を一度実行します。
- `precommit/staged` は、ステージ済みファイルを `git diff --cached --name-only --diff-filter=ACMR` で解決するため、`PATH` 上の Git CLI が必要です。
- Web checker の設定は、明示設定、検出した設定ファイル、`package.json` の設定、bundled minimal config の順で解決します。
- JavaScript ファイルと HTML の inline script チェックは、プロジェクト設定が検出できない場合、bundled minimal ESLint config にフォールバックします。bundled fallback は互換性を優先した保守的な core rule だけを使います。
- TypeScript ファイルは、明示設定、ワークスペース探索、または `package.json#eslintConfig` で ESLint 設定を解決できた場合にのみチェックします。Mamori の JavaScript 向け bundled fallback は TypeScript には適用しません。
- CSS、SCSS、Sass のチェックと HTML の inline style チェックは、プロジェクト設定が検出できない場合、bundled minimal Stylelint config にフォールバックします。
- HTML のチェックは、プロジェクト設定が検出できない場合、bundled minimal htmlhint config にフォールバックします。

## 管理ツールの自動導入
- Mamori は `run` 実行時に不足している管理ツールを自動導入し、ワークスペース配下の `.mamori/tools` と `.mamori/node` に保存します。
- 初回実行前にまとめて取得したい場合は `Mamori Inspector: Setup Managed Tools` を使います。
- `.mamori/tools`、`.mamori/node`、`.mamori-inline-tmp` を削除して次回実行時に再取得したい場合は `Mamori Inspector: Clear Managed Tool Cache` を使います。
- CLI では `mamori.js setup` と `mamori.js cache-clear` が同じ役割を持ちます。
- Mamori は `setup` と `run --execute` の実行時に、ワークスペースが Git リポジトリであれば、ローカルの `.git/info/exclude` へワークスペースルートの `/.mamori/` と `/.mamori-inline-tmp/`、およびリポジトリ配下で見つかった repo-relative な nested `.mamori` エントリを best-effort で追記します。これは `.gitignore` を変更せず、Git で既に追跡されているファイルにも影響しません。

| ツール群 | 管理バージョン | 導入先 | 補足 |
| ---- | ---- | ---- | ---- |
| Maven | 3.9.11 | `.mamori/tools/maven/<version>` | `PATH` 上に `mvn` がない場合に使用します。 |
| Gradle | 8.14.4 | `.mamori/tools/gradle/<version>` | `PATH` 上に `gradle` がない場合に使用します。 |
| Semgrep | 1.151.0 | `.mamori/tools/python/packages` | `PATH` 上に `semgrep` がない場合に `pip` で導入します。 |
| Prettier / ESLint / Stylelint / htmlhint | 導入時点の npm 取得版 | `.mamori/node/node_modules/.bin` | プロジェクト直下の `node_modules/.bin` に対象ツールがない場合に使用します。 |

- Web ツールは、最寄りのプロジェクト `node_modules/.bin` を優先し、見つからない場合のみ `.mamori/node` にフォールバックします。
- Maven、Gradle、Semgrep は、まず `PATH` 上の既存コマンドを使い、見つからない場合だけ管理コピーを導入します。
- 管理対象の Node ツール導入には `PATH` 上の `npm` が必要です。管理対象の Semgrep はパッケージ自体を自動導入しますが、その導入処理には `py`、`python`、`python3` のいずれかの Python ランチャーが必要です。Windows では標準の `py` ランチャー配置も探索します。

## 現在の挙動
- Java、JavaScript、JavaScript React、TypeScript、TypeScript React、CSS、SCSS、Sass、HTML ファイルは、対象ワークスペースフォルダーで `Mamori Inspector: Enable In Workspace` を実行した場合に限り、保存時にデバウンスと再帰抑止付きのバックグラウンドチェックを自動実行します。
- 保存時検証では、対応ファイルを先に整形し、その後に生成された SARIF から Diagnostics を公開します。
- 保存時整形は Mamori Inspector の内部処理として実行し、VS Code の `editor.defaultFormatter`、`editor.formatOnSave`、`editor.codeActionsOnSave` は自動変更しません。
- 保存時実行が一部ツール失敗で終了しても、その時点までに部分的な SARIF が生成されていれば、その Diagnostics は Problems に反映し、失敗詳細は出力ログへ残します。
- 保存時検証では、整形や静的解析の各ツールが実際に開始したタイミングで、保存したファイル名とそのツール名だけをステータスバーへ表示します。
- JavaScript の保存時検証では、明示設定または検出したプロジェクト ESLint 設定を解決できる direct file に対しては Prettier を実行せず `eslint --fix` を使い、設定が見つからない場合のみ Prettier と Mamori の bundled minimal ESLint config を使用します。ここでいう direct file には HTML から抽出した inline script は含みません。
- TypeScript の保存時検証では、明示設定、ワークスペース探索、または `package.json#eslintConfig` で解決できる ESLint 設定がある direct file に対して Prettier を実行せず `eslint --fix` と ESLint を使用します。TypeScript に対して Mamori の JavaScript 向け bundled fallback は使いません。
- CSS、SCSS、Sass の保存時検証は、Prettier と Stylelint を使用し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal Stylelint config を使用します。
- HTML の保存時検証では、CSS と互換性のある type を持つ inline style ブロックも一時的な CSS ファイルへ抽出して Stylelint で検査し、診断を元の HTML 上の位置へ逆写像したうえで、実行後に一時ファイルを削除します。このとき Stylelint はプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal Stylelint config を使用します。
- HTML の保存時検証は、Prettier と htmlhint を使用し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal htmlhint config を使用します。
- HTML の保存時検証では、`src` を持たない inline script ブロックも一時的な JavaScript ファイルへ抽出して ESLint で検査し、診断を元の HTML 上の位置へ逆写像したうえで、実行後に一時ファイルを削除します。このとき ESLint はプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal ESLint config を使用します。
- `precommit/staged` は、`git diff --cached --name-only --diff-filter=ACMR` でステージ済みファイルを解決し、利用可能な場合は Spotless を先に実行し、整形後のファイルを `git add -- <files>` で再ステージします。
- `precommit/staged` は、ステージ済みの direct JavaScript と TypeScript ではプロジェクト ESLint 設定を解決できる場合に Prettier を実行せず `eslint --fix` を使い、それ以外の JavaScript、CSS、SCSS、Sass、HTML ファイルでは対応する checker の前に Prettier を実行します。ここでいう direct file には HTML から抽出した inline script は含みません。
- `precommit/staged` は、HTML ファイル自体は htmlhint で扱いながら、HTML の inline style ブロックを Stylelint の対象にも含めます。
- `precommit/staged` は、HTML ファイル自体は htmlhint で扱いながら、HTML の inline script ブロックを ESLint の対象にも含めます。
- `precommit/staged` は、ステージ済みファイルが 0 件の場合はチェックを実行せず成功を返します。また、ステージ済みファイル解決のために `PATH` 上の Git CLI が必要です。
- `prepush/workspace` は、軽量な Java チェックに加えて CPD を実行し、`target/classes` や `build/classes/java/main` のような class ルートがある場合のみ SpotBugs を追加します。
- `prepush/workspace` は、ワークスペース内のファイルに対して ESLint、Stylelint、htmlhint も実行し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal config を使用します。
- `prepush/workspace` は、一時的な CSS ファイルを使って HTML の inline style ブロックも Stylelint の対象に含め、結果は元の HTML 上の位置に報告します。
- `prepush/workspace` は、一時的な JavaScript ファイルを使って HTML の inline script ブロックも ESLint の対象に含め、結果は元の HTML 上の位置に報告します。
- `manual/workspace` は、重い手動ツールを追加するまで、現時点では軽量な Java チェック計画を再利用しつつ、ワークスペース内の Web ファイルに対しては `prepush/workspace` と同じ解決ルールで ESLint、Stylelint、htmlhint も実行します。
- コマンド `Mamori Inspector: Run Workspace Check` は、ワークスペース全体の手動チェックを実行し、生成された SARIF から Diagnostics を公開します。
- 手動の workspace check を開始した時点では、開始を知らせる短時間のトースト通知を表示し、継続中の静的解析進捗はステータスバーへ表示します。
- 保存時と手動実行の静的解析進捗は、トーストではなくステータスバーへ表示します。
- 手動全体チェックが成功した場合、拡張は同じワークスペースに対して以前反映していた保存時 Diagnostics を、最新の手動結果で置き換えます。
- コマンド `Mamori Inspector: Enable In Workspace` と `Mamori Inspector: Disable In Workspace` は、ワークスペースフォルダー単位で保存時検証の有効・無効を切り替えます。既定値は無効です。
- `Enable In Workspace` / `Disable In Workspace` が変更するのは `mamori-inspector.enabled` のみで、VS Code の formatter や save 系 editor 設定は変更しません。
- コマンド `Mamori Inspector: Setup Managed Tools` は、管理対象の Maven、Gradle、Semgrep、Prettier、ESLint、Stylelint、htmlhint をワークスペースキャッシュへ導入します。
- コマンド `Mamori Inspector: Clear Managed Tool Cache` は、`.mamori/tools` と `.mamori/node` の管理キャッシュを削除し、`.mamori-inline-tmp` も削除します。
- コマンド `Mamori Inspector: Install Git Hooks` と `Mamori Inspector: Uninstall Git Hooks` は、CLI と同じランナーを呼び出し、`.git/hooks/pre-commit` と `.git/hooks/pre-push` を管理します。
- Maven と Gradle の build 定義を解析して、Checkstyle、PMD、Spotless、CPD、SpotBugs などの Java ツール設定を解決します。
- `mamori.js setup` は VS Code の setup コマンドと同じ管理ツール一式を準備し、best-effort でローカルの `.git/info/exclude` へワークスペースルートの `/.mamori/` と `/.mamori-inline-tmp/`、およびリポジトリ配下で見つかった repo-relative な nested `.mamori` エントリを追記します。`mamori.js cache-clear` は VS Code の cache-clear コマンドと同じキャッシュ削除と `.mamori-inline-tmp` の削除を行います。
- `mamori.js hooks install` と `mamori.js hooks uninstall` は、`.git/hooks` 配下の管理対象 `pre-commit` と `pre-push` を作成または削除します。

## HTML 内の JS / CSS チェック
- Mamori は、HTML のマークアップ本体を htmlhint、inline script を ESLint、inline style を Stylelint で分担して検査します。
- inline script のチェック対象は、`src` を持たず、`type` が未指定、空文字、`module`、または `text/javascript`、`application/javascript`、`application/ecmascript` などの JavaScript MIME type である `script` タグだけです。
- `text/javascript; charset=utf-8` のような parameter 付き JavaScript MIME type も正規化して JavaScript として扱います。
- `text/plain` など JavaScript 以外の `type` を持つ inline script は ESLint の対象外です。
- inline style のチェック対象は、`type` が未指定、空文字、`text/css`、または `text/css; charset=utf-8` のような parameter 付き `text/css` である `style` タグだけです。
- CSS 以外の `type` を持つ inline style は Stylelint の対象外です。
- inline script / inline style の診断は元の HTML 上の位置に逆写像して報告し、ワークスペースルート直下の `.mamori-inline-tmp/` に作成した抽出用一時ファイルは各実行後に削除します。

## 検証モード
| トリガー | 拡張インストール後に自動開始 | 追加セットアップ | 対象範囲 | 補足 |
| ---- | ---- | ---- | ---- | ---- |
| 保存時 | いいえ | `Mamori Inspector: Enable In Workspace` を実行 | 保存したファイルのみ | Mamori Inspector を有効化したワークスペースフォルダー内の対応ファイルを保存したときに実行します。 |
| pre-commit | いいえ | `Mamori Inspector: Install Git Hooks` を実行 | ステージ済みファイルのみ | 検証失敗時は commit を停止します。 |
| pre-push | いいえ | `Mamori Inspector: Install Git Hooks` を実行 | ワークスペース | 検証失敗時は push を停止します。ただし SpotBugs の skip 条件は仕様に従います。 |
| 手動 | いいえ | なし | ワークスペース | `Mamori Inspector: Run Workspace Check` で実行します。 |

## 保存時検証と Git hook 検証の違い
- 保存時検証は、対象ワークスペースフォルダーで `Mamori Inspector: Enable In Workspace` を実行したあとに始まり、保存したファイルだけを対象にします。
- 保存時検証は、エディタ上で素早くフィードバックを返す用途で、生成した SARIF から VS Code Problems を更新します。
- Git hook 検証は、管理対象 hook をインストールするまで実行されません。
- 管理対象 hook は、ローカル runner が削除済みの場合や、解決した `node` コマンドが利用できない場合は warning を出してスキップします。
- pre-commit 検証はステージ済みファイルのみを対象にし、整形による変更を自動で再ステージします。
- pre-push 検証はワークスペース全体を対象にし、push 前のより広い品質ゲートとして動作します。

## 各チェックで用意すべきファイル
| チェック | 用意すべきファイル | 補足 |
| ---- | ---- | ---- |
| Java Checkstyle | Checkstyle 設定を含む `pom.xml`、`build.gradle`、または `build.gradle.kts` | Java のチェックは Maven または Gradle の build 定義から解決します。 |
| Java PMD | PMD 設定を含む `pom.xml`、`build.gradle`、または `build.gradle.kts` | Java のチェックは Maven または Gradle の build 定義から解決します。 |
| Java Spotless | Spotless 設定を含む `pom.xml`、`build.gradle`、または `build.gradle.kts` | 保存時と pre-commit の Java 整形で使用されます。 |
| Java SpotBugs | SpotBugs 設定を含む `pom.xml`、`build.gradle`、または `build.gradle.kts` | `prepush/workspace` では追加で `target/classes` または `build/classes/java/main` の class 出力が必要です。 |
| Java Semgrep | 必須設定ファイルなし、または任意で `.semgrep.yml` | `.semgrep.yml` がない場合は既定の `p/java` ルールセットを使用します。 |
| JavaScript / TypeScript ESLint | 任意: `eslint.config.js`、`eslint.config.mjs`、`eslint.config.cjs`、`eslint.config.ts`、`eslint.config.mts`、`eslint.config.cts`、`.eslintrc`、`.eslintrc.js`、`.eslintrc.cjs`、`.eslintrc.json`、`.eslintrc.yaml`、`.eslintrc.yml`、`.eslintrc.ts`、`.eslintrc.mts`、`.eslintrc.cts` のいずれか、または `eslintConfig` を含む `package.json` | プロジェクト設定がある場合はそれを優先します。JavaScript ファイルと HTML の inline script チェックは設定未検出時に bundled minimal ESLint config を使用し、TypeScript ファイルはプロジェクト ESLint 設定が必要です。 |
| CSS / SCSS / Sass Stylelint | 任意: `stylelint.config.js`、`stylelint.config.mjs`、`stylelint.config.cjs`、`stylelint.config.ts`、`stylelint.config.mts`、`stylelint.config.cts`、`.stylelintrc`、`.stylelintrc.js`、`.stylelintrc.cjs`、`.stylelintrc.json`、`.stylelintrc.yaml`、`.stylelintrc.yml`、`.stylelintrc.ts`、`.stylelintrc.mts`、`.stylelintrc.cts` のいずれか、または `stylelint` を含む `package.json` | プロジェクト設定がある場合はそれを優先し、ない場合は CSS ファイルと HTML の inline style チェックに bundled minimal Stylelint config を使用します。 |
| HTML htmlhint | 任意: `.htmlhintrc`、`.htmlhintrc.js`、`.htmlhintrc.cjs`、`.htmlhintrc.json`、`.htmlhintrc.yaml`、`.htmlhintrc.yml` のいずれか、または `htmlhint` を含む `package.json` | プロジェクト設定がある場合はそれを優先し、ない場合は HTML チェックに bundled minimal htmlhint config を使用します。 |
| JavaScript / CSS / HTML の Prettier | Mamori 専用の必須設定ファイルはありません | プロジェクトで Prettier 設定を使う場合は、通常どおりプロジェクト内に置いて整形ルールを合わせてください。 |

## 仕様
- docs/spec.md

## ランナー構成
- docs/runner-structure.md
