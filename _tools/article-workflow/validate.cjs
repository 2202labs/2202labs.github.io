const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${name}`);
  return args[i + 1];
}
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function field(source, name) {
  const value = source.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  return value?.replace(/^(["'])(.*)\1$/, '$2');
}
async function articleEvidence(page) {
  return page.evaluate(() => ({
    text: document.querySelector('.article-shell, .article-content')?.textContent.replace(/\s+/g, ' ').trim(),
    links: [...document.querySelectorAll('.article-shell a, .article-content a')].map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim() })),
    code: [...document.querySelectorAll('.article-content pre code')].map(el => el.textContent.replace(/\r\n/g, '\n'))
  }));
}
function selectArticles() {
  const selected = option('--article');
  if (selected) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(selected)) throw Error('Article must be a filename slug');
    return [`_articles/${selected}.md`];
  }
  const base = option('--base');
  if (base) {
    const changed = git('diff', '--name-only', '--diff-filter=AMR', base, 'HEAD');
    const shared = changed.split('\n').some(f => /^(?:_layouts\/|_includes\/|_data\/|articles\/|assets\/|_tools\/article-workflow\/|style\.css$|_config\.yml$)/.test(f));
    const files = changed.split('\n').filter(f => /^_articles\/[a-z0-9-]+\.md$/.test(f));
    if (!shared && files.length) return files;
  }
  return fs.readdirSync(path.join(root, '_articles')).filter(f => f.endsWith('.md')).map(f => `_articles/${f}`);
}
async function localServer(site) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let filename = path.resolve(site, '.' + pathname);
      if (filename !== site && !filename.startsWith(site + path.sep)) { res.writeHead(403).end(); return; }
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
      fs.createReadStream(filename).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

(async () => {
  const output = path.resolve(option('--output', path.join(root, '_article-checks')));
  fs.mkdirSync(output, { recursive: true });
  const report = { commit: git('rev-parse', 'HEAD'), mode: option('--live') ? 'live' : 'build', sources: {}, results: [], errors: [] };
  let browser, server;
  try {
    const files = selectArticles();
    if (!files.length) throw Error('No articles found');
    const site = path.resolve(option('--site', path.join(root, '_site')));
    const manifestPath = path.join(site, 'article-validation.json');
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
    const artifactCommit = option('--artifact-commit');
    if (manifest && manifest.commit !== report.commit) throw Error('Build manifest is for a different commit; rebuild');
    if (!manifest && (!option('--live') || artifactCommit !== report.commit)) throw Error('Use build.rb, or supply the matching Pages artifact and --artifact-commit for live checks');
    const hosted = await localServer(site);
    server = hosted.server;
    const expectedBase = hosted.base;
    let base = option('--live');
    if (base) {
      const url = new URL(base);
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('Live URL must use HTTP or HTTPS');
      base = url.href.replace(/\/$/, '');
    } else {
      base = expectedBase;
    }
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const page = await browser.newPage();
    const expectedPage = await browser.newPage();
    const categories = fs.readdirSync(path.join(root, 'articles')).filter(f => /\.(md|html)$/.test(f)).map(f => {
      const source = fs.readFileSync(path.join(root, 'articles', f), 'utf8');
      return { title: field(source, 'title'), route: field(source, 'permalink') };
    });
    const checkedLinks = new Set();
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      report.sources[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
      const slug = path.basename(file, '.md');
      const title = field(source, 'title');
      const domain = field(source, 'primary_domain');
      if (!title || !domain) throw Error(`${file}: missing title or primary_domain`);
      const route = `/articles/${slug}/`;
      const htmlHash = createHash('sha256').update(fs.readFileSync(path.join(site, 'articles', slug, 'index.html'))).digest('hex');
      if (manifest && (manifest.articles?.[file]?.source_sha256 !== report.sources[file] || manifest.articles?.[file]?.html_sha256 !== htmlHash)) throw Error(`${slug}: source or generated HTML changed since build; rebuild`);
      const expectedResponse = await expectedPage.goto(expectedBase + route, { waitUntil: 'networkidle' });
      if (expectedResponse.status() !== 200) throw Error(`${slug}: missing expected rendered article`);
      const expectedContent = await articleEvidence(expectedPage);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const response = await page.goto(base + route, { waitUntil: 'networkidle' });
        if (response.status() !== 200) throw Error(`${route}: HTTP ${response.status()}`);
        const result = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
          const headings = [...document.querySelectorAll('.article-content h2[id], .article-content h3[id]')];
          const toc = [...document.querySelectorAll('[data-article-toc] a')];
          return {
            title: document.querySelector('h1')?.textContent.trim(),
            duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
            missingAnchors: toc.filter(a => !document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a => a.hash),
            uncoveredHeadings: headings.filter(h => !toc.some(a => decodeURIComponent(a.hash.slice(1)) === h.id)).map(h => h.id),
            headingCount: headings.length, tocCount: toc.length,
            pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            links: [...document.querySelectorAll('.article-content a, .related-reading a')].map(a => a.getAttribute('href'))
          };
        });
        report.results.push({ file, width, ...result });
        const observedContent = await articleEvidence(page);
        const contentMatchesBuild = JSON.stringify(observedContent) === JSON.stringify(expectedContent);
        Object.assign(report.results.at(-1), { expectedHtmlSha256: htmlHash, contentMatchesBuild });
        await page.screenshot({ path: path.join(output, `${slug}-${width}.png`), fullPage: true });
        await page.screenshot({ path: path.join(output, `${slug}-${width}-top.png`) });
        if (!contentMatchesBuild || result.title !== title || result.duplicateIds.length || result.missingAnchors.length || result.uncoveredHeadings.length || result.headingCount !== result.tocCount || result.pageWidth > width) {
          throw Error(`${slug} at ${width}px: title, IDs, TOC or overflow check failed`);
        }
        for (const href of result.links) {
          if (!href || !href.startsWith('/') || href.startsWith('//')) continue;
          const url = new URL(href, base);
          if (checkedLinks.has(url.href)) continue;
          const linked = await page.request.get(url.href);
          if (linked.status() !== 200) throw Error(`${slug}: broken local link ${href} (${linked.status()})`);
          if (url.hash) {
            await page.goto(url.href);
            if (!await page.evaluate(id => Boolean(document.getElementById(id)), decodeURIComponent(url.hash.slice(1)))) throw Error(`${slug}: broken linked anchor ${href}`);
          }
          checkedLinks.add(url.href);
        }
      }
      const category = categories.find(c => c.title === domain);
      if (!category?.route) throw Error(`${slug}: no category page for ${domain}`);
      for (const listing of ['/articles/', category.route]) {
        const response = await page.goto(base + listing);
        if (response.status() !== 200 || !await page.locator(`a[href="${route}"]`).count()) throw Error(`${slug}: missing listing link on ${listing}`);
        report.results.push({ file, listing, passed: true });
      }
    }
    report.passed = true;
    console.log(`PASS: ${files.length} article(s), desktop/mobile rendering, TOC, IDs, listings and local links`);
  } catch (error) {
    report.passed = false;
    report.errors.push(error.message);
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})();
