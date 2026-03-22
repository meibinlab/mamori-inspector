// 断言ユーティリティを表す
import * as assert from 'assert';
// 保存時チェックのスケジューラーを表す
import { SaveCheckScheduler } from '../save-check-scheduler';

/**
 * 指定時間だけ待機する。
 * @param milliseconds 待機時間を表す。
 * @returns 待機完了を待つ Promise を返す。
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * 条件を満たすまで待機する。
 * @param predicate 判定関数を表す。
 * @returns 条件成立を待つ Promise を返す。
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) {
      return;
    }
    await wait(10);
  }

  throw new Error('Timed out while waiting for scheduler state');
}

/**
 * 保存時チェックのスケジューラーテストを定義する。
 * @returns 返り値はない。
 */
suite('Save Check Scheduler Test Suite', () => {
  /**
   * 同一ファイルの連続保存をデバウンスできること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Debounces repeated saves for the same file', async() => {
    const executedFiles: string[] = [];
    const scheduler = new SaveCheckScheduler({
      debounceMilliseconds: 20,
      suppressionMilliseconds: 0,
      executeCheck: async(filePath: string) => {
        executedFiles.push(filePath);
      },
    });

    scheduler.schedule('src/main/java/App.java');
    scheduler.schedule('src/main/java/App.java');
    scheduler.schedule('src/main/java/App.java');
    await wait(60);
    scheduler.dispose();

    assert.deepStrictEqual(executedFiles, ['src/main/java/App.java']);
  });

  /**
   * 実行直後の再保存を自己再帰防止のために抑止できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Suppresses immediate follow-up saves after a run', async() => {
    let executionCount = 0;
    const scheduler = new SaveCheckScheduler({
      debounceMilliseconds: 10,
      suppressionMilliseconds: 50,
      executeCheck: async() => {
        executionCount += 1;
      },
    });

    scheduler.schedule('src/main/java/App.java');
    await wait(30);
    scheduler.schedule('src/main/java/App.java');
    await wait(30);
    assert.strictEqual(executionCount, 1);

    await wait(40);
    scheduler.schedule('src/main/java/App.java');
    await wait(30);
    scheduler.dispose();

    assert.strictEqual(executionCount, 2);
  });

  /**
   * 長時間実行中の再保存では完了後に最新状態だけ追随実行されること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Runs one follow-up check after repeated saves during a long-running check', async() => {
    let executionCount = 0;
    let resolveCurrentRun: (() => void) | undefined;
    const scheduler = new SaveCheckScheduler({
      debounceMilliseconds: 10,
      suppressionMilliseconds: 40,
      executeCheck: async() => {
        executionCount += 1;
        await new Promise<void>((resolve) => {
          resolveCurrentRun = resolve;
        });
      },
    });

    scheduler.schedule('src/main/java/App.java');
    await waitFor(() => executionCount === 1);
    scheduler.schedule('src/main/java/App.java');
    scheduler.schedule('src/main/java/App.java');

    if (!resolveCurrentRun) {
      throw new Error('First run resolver was not prepared');
    }
    resolveCurrentRun();
    await waitFor(() => executionCount === 2);

    if (!resolveCurrentRun) {
      throw new Error('Second run resolver was not prepared');
    }
    resolveCurrentRun();
    await wait(60);
    assert.strictEqual(executionCount, 2);
    scheduler.dispose();
  });

  /**
   * 実行中追随が無効な場合は自己再帰由来の再保存を無視できること。
   * @returns 実行完了を待つ Promise を返す。
   */
  test('Skips follow-up checks during a run when queued reruns are disabled', async() => {
    let executionCount = 0;
    let resolveCurrentRun: (() => void) | undefined;
    const scheduler = new SaveCheckScheduler({
      debounceMilliseconds: 10,
      suppressionMilliseconds: 40,
      shouldQueueDuringRun: () => false,
      executeCheck: async() => {
        executionCount += 1;
        await new Promise<void>((resolve) => {
          resolveCurrentRun = resolve;
        });
      },
    });

    scheduler.schedule('src/main/web/main.js');
    await waitFor(() => executionCount === 1);
    scheduler.schedule('src/main/web/main.js');

    if (!resolveCurrentRun) {
      throw new Error('Run resolver was not prepared');
    }
    resolveCurrentRun();
    await wait(60);
    scheduler.dispose();

    assert.strictEqual(executionCount, 1);
  });
});