/**
 * Mamori hooks 操作種別を表す。
 */
export type MamoriHooksAction = 'install' | 'uninstall';

/**
 * hooks 通知文言を表す。
 */
export interface HooksCommandMessages {
  /** install 成功時の情報通知を表す。 */
  installSuccessMessage: string;
  /** uninstall 成功時の情報通知を表す。 */
  uninstallSuccessMessage: string;
  /** 警告通知メッセージを構築する。 */
  buildWarningMessage: (warnings: string) => string;
}

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
  messages: HooksCommandMessages = {
    installSuccessMessage: 'Mamori Inspector: Installed Git hooks.',
    uninstallSuccessMessage: 'Mamori Inspector: Uninstalled Git hooks.',
    buildWarningMessage: (warnings: string) => (
      `Mamori Inspector: Git hooks were processed, but some hooks were left unchanged. ${warnings}`
    ),
  },
): void {
  const warnings = extractHooksWarnings(stdout);

  if (warnings.length > 0) {
    outputWriter.appendLine(`Mamori Inspector hooks ${action} warnings: ${warnings.join(' | ')}`);
    void messagePresenter.showWarningMessage(
      messages.buildWarningMessage(warnings.join(' / ')),
    );
  }

  void messagePresenter.showInformationMessage(
    action === 'install'
      ? messages.installSuccessMessage
      : messages.uninstallSuccessMessage,
  );
}