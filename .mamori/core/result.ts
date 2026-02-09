// 重要度の種別を表す
export type Severity = 'error' | 'warning' | 'info';

// 解析結果の1件を表す
export interface Issue {
  // ツール名を表す
  tool: string;
  // ルールIDを表す
  ruleId?: string;
  // メッセージを表す
  message: string;
  // 重要度を表す
  severity: Severity;
  // ファイルパスを表す（絶対またはワークスペース相対）
  filePath?: string;
  // 1始まりの行番号を表す
  line?: number;
  // 1始まりの列番号を表す
  column?: number;
  // 追加情報を表す
  metadata?: Record<string, string>;
}

// ツール実行結果の集合を表す
export interface ToolResult {
  // ツール名を表す
  tool: string;
  // 解析結果の一覧を表す
  issues: Issue[];
  // 実行中に発生した警告メッセージを表す
  warnings: string[];
}
