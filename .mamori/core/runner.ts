// Issue型を表す
import { Issue } from './result';

// 実行モードの種別を表す
export type RunMode = 'save' | 'precommit' | 'prepush' | 'manual';
// 実行スコープの種別を表す
export type RunScope = 'file' | 'staged' | 'workspace';

// 実行コンテキストを表す
export interface RunContext {
  // 実行モードを表す
  mode: RunMode;
  // 実行スコープを表す
  scope: RunScope;
  // 対象ファイルの一覧を表す
  files: string[];
}

// 実行結果を表す
export interface RunOutput {
  // 実行結果の一覧を表す
  issues: Issue[];
  // 実行中の警告メッセージを表す
  warnings: string[];
}

/**
 * 実行フローの最小実装を提供する。
 * @param context 実行コンテキストを表す。
 * @returns 実行結果を返す。
 */
export async function run(context: RunContext): Promise<RunOutput> {
  // ここでは最小の結果だけを返す
  void context;
  return {
    issues: [],
    warnings: ['runner: not implemented'],
  };
}
