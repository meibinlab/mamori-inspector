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
});