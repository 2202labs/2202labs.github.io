# Article workflow

The main agent prepares a draft PR; Gabriel authorizes publishing a specific commit. The canonical skill is `.agents/skills/2202-article/SKILL.md`. Copy that skill directory to your Codex skills directory for discovery outside this repository.

## Validation

Use Node 22+, Ruby 3.4 and Bundler 2.6.9. The separate Gemfile pins `github-pages` 232 without changing the site's Gemfile. Its lockfile fixes the dependency set. Run from the repository root:

```sh
export BUNDLE_GEMFILE="$PWD/_tools/article-workflow/Gemfile"
bundle install
npm --prefix _tools/article-workflow ci
npm --prefix _tools/article-workflow exec -- playwright install chromium
bundle exec ruby _tools/article-workflow/build.rb
node _tools/article-workflow/validate.cjs --article detection-health
```

In PowerShell, set `$env:BUNDLE_GEMFILE = Join-Path $PWD '_tools/article-workflow/Gemfile'`. Linux may need `playwright install --with-deps chromium`. To use installed Edge locally, set `PLAYWRIGHT_CHANNEL=msedge`. `PLAYWRIGHT_MODULE` may point at an existing Playwright package when using bundled desktop dependencies.

When building a Windows linked worktree through Docker, its Git pointer cannot be resolved inside Linux. Pass `ARTICLE_BUILD_COMMIT` from the host's `git rev-parse HEAD`; the validator still checks that value against host HEAD and verifies the source/output hashes.

Omit `--article` to check every article, or use `--base origin/main` to select added/modified articles between that ref and HEAD. If none changed, both existing articles are checked. Deleted articles are excluded. Run after committing so the report identifies the commit that was checked. Use `git diff --check <base> HEAD` separately for whitespace. Changes to shared layouts/styles warrant checking all articles.

The build helper fingerprints the source and generated HTML at the current commit; stale sources/build output fail validation. The validator serves `_site` locally, checks the article title, TOC coverage and anchors, duplicate IDs, page overflow at 1440/390/320px, main/primary-domain listing links, and local links in article content and related-reading sections. It writes a JSON report and full-page/top screenshots to `_article-checks`. Inspect screenshots for visual issues; automated checks are not a complete design review. External reference URLs and SPL runtime behavior are outside these checks.

Live verification uses the same checks:

```sh
node _tools/article-workflow/validate.cjs --article detection-health --live https://2202labs.github.io
```

Live checks compare normalized article-shell text (header, metadata, body and related reading), link attributes, and exact code-block text against the expected build. The automatic workflow downloads the Pages artifact from the successful deployment run and binds it to that run's commit; it does not rebuild. Manual live checks use your fingerprinted `_site` from `build.rb`.

PRs automatically run `Article validation`. Reports/screenshots are uploaded as artifacts. Following successful normal Pages deployment from main, `Article live verification` retries briefly for propagation and uploads its evidence. These workflows do not merge PRs or deploy the site themselves. Required-check enforcement is a separate repository setting; this change does not alter branch rules.

## Resume state

```sh
node _tools/article-workflow/state.cjs --article detection-health --input /path/to/detection-health.md
node _tools/article-workflow/state.cjs --article detection-health --report _article-checks/report.json --pr https://github.com/2202labs/2202labs.github.io/pull/19
```

Records live under the current Git directory in `article-workflow/<slug>.json`, outside tracked files. They contain input/article hashes, branch, PR and validated commit. The report must pass and match HEAD and the article's current bytes. Changed content invalidates the prior validation. Preserve the state before archiving/removing its worktree. Approval comes from Gabriel's conversation, never from this record.

Typical requests:

- `Use $2202-article to prepare this completed Markdown article for review. Provenance: ...`
- `Gabriel approves publishing PR #N at commit <SHA>. Use $2202-article to verify, merge and monitor deployment.`
