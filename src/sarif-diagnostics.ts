// Node のファイルシステム API を表す
import * as fs from 'fs';

/**
 * SARIF の結果 1 件を表す。
 */
interface SarifResult {
  /** ルール ID を表す。 */
  ruleId?: string;
  /** SARIF level を表す。 */
  level?: string;
  /** メッセージを表す。 */
  message?: {
    /** 表示文言を表す。 */
    text?: string;
  };
  /** 位置情報一覧を表す。 */
  locations?: SarifLocation[];
}

/**
 * SARIF の位置情報を表す。
 */
interface SarifLocation {
  /** 物理位置を表す。 */
  physicalLocation?: {
    /** ファイル位置を表す。 */
    artifactLocation?: {
      /** ファイル URI を表す。 */
      uri?: string;
    };
    /** 行列情報を表す。 */
    region?: {
      /** 開始行を表す。 */
      startLine?: number;
      /** 開始列を表す。 */
      startColumn?: number;
    };
  };
}

/**
 * SARIF の run を表す。
 */
interface SarifRun {
  /** 結果一覧を表す。 */
  results?: SarifResult[];
}

/**
 * SARIF ログを表す。
 */
interface SarifLog {
  /** run 一覧を表す。 */
  runs?: SarifRun[];
}

/**
 * 正規化済み SARIF finding を表す。
 */
export interface SarifFinding {
  /** ルール ID を表す。 */
  ruleId?: string;
  /** SARIF level を表す。 */
  level?: string;
  /** メッセージを表す。 */
  message: string;
  /** ファイル URI を表す。 */
  uri: string;
  /** 開始行を表す。 */
  startLine: number;
  /** 開始列を表す。 */
  startColumn: number;
}

/**
 * SARIF 文字列を正規化済み finding 一覧へ変換する。
 * @param rawSarif SARIF 文字列を表す。
 * @returns finding 一覧を返す。
 */
export function parseSarifFindings(rawSarif: string): SarifFinding[] {
  const parsed = JSON.parse(rawSarif) as SarifLog;
  const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
  const findings: SarifFinding[] = [];

  for (const run of runs) {
    const results = Array.isArray(run.results) ? run.results : [];
    for (const result of results) {
      const firstLocation = Array.isArray(result.locations) ? result.locations[0] : undefined;
      const physicalLocation = firstLocation?.physicalLocation;
      const artifactUri = physicalLocation?.artifactLocation?.uri;
      if (!artifactUri) {
        continue;
      }

      const region = physicalLocation?.region;
      findings.push({
        ruleId: result.ruleId,
        level: result.level,
        message: result.message?.text || 'Mamori finding',
        uri: artifactUri,
        startLine: Math.max(region?.startLine || 1, 1),
        startColumn: Math.max(region?.startColumn || 1, 1),
      });
    }
  }

  return findings;
}

/**
 * SARIF ファイルを読み込んで finding 一覧へ変換する。
 * @param sarifPath SARIF ファイルパスを表す。
 * @returns finding 一覧を返す。
 */
export function loadSarifFindings(sarifPath: string): SarifFinding[] {
  if (!fs.existsSync(sarifPath)) {
    return [];
  }

  const rawSarif = fs.readFileSync(sarifPath, 'utf8');
  return parseSarifFindings(rawSarif);
}