import { exec } from 'node:child_process';
import { spawn } from 'node:child_process';

// ローカルで隔離実行を有効化する環境変数名を表す
const ISOLATED_TEST_ENVIRONMENT_VARIABLE = 'MAMORI_VSCODE_TEST_ISOLATED';

/**
 * シェルコマンドを実行して標準出力を取得する。
 * @param {string} command 実行コマンドを表す。
 * @returns {Promise<string>} 標準出力を返す。
 */
function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * VS Code プロセスが起動中か判定する。
 * @returns {Promise<boolean>} 起動中ならtrueを返す。
 */
async function hasRunningCodeProcess() {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    const stdout = await execCommand('tasklist');
    return stdout.toLowerCase().includes('code.exe');
  } catch {
    return false;
  }
}

/**
 * vscode-test を実行する。
 * @returns {Promise<number>} 終了コードを返す。
 */
async function run() {
  // 先に起動中の VS Code を検出する
  const hasCodeProcess = await hasRunningCodeProcess();
  const childEnvironment = { ...process.env };

  if (hasCodeProcess) {
    childEnvironment[ISOLATED_TEST_ENVIRONMENT_VARIABLE] = 'true';
    process.stderr.write(
      '警告: 起動中の VS Code を検出しました。統合テストは隔離モードで続行します。\n',
    );
  }

  // vscode-test を子プロセスで起動する
  const child = spawn('npx', ['vscode-test'], {
    stdio: 'inherit',
    shell: true,
    env: childEnvironment,
  });

  return await new Promise((resolve) => {
    child.on('close', (code) => {
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

run()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
