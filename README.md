# Mamori Inspector
Mamori Inspector is a unified code inspection platform for VS Code that orchestrates multiple analysis tools and presents results in a single, developer-friendly interface.

- Japanese: [README.ja.md](README.ja.md)
- Marketplace display name: Mamori Inspector: Code Quality Guard

## Installation
1. Install the Mamori Inspector extension in VS Code. In the Marketplace listing, it is displayed as Mamori Inspector: Code Quality Guard.
2. Open the target repository as a VS Code workspace.
3. Run the command `Mamori Inspector: Enable In Workspace` for the workspace folder where you want automatic save-time validation.
4. Save a supported file to trigger automatic save-time validation.
5. If you also want validation on commit and push, run the command `Mamori Inspector: Install Git Hooks` once.

## CI
- GitHub Actions runs on `push`, `pull_request`, and `workflow_dispatch`.
- The quality job runs `npm ci`, `npm run compile`, `npm run lint`, and `npm test` on Ubuntu and Windows.
- The integration job runs `xvfb-run -a npm run test:integration` on Ubuntu after the quality job succeeds.
- When a non-prerelease GitHub Release is published, a dedicated release workflow verifies that the release tag matches `package.json` version, accepting both `vX.Y.Z` and `X.Y.Z`, and then publishes to the VS Code Marketplace by using the `VSCE_PAT` secret. Prerelease publishes run the same checks but skip Marketplace publication.

## Initial Setup Notes
- Save-time validation is disabled by default and starts only after you run `Mamori Inspector: Enable In Workspace` for the target workspace folder.
- Git hook validation does not start automatically on extension installation. You must install the managed hooks explicitly.
- Managed pre-commit and pre-push hooks print a warning to stderr and exit successfully when `$REPO_ROOT/.mamori/mamori.js` is missing or the resolved `node` command is unavailable, so stale hooks do not block commit or push.
- If you want to pre-download the managed toolchain before the first validation run, execute `Mamori Inspector: Setup Managed Tools` once.
- `precommit/staged` requires the Git CLI on `PATH` because staged files are resolved with `git diff --cached --name-only --diff-filter=ACMR`.
- For web checkers, Mamori resolves configuration in this order: explicit setting, discovered config file, `package.json` setting, bundled minimal config.
- JavaScript files and HTML inline script checks fall back to the bundled minimal ESLint config when project configuration is not detected. The bundled fallback is intentionally conservative and uses compatibility-oriented core rules.
- TypeScript files use ESLint only when project configuration is provided explicitly, discovered from the workspace, or resolved from `package.json`. Mamori does not apply the bundled JavaScript ESLint fallback to TypeScript files.
- CSS and SCSS and Sass checks, and HTML inline style checks, fall back to the bundled minimal Stylelint config when project configuration is not detected.
- HTML checks fall back to the bundled minimal htmlhint config when project configuration is not detected.

## Managed Tool Provisioning
- Mamori automatically provisions missing managed tools during `run` execution and stores them under `.mamori/tools` and `.mamori/node` in the workspace.
- Use `Mamori Inspector: Setup Managed Tools` when you want to download the managed toolchain in advance.
- Use `Mamori Inspector: Clear Managed Tool Cache` when you want to remove `.mamori/tools` and `.mamori/node` and force a fresh download on the next run.
- CLI equivalents are `mamori.js setup` and `mamori.js cache-clear`.
- During `setup` and `run --execute`, Mamori also updates the local `.git/info/exclude` with the workspace-root `/.mamori/` entry and any discovered repo-relative nested `.mamori` entries on a best-effort basis when the workspace contains a Git repository. This does not modify `.gitignore`, and it does not affect files that are already tracked by Git.

| Tool group | Managed version | Install location | Notes |
| ---- | ---- | ---- | ---- |
| Maven | 3.9.11 | `.mamori/tools/maven/<version>` | Used when `mvn` is not available on `PATH`. |
| Gradle | 8.14.4 | `.mamori/tools/gradle/<version>` | Used when `gradle` is not available on `PATH`. |
| Semgrep | 1.151.0 | `.mamori/tools/python/packages` | Installed with `pip` when `semgrep` is not available on `PATH`. |
| Prettier / ESLint / Stylelint / htmlhint | npm latest at install time | `.mamori/node/node_modules/.bin` | Installed with `npm` and used when a project-local `node_modules/.bin` tool is not available. |

- For web tools, Mamori prefers the nearest project `node_modules/.bin` executable and falls back to `.mamori/node` only when the project copy is missing.
- For Maven, Gradle, and Semgrep, Mamori uses an existing command on `PATH` first and only installs the managed copy when the command is missing.
- Managed Node tool installation requires `npm` on `PATH`. Managed Semgrep installation installs the Semgrep package automatically, but still requires a usable Python launcher such as `py`, `python`, or `python3`. On Windows, Mamori also probes the standard `py` launcher location under the system root.

## Current Behavior
- Java, JavaScript, JavaScript React, TypeScript, TypeScript React, CSS, SCSS, Sass, and HTML files trigger an automatic background check on save with debounce and recursion suppression only when `Mamori Inspector: Enable In Workspace` has been run for that workspace folder.
- Save-time validation formats supported files first, then publishes diagnostics from the generated SARIF.
- If a save-time run ends with an execution error after writing partial SARIF output, Mamori still reflects the diagnostics that were already generated and keeps the failure detail in the output log.
- Save-time validation also shows a toast each time a formatter or checker actually starts, using the saved file name plus the single running tool name.
- JavaScript save-time validation uses `eslint --fix` before checking when explicit or discovered project ESLint configuration is available, and otherwise keeps using Prettier plus Mamori's bundled minimal ESLint config.
- TypeScript save-time validation uses ESLint when project configuration is available through explicit settings, workspace discovery, or `package.json#eslintConfig`.
- CSS and SCSS and Sass save-time validation use Prettier and Stylelint, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal Stylelint config.
- HTML save-time validation also extracts inline style blocks whose type is compatible with CSS into temporary CSS files for Stylelint, maps diagnostics back to the original HTML locations, and removes the temporary files after execution while preferring project Stylelint configuration and otherwise using Mamori's bundled minimal Stylelint config.
- HTML save-time validation uses Prettier and htmlhint, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal htmlhint config.
- HTML save-time validation also extracts inline script blocks without `src` into temporary JavaScript files for ESLint, maps diagnostics back to the original HTML locations, and removes the temporary files after execution while preferring project ESLint configuration and otherwise using Mamori's bundled minimal ESLint config.
- `precommit/staged` resolves staged files via `git diff --cached --name-only --diff-filter=ACMR`, runs Spotless first when available, and re-stages formatted files with `git add -- <files>`.
- `precommit/staged` runs `eslint --fix` for staged direct JavaScript and TypeScript files when project ESLint configuration is available, and otherwise runs Prettier for JavaScript plus CSS, SCSS, Sass, and HTML files before the configured checkers.
- `precommit/staged` includes HTML inline style blocks in the Stylelint target set while keeping HTML files themselves on htmlhint.
- `precommit/staged` includes HTML inline script blocks in the ESLint target set while keeping HTML files themselves on htmlhint.
- `precommit/staged` returns success without running checks when no staged files are detected, and requires the Git CLI on `PATH` for staged-file resolution.
- `prepush/workspace` runs lightweight Java checks plus CPD, and adds SpotBugs only when compiled class roots such as `target/classes` or `build/classes/java/main` exist.
- `prepush/workspace` also runs ESLint, Stylelint, and htmlhint for workspace files, preferring explicit or discovered project configuration and otherwise using Mamori's bundled minimal configs.
- `prepush/workspace` includes HTML inline style blocks in Stylelint by using temporary CSS files and reporting findings on the original HTML locations.
- `prepush/workspace` includes HTML inline script blocks in ESLint by using temporary JavaScript files and reporting findings on the original HTML locations.
- `manual/workspace` currently reuses the lightweight Java check plan, and also runs ESLint, Stylelint, and htmlhint for workspace files by using the same resolution rules as `prepush/workspace`.
- The command `Mamori Inspector: Run Workspace Check` executes a workspace-wide manual check and publishes diagnostics from the generated SARIF.
- When a manual workspace check succeeds, the extension replaces previously published save diagnostics for the same workspace with the latest manual results.
- The commands `Mamori Inspector: Enable In Workspace` and `Mamori Inspector: Disable In Workspace` toggle automatic save-time validation per workspace folder. The default is disabled.
- The command `Mamori Inspector: Setup Managed Tools` downloads the managed Maven, Gradle, Semgrep, Prettier, ESLint, Stylelint, and htmlhint toolchain into the workspace cache.
- The command `Mamori Inspector: Clear Managed Tool Cache` removes the managed cache directories under `.mamori/tools` and `.mamori/node`.
- The commands `Mamori Inspector: Install Git Hooks` and `Mamori Inspector: Uninstall Git Hooks` call the same runner as the CLI and manage `.git/hooks/pre-commit` and `.git/hooks/pre-push`.
- Maven and Gradle build definitions are inspected to resolve Java tooling such as Checkstyle, PMD, Spotless, CPD, and SpotBugs.
- `mamori.js setup` prepares the same managed toolchain as the VS Code setup command and best-effort updates the local `.git/info/exclude` with the workspace-root `/.mamori/` entry and any discovered repo-relative nested `.mamori` entries, while `mamori.js cache-clear` removes the same cache directories as the VS Code cache-clear command.
- `mamori.js hooks install` and `mamori.js hooks uninstall` create or remove managed `pre-commit` and `pre-push` hooks under `.git/hooks`.

## HTML Inline JS And CSS Checks
- Mamori splits HTML validation across htmlhint for markup, ESLint for inline script blocks, and Stylelint for inline style blocks.
- Inline script checks target only `script` tags without `src` whose `type` is omitted, empty, `module`, or a JavaScript MIME type such as `text/javascript`, `application/javascript`, or `application/ecmascript`.
- Parameterized JavaScript MIME types such as `text/javascript; charset=utf-8` are normalized and treated as JavaScript.
- Inline script blocks with non-JavaScript `type` values such as `text/plain` are excluded from ESLint.
- Inline style checks target only `style` tags whose `type` is omitted, empty, `text/css`, or a parameterized `text/css` value such as `text/css; charset=utf-8`.
- Inline style blocks with non-CSS `type` values are excluded from Stylelint.
- Findings from inline script and inline style checks are mapped back to the original HTML locations, and the temporary extracted files are removed after each execution.

## Validation Modes
| Trigger | Starts automatically after extension install | Additional setup | Scope | Notes |
| ---- | ---- | ---- | ---- | ---- |
| Save | No | Run `Mamori Inspector: Enable In Workspace` | Saved file only | Runs when a supported file is saved in a workspace folder where Mamori Inspector is enabled. |
| Pre-commit | No | Run `Mamori Inspector: Install Git Hooks` | Staged files only | Blocks commit on validation failure. |
| Pre-push | No | Run `Mamori Inspector: Install Git Hooks` | Workspace | Blocks push on validation failure, except SpotBugs skip conditions defined in the spec. |
| Manual | No | None | Workspace | Run with `Mamori Inspector: Run Workspace Check`. |

## Save Validation Versus Git Hook Validation
- Save validation does not start until the target workspace folder is enabled with `Mamori Inspector: Enable In Workspace`, and then runs only for the file being saved.
- Save validation is intended for fast editor feedback and updates VS Code Problems from the generated SARIF.
- Git hook validation does not run until the managed hooks are installed.
- Managed hooks also skip with a warning instead of blocking when the local runner file has been removed or the resolved `node` command is unavailable.
- Pre-commit validation runs on staged files only and re-stages formatter changes automatically.
- Pre-push validation runs on the workspace scope and acts as a broader gate before pushing changes.

## Files Required For Each Check
| Check | Files you should prepare | Notes |
| ---- | ---- | ---- |
| Java Checkstyle | `pom.xml`, `build.gradle`, or `build.gradle.kts` with Checkstyle configuration | Java checks are resolved from Maven or Gradle build definitions. |
| Java PMD | `pom.xml`, `build.gradle`, or `build.gradle.kts` with PMD configuration | Java checks are resolved from Maven or Gradle build definitions. |
| Java Spotless | `pom.xml`, `build.gradle`, or `build.gradle.kts` with Spotless configuration | Used for Java formatting during save and pre-commit when configured. |
| Java SpotBugs | `pom.xml`, `build.gradle`, or `build.gradle.kts` with SpotBugs configuration | `prepush/workspace` also needs compiled classes under `target/classes` or `build/classes/java/main`. |
| Java Semgrep | No required config file, or optional `.semgrep.yml` | If `.semgrep.yml` is not present, Mamori uses the default `p/java` ruleset. |
| JavaScript / TypeScript ESLint | Optional: one of `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs`, `eslint.config.ts`, `eslint.config.mts`, `eslint.config.cts`, `.eslintrc`, `.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.json`, `.eslintrc.yaml`, `.eslintrc.yml`, `.eslintrc.ts`, `.eslintrc.mts`, `.eslintrc.cts`, or `package.json` with `eslintConfig` | Mamori prefers project configuration when present. JavaScript files and HTML inline script checks otherwise use a bundled minimal ESLint config, while TypeScript files require project ESLint configuration. |
| CSS / SCSS / Sass Stylelint | Optional: one of `stylelint.config.js`, `stylelint.config.mjs`, `stylelint.config.cjs`, `stylelint.config.ts`, `stylelint.config.mts`, `stylelint.config.cts`, `.stylelintrc`, `.stylelintrc.js`, `.stylelintrc.cjs`, `.stylelintrc.json`, `.stylelintrc.yaml`, `.stylelintrc.yml`, `.stylelintrc.ts`, `.stylelintrc.mts`, `.stylelintrc.cts`, or `package.json` with `stylelint` | Mamori prefers project configuration when present and otherwise uses a bundled minimal Stylelint config for CSS files and HTML inline style checks. |
| HTML htmlhint | Optional: one of `.htmlhintrc`, `.htmlhintrc.js`, `.htmlhintrc.cjs`, `.htmlhintrc.json`, `.htmlhintrc.yaml`, `.htmlhintrc.yml`, or `package.json` with `htmlhint` | Mamori prefers project configuration when present and otherwise uses a bundled minimal htmlhint config for HTML checks. |
| Prettier for JavaScript / CSS / HTML | No Mamori-specific config file is required | If your project uses a Prettier config, keep it in the project as usual so formatting behavior matches your repository rules. |

## Spec
- docs/spec.md

## Runner Structure
- docs/runner-structure.md

