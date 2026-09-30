// Save resumable evidence locally; this script never grants publishing approval.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${name}`);
  return args[i + 1];
}
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
try {
  const slug = option('--article');
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw Error('Provide --article filename-slug');
  const filename = `_articles/${slug}.md`;
  const statePath = path.resolve(root, git('rev-parse', '--git-path', `article-workflow/${slug}.json`));
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { article: filename };
  const input = option('--input');
  if (input) {
    const inputPath = path.resolve(input);
    const inputHash = hash(inputPath);
    if (state.inputSha256 && state.inputSha256 !== inputHash) throw Error('Input changed; review the new source before starting a new record');
    state.inputPath = inputPath;
    state.inputSha256 = inputHash;
  }
  const currentHash = hash(path.join(root, filename));
  if (state.articleSha256 !== currentHash) { delete state.validatedCommit; delete state.validationReport; }
  state.articleSha256 = currentHash;
  state.branch = git('branch', '--show-current');
  const reportPath = option('--report');
  if (reportPath) {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const commit = git('rev-parse', 'HEAD');
    git('cat-file', '-e', `HEAD:${filename}`);
    if (!report.passed || report.mode !== 'build' || report.commit !== commit || report.sources?.[filename] !== currentHash) throw Error('Report is failed, live-only, stale, or does not cover this article');
    git('diff', '--exit-code', 'HEAD', '--', filename);
    state.validatedCommit = commit;
    state.validationReport = path.resolve(reportPath);
  }
  if (state.validatedCommit && state.validatedCommit !== git('rev-parse', 'HEAD')) { delete state.validatedCommit; delete state.validationReport; }
  const pr = option('--pr');
  if (pr) {
    if (!/^https:\/\/github\.com\/2202labs\/2202labs\.github\.io\/pull\/\d+$/.test(pr)) throw Error('PR must belong to the 2202 Labs repository');
    state.pr = pr;
  }
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  console.log(JSON.stringify({ statePath, ...state }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
