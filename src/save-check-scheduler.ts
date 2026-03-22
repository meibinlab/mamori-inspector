/**
 * 保存時チェックのスケジューラー設定を表す。
 */
export interface SaveCheckSchedulerOptions {
  /** デバウンス時間を表す。 */
  debounceMilliseconds: number;
  /** 自己再帰抑止時間を表す。 */
  suppressionMilliseconds: number;
  /** 実行中保存の追随再実行可否を判定する。 */
  shouldQueueDuringRun?: (filePath: string) => boolean;
  /** 実際のチェック処理を表す。 */
  executeCheck: (filePath: string) => Promise<void>;
}

/**
 * 保存イベントをデバウンスし、自己再帰を抑止しながらチェックを実行する。
 */
export class SaveCheckScheduler {
  /** ファイルごとの待機タイマーを表す。 */
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();

  /** ファイルごとの世代番号を表す。 */
  private readonly generations = new Map<string, number>();

  /** 実行完了後に追随実行すべき世代番号を表す。 */
  private readonly queuedGenerations = new Map<string, number>();

  /** 実行中のファイル一覧を表す。 */
  private readonly runningFiles = new Set<string>();

  /** ファイルごとの抑止期限を表す。 */
  private readonly suppressedUntil = new Map<string, number>();

  /**
   * スケジューラーを初期化する。
   * @param options スケジューラー設定を表す。
   */
  constructor(private readonly options: SaveCheckSchedulerOptions) {}

  /**
   * 保存時チェックを予約する。
   * @param filePath 対象ファイルパスを表す。
   * @returns 返り値はない。
   */
  schedule(filePath: string): void {
    const now = Date.now();
    const suppressedUntil = this.suppressedUntil.get(filePath) || 0;

    if (suppressedUntil > now) {
      return;
    }
    if (suppressedUntil > 0) {
      this.suppressedUntil.delete(filePath);
    }

    const nextGeneration = (this.generations.get(filePath) || 0) + 1;
    this.generations.set(filePath, nextGeneration);

    if (this.runningFiles.has(filePath)) {
      if (this.shouldQueueDuringRun(filePath)) {
        this.queuedGenerations.set(filePath, nextGeneration);
      }
      return;
    }

    const existingTimer = this.pendingTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      void this.runScheduledCheck(filePath, nextGeneration);
    }, this.options.debounceMilliseconds);
    this.pendingTimers.set(filePath, timer);
  }

  /**
   * 管理中タイマーを破棄する。
   * @returns 返り値はない。
   */
  dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.generations.clear();
    this.queuedGenerations.clear();
    this.runningFiles.clear();
    this.suppressedUntil.clear();
  }

  /**
   * 予約済みチェックを実行する。
   * @param filePath 対象ファイルパスを表す。
   * @param generation 実行時の世代番号を表す。
   * @returns 実行完了を待つ Promise を返す。
   */
  private async runScheduledCheck(filePath: string, generation: number): Promise<void> {
    if (this.generations.get(filePath) !== generation) {
      return;
    }

    this.pendingTimers.delete(filePath);
    if (this.runningFiles.has(filePath)) {
      if (this.shouldQueueDuringRun(filePath)) {
        this.queuedGenerations.set(filePath, generation);
      }
      return;
    }

    this.runningFiles.add(filePath);
    try {
      await this.options.executeCheck(filePath);
    } finally {
      this.runningFiles.delete(filePath);
      const queuedGeneration = this.queuedGenerations.get(filePath);
      if (typeof queuedGeneration === 'number' && queuedGeneration > generation) {
        this.queuedGenerations.delete(filePath);
        const timer = setTimeout(() => {
          void this.runScheduledCheck(filePath, queuedGeneration);
        }, this.options.debounceMilliseconds);
        this.pendingTimers.set(filePath, timer);
        return;
      }

      this.queuedGenerations.delete(filePath);
      this.suppressedUntil.set(
        filePath,
        Date.now() + this.options.suppressionMilliseconds,
      );
    }
  }

  /**
   * 実行中保存の追随再実行可否を返す。
   * @param filePath 対象ファイルパスを表す。
   * @returns 追随再実行する場合は true を返す。
   */
  private shouldQueueDuringRun(filePath: string): boolean {
    if (typeof this.options.shouldQueueDuringRun !== 'function') {
      return true;
    }

    return this.options.shouldQueueDuringRun(filePath);
  }
}