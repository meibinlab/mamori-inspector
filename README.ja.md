# Mamori Inspector
Mamori Inspector は、複数の解析ツールを統合し、開発者が扱いやすい形で VS Code 上に結果を集約するコード検査プラットフォームです。

- English: [README.md](README.md)

## 導入方法
1. VS Code に Mamori Inspector 拡張をインストールします。
2. 対象リポジトリを VS Code のワークスペースとして開きます。
3. 対応ファイルを保存すると、保存時検証が自動で始まります。
4. commit と push 時の検証も有効にしたい場合は、コマンド `Mamori Inspector: Install Git Hooks` を一度実行します。

## 初期セットアップ時の注意
- 保存時検証は、拡張をインストールしたあとに対応ファイルを保存すると自動で開始します。
- Git hook 検証は、拡張をインストールしただけでは開始しません。管理対象の hook を明示的にインストールする必要があります。
- `precommit/staged` は、ステージ済みファイルを `git diff --cached --name-only --diff-filter=ACMR` で解決するため、`PATH` 上の Git CLI が必要です。
- Web checker の設定は、明示設定、検出した設定ファイル、`package.json` の設定、bundled minimal config の順で解決します。
- JavaScript ファイルと HTML の inline script チェックは、プロジェクト設定が検出できない場合、bundled minimal ESLint config にフォールバックします。bundled fallback は互換性を優先した保守的な core rule だけを使います。
- CSS、SCSS、Sass のチェックと HTML の inline style チェックは、プロジェクト設定が検出できない場合、bundled minimal Stylelint config にフォールバックします。
- HTML のチェックは、プロジェクト設定が検出できない場合、bundled minimal htmlhint config にフォールバックします。

## 現在の挙動
- Java、JavaScript、JavaScript React、CSS、SCSS、Sass、HTML ファイルは、保存時にデバウンスと再帰抑止付きのバックグラウンドチェックを自動実行します。
- 保存時検証では、対応ファイルを先に整形し、その後に生成された SARIF から Diagnostics を公開します。
- JavaScript の保存時検証は、Prettier と ESLint を使用し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal ESLint config を使用します。
- CSS、SCSS、Sass の保存時検証は、Prettier と Stylelint を使用し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal Stylelint config を使用します。
- HTML の保存時検証では、CSS と互換性のある type を持つ inline style ブロックも一時的な CSS ファイルへ抽出して Stylelint で検査し、診断を元の HTML 上の位置へ逆写像したうえで、実行後に一時ファイルを削除します。このとき Stylelint はプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal Stylelint config を使用します。
- HTML の保存時検証は、Prettier と htmlhint を使用し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal htmlhint config を使用します。
- HTML の保存時検証では、`src` を持たない inline script ブロックも一時的な JavaScript ファイルへ抽出して ESLint で検査し、診断を元の HTML 上の位置へ逆写像したうえで、実行後に一時ファイルを削除します。このとき ESLint はプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal ESLint config を使用します。
- `precommit/staged` は、`git diff --cached --name-only --diff-filter=ACMR` でステージ済みファイルを解決し、利用可能な場合は Spotless を先に実行し、整形後のファイルを `git add -- <files>` で再ステージします。
- `precommit/staged` は、ステージ済みの JavaScript、CSS、SCSS、Sass、HTML ファイルに対しても、対応する checker の前に Prettier を実行します。
- `precommit/staged` は、HTML ファイル自体は htmlhint で扱いながら、HTML の inline style ブロックを Stylelint の対象にも含めます。
- `precommit/staged` は、HTML ファイル自体は htmlhint で扱いながら、HTML の inline script ブロックを ESLint の対象にも含めます。
- `precommit/staged` は、ステージ済みファイルが 0 件の場合はチェックを実行せず成功を返します。また、ステージ済みファイル解決のために `PATH` 上の Git CLI が必要です。
- `prepush/workspace` は、軽量な Java チェックに加えて CPD を実行し、`target/classes` や `build/classes/java/main` のような class ルートがある場合のみ SpotBugs を追加します。
- `prepush/workspace` は、ワークスペース内のファイルに対して ESLint、Stylelint、htmlhint も実行し、明示設定または検出したプロジェクト設定を優先し、見つからない場合は Mamori の bundled minimal config を使用します。
- `prepush/workspace` は、一時的な CSS ファイルを使って HTML の inline style ブロックも Stylelint の対象に含め、結果は元の HTML 上の位置に報告します。
- `prepush/workspace` は、一時的な JavaScript ファイルを使って HTML の inline script ブロックも ESLint の対象に含め、結果は元の HTML 上の位置に報告します。
- `manual/workspace` は、重い手動ツールを追加するまで、現時点では軽量な Java チェック計画を再利用します。
- コマンド `Mamori Inspector: Run Workspace Check` は、ワークスペース全体の手動チェックを実行し、生成された SARIF から Diagnostics を公開します。
- コマンド `Mamori Inspector: Install Git Hooks` と `Mamori Inspector: Uninstall Git Hooks` は、CLI と同じランナーを呼び出し、`.git/hooks/pre-commit` と `.git/hooks/pre-push` を管理します。
- Maven と Gradle の build 定義を解析して、Checkstyle、PMD、Spotless、CPD、SpotBugs などの Java ツール設定を解決します。
- `mamori.js hooks install` と `mamori.js hooks uninstall` は、`.git/hooks` 配下の管理対象 `pre-commit` と `pre-push` を作成または削除します。

## HTML 内の JS / CSS チェック
- Mamori は、HTML のマークアップ本体を htmlhint、inline script を ESLint、inline style を Stylelint で分担して検査します。
- inline script のチェック対象は、`src` を持たず、`type` が未指定、空文字、`module`、または `text/javascript`、`application/javascript`、`application/ecmascript` などの JavaScript MIME type である `script` タグだけです。
- `text/javascript; charset=utf-8` のような parameter 付き JavaScript MIME type も正規化して JavaScript として扱います。
- `text/plain` など JavaScript 以外の `type` を持つ inline script は ESLint の対象外です。
- inline style のチェック対象は、`type` が未指定、空文字、`text/css`、または `text/css; charset=utf-8` のような parameter 付き `text/css` である `style` タグだけです。
- CSS 以外の `type` を持つ inline style は Stylelint の対象外です。
- inline script / inline style の診断は元の HTML 上の位置に逆写像して報告し、抽出に使った一時ファイルは各実行後に削除します。

## 検証モード
| トリガー | 拡張インストール後に自動開始 | 追加セットアップ | 対象範囲 | 補足 |
| ---- | ---- | ---- | ---- | ---- |
| 保存時 | はい | なし | 保存したファイルのみ | ワークスペース内の対応ファイルを保存したときに実行します。 |
| pre-commit | いいえ | `Mamori Inspector: Install Git Hooks` を実行 | ステージ済みファイルのみ | 検証失敗時は commit を停止します。 |
| pre-push | いいえ | `Mamori Inspector: Install Git Hooks` を実行 | ワークスペース | 検証失敗時は push を停止します。ただし SpotBugs の skip 条件は仕様に従います。 |
| 手動 | いいえ | なし | ワークスペース | `Mamori Inspector: Run Workspace Check` で実行します。 |

## 保存時検証と Git hook 検証の違い
- 保存時検証は、拡張インストール後に自動で始まり、保存したファイルだけを対象にします。
- 保存時検証は、エディタ上で素早くフィードバックを返す用途で、生成した SARIF から VS Code Problems を更新します。
- Git hook 検証は、管理対象 hook をインストールするまで実行されません。
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
| JavaScript ESLint | 任意: `eslint.config.js`、`eslint.config.mjs`、`eslint.config.cjs`、`eslint.config.ts`、`eslint.config.mts`、`eslint.config.cts`、`.eslintrc`、`.eslintrc.js`、`.eslintrc.cjs`、`.eslintrc.json`、`.eslintrc.yaml`、`.eslintrc.yml`、`.eslintrc.ts`、`.eslintrc.mts`、`.eslintrc.cts` のいずれか、または `eslintConfig` を含む `package.json` | プロジェクト設定がある場合はそれを優先し、ない場合は JavaScript ファイルと HTML の inline script チェックに bundled minimal ESLint config を使用します。 |
| CSS / SCSS / Sass Stylelint | 任意: `stylelint.config.js`、`stylelint.config.mjs`、`stylelint.config.cjs`、`stylelint.config.ts`、`stylelint.config.mts`、`stylelint.config.cts`、`.stylelintrc`、`.stylelintrc.js`、`.stylelintrc.cjs`、`.stylelintrc.json`、`.stylelintrc.yaml`、`.stylelintrc.yml`、`.stylelintrc.ts`、`.stylelintrc.mts`、`.stylelintrc.cts` のいずれか、または `stylelint` を含む `package.json` | プロジェクト設定がある場合はそれを優先し、ない場合は CSS ファイルと HTML の inline style チェックに bundled minimal Stylelint config を使用します。 |
| HTML htmlhint | 任意: `.htmlhintrc`、`.htmlhintrc.js`、`.htmlhintrc.cjs`、`.htmlhintrc.json`、`.htmlhintrc.yaml`、`.htmlhintrc.yml` のいずれか、または `htmlhint` を含む `package.json` | プロジェクト設定がある場合はそれを優先し、ない場合は HTML チェックに bundled minimal htmlhint config を使用します。 |
| JavaScript / CSS / HTML の Prettier | Mamori 専用の必須設定ファイルはありません | プロジェクトで Prettier 設定を使う場合は、通常どおりプロジェクト内に置いて整形ルールを合わせてください。 |

## 仕様
- docs/spec.md

## ランナー構成
- docs/runner-structure.md
