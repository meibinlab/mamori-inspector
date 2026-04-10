/**
 * 保守コマンド通知文言を表す。
 */
export interface MaintenanceCommandMessages {
  /** setup 成功時の情報通知を表す。 */
  setupSuccessMessage: string;
  /** cache-clear 成功時の情報通知を表す。 */
  cacheClearSuccessMessage: string;
  /** 警告通知メッセージを構築する。 */
  buildWarningMessage: (action: 'setup' | 'cache-clear', warnings: string) => string;
}

/**
 * 保守コマンド通知先を表す。
 */
export interface MaintenanceMessagePresenter {
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
 * 保守コマンド CLI の標準出力から警告一覧を抽出する。
 * @param action 保守コマンド種別を表す。
 * @param stdout CLI 標準出力を表す。
 * @returns 警告一覧を返す。
 */
export function extractMaintenanceWarnings(action: 'setup' | 'cache-clear', stdout: string): string[] {
  const warningPrefix = `mamori: ${action} warnings=`;
  const warningLine = stdout
    .split(/\r?\n/u)
    .find((line) => line.startsWith(warningPrefix));

  if (!warningLine) {
    return [];
  }

  return warningLine
    .replace(warningPrefix, '')
    .split(' | ')
    .map((value) => value.trim())
    .filter((value) => Boolean(value));
}

/**
 * 保守コマンドの進捗報告を作成する。
 * @param progress 進捗報告先を表す。
 * @param messages 進捗文言を生成する関数群を表す。
 * @param heartbeatMilliseconds 心拍更新間隔を表す。
 * @returns stdout 行の受け取り先と破棄処理を返す。
 */
export function createMaintenanceProgressReporter(
  progress: {
    report(update: { message?: string; increment?: number }): void;
  },
  messages: {
    getBaseMessage: () => string;
    getDetailMessage: (outputLine: string) => string;
    getHeartbeatMessage: (startedAtMilliseconds: number) => string;
  },
  heartbeatMilliseconds: number = 2000,
): {
  onStdoutLine: (line: string) => void;
  dispose: () => void;
} {
  const startedAtMilliseconds = Date.now();
  progress.report({ message: messages.getBaseMessage() });

  const heartbeatTimer = setInterval(() => {
    progress.report({
      message: messages.getHeartbeatMessage(startedAtMilliseconds),
    });
  }, heartbeatMilliseconds);

  return {
    onStdoutLine: (line: string) => {
      const normalizedLine = line.trim();
      if (normalizedLine === '') {
        return;
      }

      progress.report({
        message: messages.getDetailMessage(normalizedLine),
      });
    },
    dispose: () => {
      clearInterval(heartbeatTimer);
    },
  };
}

/**
 * 保守コマンド成功時の通知を行う。
 * @param action 保守コマンド種別を表す。
 * @param stdout CLI 標準出力を表す。
 * @param messagePresenter 通知先を表す。
 * @param messages 通知文言を表す。
 * @returns 返り値はない。
 */
export function reportMaintenanceCommandSuccess(
  action: 'setup' | 'cache-clear',
  stdout: string,
  messagePresenter: MaintenanceMessagePresenter,
  messages: MaintenanceCommandMessages = {
    setupSuccessMessage: 'Mamori Inspector: Set up managed tools.',
    cacheClearSuccessMessage: 'Mamori Inspector: Cleared the cache.',
    buildWarningMessage: (_action: 'setup' | 'cache-clear', warnings: string) => (
      `Mamori Inspector: Maintenance completed with warnings. ${warnings}`
    ),
  },
): void {
  const warnings = extractMaintenanceWarnings(action, stdout);

  if (warnings.length > 0) {
    void messagePresenter.showWarningMessage(
      messages.buildWarningMessage(action, warnings.join(' / ')),
    );
  }

  void messagePresenter.showInformationMessage(
    action === 'setup'
      ? messages.setupSuccessMessage
      : messages.cacheClearSuccessMessage,
  );
}