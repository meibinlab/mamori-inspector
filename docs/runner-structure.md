# ランナーのファイル構成

現行実装の `.mamori/` ランナー構成です。VS Code 拡張と git hooks は CommonJS の `.js` 実装を共通で呼び出します。

```
.mamori/
  mamori.js                # CLI 入口（run/hooks/help のサブコマンド）
  package.json             # type=commonjs で workspace 側の module type 影響を遮断
  config/
    defaults.json          # 既定設定
  core/
    runner.js              # 実行フロー制御（format→check、modeごと）
    sarif.js               # SARIF の組み立てと書き出し
  tools/
    exec.js                # spawn/timeout/キャンセル
  detectors/
    build-definition.js    # Maven/Gradle のビルド定義探索
    command-plan.js        # 実行コマンド計画の構築
    config-resolver.js     # 明示→ビルド定義→探索→デフォルト
    execution-plan.js      # save/precommit/prepush/manual の実行計画
    gradle.js              # build.gradle(.kts) 解析（ヒューリスティック）
    maven.js               # pom.xml 解析
    semgrep.js             # .semgrep.yml 検出
    web-config.js          # ESLint/Stylelint/htmlhint 検出
  adapters/
    checkstyle.js          # XML → SARIF 用中間結果
    cpd.js                 # XML/CSV → SARIF 用中間結果
    eslint.js              # 結果 → SARIF 用中間結果
    htmlhint.js            # 結果 → SARIF 用中間結果
    pmd.js                 # XML/CSV → SARIF 用中間結果
    semgrep.js             # SARIF → SARIF 用中間結果
    spotbugs.js            # XML → SARIF 用中間結果
    stylelint.js           # 結果 → SARIF 用中間結果
  hooks/
    install.js             # pre-commit/pre-push 生成
  out/                     # 実行時に SARIF を出力するディレクトリ
```

## 補足
- `.mamori/` 配下のランナー実装は CommonJS の `.js` を正とする。
- `.mamori/package.json` で `type: commonjs` を固定し、導入先ワークスペースの `package.json#type` に関係なく CommonJS として読み込ませる。
- `.mamori/out/` は空でも問題なく、SARIF 書き出し時に必要に応じて再作成される。
- 新しいツールを追加する場合は `adapters/` と `detectors/` の責務分割を維持する。
