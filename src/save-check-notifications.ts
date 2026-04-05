/** 保存時通知対象のツール表示名一覧を表す。 */
const SAVE_CHECK_TOOL_LABELS: Record<string, string> = {
  checkstyle: 'Checkstyle',
  eslint: 'ESLint',
  htmlhint: 'htmlhint',
  pmd: 'PMD',
  prettier: 'Prettier',
  semgrep: 'Semgrep',
  spotless: 'Spotless',
  stylelint: 'Stylelint',
};

/** 保存時ツール開始行の判定パターンを表す。 */
const SAVE_CHECK_TOOL_START_PATTERN = /^mamori: tool-start tool=([a-z0-9-]+)/u;

/**
 * 保存時 CLI 出力行から開始したツール ID を抽出する。
 * @param outputLine CLI の出力 1 行を表す。
 * @returns 抽出できたツール ID を返す。
 */
export function parseSaveCheckToolStartLine(outputLine: string): string | undefined {
  const match = outputLine.match(SAVE_CHECK_TOOL_START_PATTERN);
  return match ? match[1] : undefined;
}

/**
 * 保存時通知に表示するツール名を返す。
 * @param toolId CLI が出力したツール ID を表す。
 * @returns 表示用ツール名を返す。
 */
export function getSaveCheckToolLabel(toolId: string): string {
  return SAVE_CHECK_TOOL_LABELS[toolId] || toolId;
}

/**
 * 保存時開始トースト文言を返す。
 * @param fileName 対象ファイル名を表す。
 * @param toolLabel 表示用ツール名を表す。
 * @returns トースト文言を返す。
 */
export function getSaveCheckStartToastMessage(fileName: string, toolLabel: string): string {
  return `Mamori Inspector: ${fileName} - ${toolLabel}`;
}