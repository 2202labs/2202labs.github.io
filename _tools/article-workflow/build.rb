require 'digest'
require 'json'
require 'fileutils'
require 'open3'

root = File.expand_path('../..', __dir__)
Dir.chdir(root) do
  abort 'Jekyll build failed' unless system('bundle', 'exec', 'jekyll', 'build', '--source', '.', '--destination', '_site')
  commit = ENV['ARTICLE_BUILD_COMMIT']
  unless commit
    commit, status = Open3.capture2('git', 'rev-parse', 'HEAD')
    abort 'Cannot identify build commit' unless status.success?
  end
  abort 'Invalid build commit SHA' unless commit.strip.match?(/\A[0-9a-f]{40}\z/)
  articles = Dir.glob('_articles/*.md').to_h do |source|
    slug = File.basename(source, '.md')
    html = "_site/articles/#{slug}/index.html"
    abort "Missing generated article: #{html}" unless File.file?(html)
    [source, { source_sha256: Digest::SHA256.file(source).hexdigest, html_sha256: Digest::SHA256.file(html).hexdigest }]
  end
  File.write('_site/article-validation.json', JSON.pretty_generate({ commit: commit.strip, articles: articles }) + "\n")
end
