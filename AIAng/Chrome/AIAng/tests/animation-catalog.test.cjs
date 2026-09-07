const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('default post keyword folders contain the configured trigger words', () => {
  const keywords = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'shared', 'animation-keywords.json'), 'utf8'));
  assert.equal(keywords.sad.exclusive, true);
  assert.deepEqual(keywords.sad.keywords, ['슬프', '고인', 'rip', '영면', '별세', '슬픔', '명복']);
  assert.ok(keywords.happy.includes('행복'));
  assert.ok(keywords.fun.includes('재미'));
  assert.ok(keywords.korea.includes('대한민국'));
  assert.ok(keywords.scary.includes('공포'));
});

test('animation catalog discovers character folders and normalizes state aliases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiang-animation-catalog-'));
  const script = path.resolve(__dirname, '..', 'scripts', 'generate-animation-catalog.py');
  try {
    for (const state of ['Idle', 'comment', 'newport', 'post', 'menu', 'happy']) {
      const directory = path.join(root, 'My Ang', state);
      fs.mkdirSync(directory, { recursive: true });
      const name = state === 'post' ? 'reading - 2.webp'
        : state === 'happy' ? 'smile - 3.webp' : `${state}.webp`;
      fs.writeFileSync(path.join(directory, name), 'test');
    }
    const keywords = path.join(root, 'animation-keywords.json');
    fs.writeFileSync(keywords, JSON.stringify({
      happy: ['행복', '아름답'],
      sad: { exclusive: true, keywords: ['슬픔'] }
    }));
    const output = path.join(root, 'catalog.json');
    execFileSync('python3', [script, '--root', root, '--output', output, '--keywords', keywords]);
    const catalog = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(catalog.version, 4);
    assert.deepEqual(catalog.keywordRules, [
      { state: 'happy', keywords: ['행복', '아름답'] },
      { state: 'sad', keywords: ['슬픔'], exclusive: true }
    ]);
    assert.deepEqual(catalog.themes.map(theme => theme.id), ['My Ang']);
    assert.match(catalog.themes[0].states.idle[0].path, /My Ang\/Idle\/Idle\.webp$/);
    assert.match(catalog.themes[0].states.newpost[0].path, /My Ang\/newport\/newport\.webp$/);
    assert.match(catalog.themes[0].states.menu[0].path, /My Ang\/menu\/menu\.webp$/);
    assert.equal(catalog.themes[0].states.post[0].maxPlays, 2);
    assert.equal(catalog.themes[0].states.post[0].durationMs, 2400);
    assert.equal(catalog.themes[0].states.happy[0].maxPlays, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
