const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const hash = text => createHash('sha256').update(text).digest('hex');
function put(root, file, text) { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2202-article-test-'));
  fs.mkdirSync(path.join(root, '_tools/article-workflow'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'validate.cjs'), path.join(root, '_tools/article-workflow/validate.cjs'));
  // Resolve the same installed package after copying the validator into the fixture.
  const module = process.env.PLAYWRIGHT_MODULE || require.resolve('playwright');
  const pages = {};
  for (const slug of ['one', 'two']) {
    const source = `---\ntitle: ${slug}\nprimary_domain: Detection Engineering\n---\n\n## Section\n\nReviewed wording.\n`;
    put(root, `_articles/${slug}.md`, source);
    pages[`/articles/${slug}/`] = `<h1>${slug}</h1><aside data-article-toc><a href="#section">Section</a></aside><div class="article-content"><h2 id="section">Section</h2><p>Reviewed wording.</p></div>`;
    put(root, `_site/articles/${slug}/index.html`, pages[`/articles/${slug}/`]);
  }
  const listing = '<a href="/articles/one/">one</a><a href="/articles/two/">two</a>';
  pages['/articles/'] = listing;
  pages['/articles/detection-engineering/'] = listing;
  put(root, '_site/articles/index.html', listing);
  put(root, '_site/articles/detection-engineering/index.html', listing);
  put(root, 'articles/detection-engineering.md', '---\ntitle: Detection Engineering\npermalink: /articles/detection-engineering/\n---\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Workflow test');
  git(root, 'config', 'user.email', 'workflow-test@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Fixture');
  function manifest() {
    const articles = {};
    for (const slug of ['one', 'two']) articles[`_articles/${slug}.md`] = {
      source_sha256: hash(fs.readFileSync(path.join(root, `_articles/${slug}.md`))),
      html_sha256: hash(fs.readFileSync(path.join(root, `_site/articles/${slug}/index.html`)))
    };
    put(root, '_site/article-validation.json', JSON.stringify({ commit: git(root, 'rev-parse', 'HEAD'), articles }));
  }
  manifest();
  return { root, pages, manifest, module };
}
function run(f, ...args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(f.root, '_tools/article-workflow/validate.cjs'), ...args], {
      cwd: f.root, env: { ...process.env, PLAYWRIGHT_MODULE: f.module }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({ code, output, report: JSON.parse(fs.readFileSync(path.join(f.root, '_article-checks/report.json'))) }));
  });
}

test('valid pages pass, stale source/build evidence fails', async () => {
  const f = fixture();
  const good = await run(f, '--article', 'one');
  assert.equal(good.code, 0, good.output);
  fs.appendFileSync(path.join(f.root, '_articles/one.md'), '\nChanged wording.\n');
  const stale = await run(f, '--article', 'one');
  assert.equal(stale.code, 1);
  assert.match(stale.output, /changed since build/);
});

test('same title with stale live body fails', async () => {
  const f = fixture();
  const server = http.createServer((req, res) => {
    const html = f.pages[req.url];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html' });
    res.end((html || '').replace('Reviewed wording.', 'Previous wording.'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run(f, '--article', 'one', '--live', `http://127.0.0.1:${server.address().port}`);
    assert.equal(result.code, 1);
    assert.equal(result.report.results[0].contentMatchesBuild, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('mixed article/style changes check other articles and catch broken anchors', async () => {
  const f = fixture();
  const base = git(f.root, 'rev-parse', 'HEAD');
  fs.appendFileSync(path.join(f.root, '_articles/one.md'), '\nNew paragraph.\n');
  put(f.root, 'style.css', 'body { color: black; }');
  put(f.root, '_site/articles/two/index.html', f.pages['/articles/two/'].replace('href="#section"', 'href="#missing"'));
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-qm', 'Article and style change');
  f.manifest();
  const result = await run(f, '--base', base);
  assert.equal(result.code, 1);
  const other = result.report.results.find(r => r.file === '_articles/two.md');
  assert.ok(other, 'Other article must be checked');
  assert.deepEqual(other.missingAnchors, ['#missing']);
});
