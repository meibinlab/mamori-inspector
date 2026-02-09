// IssueとSeverity型を表す
import { Issue, Severity } from './result';

// SARIFログの最小構造を表す
type SarifLog = {
  version: '2.1.0';
  $schema: string;
  runs: SarifRun[];
};

// SARIFの1実行結果を表す
type SarifRun = {
  tool: {
    driver: {
      name: string;
      informationUri?: string;
      rules?: SarifRule[];
    };
  };
  results: SarifResult[];
};

// SARIFのルール定義を表す
type SarifRule = {
  id: string;
  name?: string;
};

// SARIFの結果1件を表す
type SarifResult = {
  ruleId?: string;
  level: 'error' | 'warning' | 'note';
  message: {
    text: string;
  };
  locations?: SarifLocation[];
};

// SARIFの位置情報を表す
type SarifLocation = {
  physicalLocation: {
    artifactLocation: {
      uri: string;
    };
    region?: {
      startLine: number;
      startColumn?: number;
    };
  };
};

// Issue から SARIF 形式を生成する
/**
 * Issue から SARIF 形式を生成する。
 * @param toolName ツール名を表す。
 * @param issues Issueの一覧を表す。
 * @returns SARIFログを返す。
 */
export function toSarif(toolName: string, issues: Issue[]): SarifLog {
  // ルール一覧を表す
  const rules = buildRules(issues);
  // 結果一覧を表す
  const results = issues.map(buildResult);

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            rules: rules.length > 0 ? rules : undefined,
          },
        },
        results,
      },
    ],
  };
}

/**
 * ルール一覧を構築する。
 * @param issues Issueの一覧を表す。
 * @returns ルール一覧を返す。
 */
function buildRules(issues: Issue[]): SarifRule[] {
  // ルールIDの一覧を作成する
  // 既に登録済みのルールID集合を表す
  const seen = new Set<string>();
  // ルール一覧を表す
  const rules: SarifRule[] = [];

  // Issueを順に処理する
  for (const issue of issues) {
    if (!issue.ruleId) {
      continue;
    }
    if (seen.has(issue.ruleId)) {
      continue;
    }
    seen.add(issue.ruleId);
    rules.push({ id: issue.ruleId });
  }

  return rules;
}

/**
 * Issue を SARIF の結果に変換する。
 * @param issue 変換対象のIssueを表す。
 * @returns SARIF結果を返す。
 */
function buildResult(issue: Issue): SarifResult {
  // Issue を SARIF の result に変換する
  // 結果オブジェクトを表す
  const result: SarifResult = {
    ruleId: issue.ruleId,
    level: mapSeverity(issue.severity),
    message: {
      text: issue.message,
    },
  };

  // 位置情報を表す
  const location = buildLocation(issue);
  if (location) {
    result.locations = [location];
  }

  return result;
}

/**
 * Issue から位置情報を構築する。
 * @param issue 変換対象のIssueを表す。
 * @returns 位置情報を返す（無い場合はundefined）。
 */
function buildLocation(issue: Issue): SarifLocation | undefined {
  // 位置情報がない場合は location を省略する
  if (!issue.filePath) {
    return undefined;
  }

  // 位置情報オブジェクトを表す
  const location: SarifLocation = {
    physicalLocation: {
      artifactLocation: {
        uri: issue.filePath,
      },
    },
  };

  if (issue.line && issue.line > 0) {
    location.physicalLocation.region = {
      startLine: issue.line,
      startColumn: issue.column && issue.column > 0 ? issue.column : undefined,
    };
  }

  return location;
}

/**
 * Severity を SARIF の level に変換する。
 * @param severity 重要度を表す。
 * @returns SARIFのlevelを返す。
 */
function mapSeverity(severity: Severity): 'error' | 'warning' | 'note' {
  // Severity を SARIF の level に変換する
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
    default:
      return 'note';
  }
}
