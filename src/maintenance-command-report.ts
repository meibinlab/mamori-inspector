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
 * setup 実行時の installing 出力からツール ID を抽出する。
 * @param outputLine CLI の出力 1 行を表す。
 * @returns ツール ID を返す。
 */
export function extractMaintenanceInstallingToolId(outputLine: string): string | undefined {
  const setupInstallingPrefix = 'mamori: setup installing=';
  const normalizedLine = outputLine.trim();

  if (!normalizedLine.startsWith(setupInstallingPrefix)) {
    return undefined;
  }

  const toolId = normalizedLine.slice(setupInstallingPrefix.length).trim();
  return toolId === '' ? undefined : toolId;
}

/**
 * setup 実行時のツール ID から表示名を返す。
 * @param toolId CLI が出力したツール ID を表す。
 * @returns 表示名を返す。
 */
export function getMaintenanceToolLabel(toolId: string): string {
  const normalizedToolId = toolId.trim();
  const labels: Record<string, string> = {
    checkstyle: 'Checkstyle',
    doiuse: 'doiuse',
    eslint: 'ESLint',
    gradle: 'Gradle',
    htmlhint: 'htmlhint',
    'html-validate': 'HTML-Validate',
    knip: 'Knip',
    maven: 'Maven',
    oxlint: 'Oxlint',
    pmd: 'PMD',
    prettier: 'Prettier',
    semgrep: 'Semgrep',
    spotless: 'Spotless',
    stylelint: 'Stylelint',
    tsc: 'TypeScript',
  };

  return labels[normalizedToolId] || normalizedToolId;
}

/**
 * setup 実行時の installing 出力を通知文言に変換する。
 * @param outputLine CLI の出力 1 行を表す。
 * @returns 表示文言を返す。
 */
export function getMaintenanceInstallingToolLabel(outputLine: string): string | undefined {
  const toolId = extractMaintenanceInstallingToolId(outputLine);
  if (!toolId) {
    return undefined;
  }

  return getMaintenanceToolLabel(toolId);
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
    getDetailMessage: (outputLine: string) => string | undefined;
    getHeartbeatMessage: (startedAtMilliseconds: number) => string;
  },
  heartbeatMilliseconds: number = 2000,
  minimumVisibleMilliseconds: number = 1200,
): {
  onStdoutLine: (line: string) => void;
  waitForMinimumVisibility: () => Promise<void>;
  dispose: () => void;
} {
  const startedAtMilliseconds = Date.now();
  progress.report({ message: messages.getBaseMessage() });

  const heartbeatTimer = heartbeatMilliseconds > 0
    ? setInterval(() => {
      const heartbeatMessage = messages.getHeartbeatMessage(startedAtMilliseconds);
      if (typeof heartbeatMessage === 'string' && heartbeatMessage !== '') {
        progress.report({
          message: heartbeatMessage,
        });
      }
    }, heartbeatMilliseconds)
    : undefined;

  return {
    onStdoutLine: (line: string) => {
      const normalizedLine = line.trim();
      if (normalizedLine === '') {
        return;
      }

      const detailMessage = messages.getDetailMessage(normalizedLine);
      if (typeof detailMessage !== 'string' || detailMessage === '') {
        return;
      }
      progress.report({ message: detailMessage });
    },
    waitForMinimumVisibility: async() => {
      const elapsedMilliseconds = Date.now() - startedAtMilliseconds;
      const remainingMilliseconds = Math.max(0, minimumVisibleMilliseconds - elapsedMilliseconds);
      if (remainingMilliseconds > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, remainingMilliseconds);
        });
      }
    },
    dispose: () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
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