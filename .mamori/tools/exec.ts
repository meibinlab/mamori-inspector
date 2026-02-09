// 子プロセス実行APIを表す
import { spawn } from 'child_process';

// コマンド実行結果を表す
export interface ExecResult {
  // 終了コードを表す
  exitCode: number;
  // 標準出力を表す
  stdout: string;
  // 標準エラー出力を表す
  stderr: string;
}

// コマンド実行オプションを表す
export interface ExecOptions {
  // 作業ディレクトリを表す
  cwd?: string;
  // 環境変数を表す
  env?: NodeJS.ProcessEnv;
  // タイムアウト（ミリ秒）を表す
  timeoutMs?: number;
}

/**
 * 外部コマンドを実行する。
 * @param command 実行するコマンド名を表す。
 * @param args コマンド引数の配列を表す。
 * @param options 実行オプションを表す。
 * @returns 実行結果を返す。
 */
export function execCommand(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  // 外部コマンドを実行して結果を返す
  // resolveは成功時の解決関数、rejectは失敗時の拒否関数を表す
  return new Promise((resolve, reject) => {
    // 子プロセスを表す
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    });

    // 標準出力のバッファを表す
    let stdout = '';
    // 標準エラー出力のバッファを表す
    let stderr = '';
    // 完了フラグを表す
    let finished = false;
    // タイムアウトのIDを表す
    let timeoutId: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        child.kill();
        reject(new Error(`Command timeout after ${options.timeoutMs}ms: ${command}`));
      }, options.timeoutMs);
    }

    // chunkは標準出力のデータ断片を表す
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    // chunkは標準エラー出力のデータ断片を表す
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    // errorはプロセス実行中のエラーを表す
    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    // codeはプロセスの終了コードを表す
    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}
