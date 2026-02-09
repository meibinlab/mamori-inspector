# ランナーのファイル構成（提案・確定版）

将来のツール追加を前提にした `.mamori/` ランナーの構成です。役割ごとに責務を分離し、ツール追加が `adapters/` と `tools/registry.ts` の追加だけで完結するようにしています。

```
.mamori/
  mamori.js                # CLI 入口（run/setup/hooks などのサブコマンド）
  manifest.json            # ツール定義（URL/sha256/version/起動方法）
  config/
    defaults.json          # 既定設定
  core/
    runner.ts              # 実行フロー制御（format→check、modeごと）
    context.ts             # 実行コンテキスト（cwd/モード/対象ファイル）
    result.ts              # 統一 Issue モデル
    sarif.ts               # SARIF 出力
    logger.ts              # ログ（Output/ファイル/レベル）
    exit-codes.ts          # 0/1/2 の固定管理
  tools/
    tool.ts                # ツール共通インターフェース
    registry.ts            # ツール登録（manifest 読み込みと紐付け）
    downloader.ts          # 取得・検証・キャッシュ（sha256）
    cache.ts               # キャッシュ管理
    exec.ts                # spawn/timeout/キャンセル
  detectors/
    config-resolver.ts     # 明示→ビルド定義→探索→デフォルト
    maven.ts               # pom.xml 解析
    gradle.ts              # build.gradle(.kts) 解析（ヒューリスティック）
    semgrep.ts             # .semgrep.yml 検出
    web-config.ts          # ESLint/Stylelint/htmlhint 検出
  formats/
    prettier.ts            # Prettier 実行
    spotless.ts            # Spotless 実行（ビルド定義依存）
  adapters/
    checkstyle.ts          # XML → Issue
    pmd.ts                 # XML/CSV → Issue
    cpd.ts                 # XML/CSV → Issue
    spotbugs.ts            # XML → Issue
    semgrep.ts             # SARIF → Issue
    htmlhint.ts            # 結果 → Issue
    eslint.ts              # 結果 → Issue（設定があれば）
    stylelint.ts           # 結果 → Issue（設定があれば）
  hooks/
    install.ts             # pre-commit/pre-push 生成
```

## 追加時の考え方
- 新しいツールは `adapters/` にパーサを追加し、`tools/registry.ts` に登録する。
- 設定検出が増える場合は `detectors/` に追加する。
- 出力統一は `core/result.ts` → `core/sarif.ts` の流れに乗せる。
