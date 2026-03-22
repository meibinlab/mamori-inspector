/**
 * Mamori hooks 操作種別を表す。
 */
export type MamoriHooksAction = 'install' | 'uninstall';

/**
 * hooks warning の出力先を表す。
 */
export interface HooksOutputWriter {
  /**
   * ログを 1 行追記する。
   * @param value 追記する文字列を表す。
   * @returns 返り値はない。
   */
  appendLine(value: string): void;
}

/**
 * hooks warning の通知先を表す。
 */
export interface HooksMessagePresenter {
  /**
   * 情報通知を表示する。
   * @param message 表示するメッセージを表す。
   * @returns 表示完了を待つ Thenable を返す。
   */
  showInformationMessage(message: string): Thenable<unknown>;

  /**
   * 警告通知を表示する。
   * @param message 表示するメッセージを表す。
   * @returns 表示完了を待つ Thenable を返す。
   */
  showWarningMessage(message: string): Thenable<unknown>;
}

/**
 * hooks CLI の標準出力から警告一覧を抽出する。
 * @param stdout CLI 標準出力を表す。
 * @returns 警告一覧を返す。
 */
export function extractHooksWarnings(stdout: string): string[] {
  const warningLine = stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith('mamori: hooks warnings='));

  if (!warningLine) {
    return [];
  }

  return warningLine
    .replace('mamori: hooks warnings=', '')
    .split(' | ')
    .map((value) => value.trim())
    .filter((value) => Boolean(value));
}

/**
 * hooks 操作成功時の通知とログ出力を行う。
 * @param action hooks 操作種別を表す。
 * @param stdout CLI 標準出力を表す。
 * @param outputWriter 出力先を表す。
 * @param messagePresenter 通知先を表す。
 * @returns 返り値はない。
 */
export function reportHooksCommandSuccess(
  action: MamoriHooksAction,
  stdout: string,
  outputWriter: HooksOutputWriter,
  messagePresenter: HooksMessagePresenter,
): void {
  const warnings = extractHooksWarnings(stdout);

  if (warnings.length > 0) {
    outputWriter.appendLine(`Mamori Inspector hooks ${action} warnings: ${warnings.join(' | ')}`);
    void messagePresenter.showWarningMessage(
      `Mamori Inspector: Git hooks は処理しましたが、一部は変更しませんでした。${warnings.join(' / ')}`,
    );
  }

  void messagePresenter.showInformationMessage(
    action === 'install'
      ? 'Mamori Inspector: Git hooks をインストールしました。'
      : 'Mamori Inspector: Git hooks をアンインストールしました。',
  );
}