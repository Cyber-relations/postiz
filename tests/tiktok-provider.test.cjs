const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the real provider, consent helper and URL validator. Only decorators,
// transport, DNS and the unrelated base class are replaced. No live API calls.
const root = path.resolve(__dirname, '..');
const cache = new Map();
let transport = async () => { throw new Error('Unexpected network call'); };
const decorators = new Proxy({}, { get: () => () => () => undefined });
class BadBody extends Error {
  constructor(code, _body, _response, message) {
    super(message);
    this.code = code;
  }
}
class SocialAbstract {
  assetBoolean(value) { return typeof value === 'string' ? value.toLowerCase() === 'true' : value || false; }
  async mediaSize() { throw new Error('Must not read stored video size'); }
}
const stubs = {
  'class-validator': decorators,
  'class-transformer': decorators,
  'class-validator-jsonschema': decorators,
  '@gitroom/nestjs-libraries/chat/rules.description.decorator': decorators,
  '@gitroom/nestjs-libraries/integrations/social.abstract': {
    SocialAbstract, BadBody, RefreshToken: class extends Error {}, Disconnect: class extends Error {},
  },
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher': { getSsrfSafeDispatcher: () => ({}) },
  'node:dns/promises': {
    lookup: async (host) => {
      if (host === 'unresolved.example') throw new Error('DNS failure');
      return [{ address: host === 'private.example' ? '10.0.0.1' : '203.0.113.10', family: 4 }];
    },
  },
  dayjs: () => { throw new Error('Unexpected date dependency'); },
};
function loadSource(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const fileName = path.join(root, relative);
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      experimentalDecorators: true,
    },
  });
  assert.equal(diagnostics.length, 0, fileName);
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URL, Buffer, AbortSignal,
    fetch: (...args) => transport(...args),
    require: (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith('node:')) return require(name);
      if (name.startsWith('@gitroom/')) {
        return loadSource(name.replace('@gitroom/', 'libraries/').replace(/^(libraries\/[^/]+)\//, '$1/src/') + '.ts');
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: fileName });
  cache.set(relative, exports);
  return exports;
}
const { TiktokProvider } = loadSource('libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));
const integration = { profile: 'review_creator' };
function post(settings = {}, media = [{ path: 'https://media.example.jp/video.mp4' }]) {
  return {
    id: 'local-post', message: 'User-approved caption', media,
    settings: {
      content_posting_method: 'DIRECT_POST', content_posting_consent: true,
      privacy_level: 'SELF_ONLY', disclose: false,
      duet: false, stitch: false, comment: false,
      brand_content_toggle: false, brand_organic_toggle: false,
      ...settings,
    },
  };
}
function fixture() {
  const provider = new TiktokProvider();
  const calls = [];
  let creatorQueries = 0;
  provider.creatorInfo = async () => {
    creatorQueries++;
    return { privacy_level_options: ['SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: false };
  };
  provider.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://open.tiktokapis.com/v2/post/publish/'), 'No media reads or byte uploads');
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ data: { publish_id: 'publish-1' } }) };
  };
  transport = (...args) => provider.fetch(...args);
  return { provider, calls, creatorQueries: () => creatorQueries };
}
const deliver = (provider, value) => provider.postPending('creator', 'fake-test-token', [value], integration);

for (const method of ['DIRECT_POST', 'UPLOAD']) {
  test(`${method}: server video uses PULL and returns pending without an upload_url`, async () => {
    const f = fixture();
    const [result] = await deliver(f.provider, post({ content_posting_method: method }));
    assert.deepEqual(f.calls.map((call) => call.url), [
      `https://open.tiktokapis.com/v2/post/publish/${method === 'UPLOAD' ? 'inbox/' : ''}video/init/`,
    ]);
    assert.deepEqual(f.calls[0].body.source_info, { source: 'PULL_FROM_URL', video_url: 'https://media.example.jp/video.mp4' });
    assert.equal(f.calls[0].body.post_info.title, 'User-approved caption');
    assert.equal(f.creatorQueries(), method === 'DIRECT_POST' ? 1 : 0);
    assert.deepEqual(plain(result), { id: 'local-post', releaseURL: '', postId: '', status: 'pending', pendingData: { publishId: 'publish-1' } });
  });
  test(`${method}: photo payload remains on content/init with its posting mode`, async () => {
    const f = fixture();
    const media = [{ path: 'https://media.example.jp/a.jpg' }, { path: 'https://media.example.jp/b.jpg' }];
    await deliver(f.provider, post({ content_posting_method: method }, media));
    assert.equal(f.calls[0].url, 'https://open.tiktokapis.com/v2/post/publish/content/init/');
    assert.equal(f.calls[0].body.post_mode, method === 'DIRECT_POST' ? 'DIRECT_POST' : 'MEDIA_UPLOAD');
    assert.equal(f.calls[0].body.media_type, 'PHOTO');
    assert.deepEqual(f.calls[0].body.source_info, { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: media.map((item) => item.path) });
  });
}

test('missing consent stops before creator query and publish init', async () => {
  const f = fixture();
  await assert.rejects(deliver(f.provider, post({ content_posting_consent: false })), { code: 'tiktok-consent-required' });
  assert.equal(f.creatorQueries(), 0);
  assert.equal(f.calls.length, 0);
});

test('changed creator privacy or interactions stop before publish init', async () => {
  for (const settings of [{ privacy_level: 'PUBLIC_TO_EVERYONE' }, { duet: true }, { comment: true }, { stitch: true }]) {
    const f = fixture();
    f.provider.creatorInfo = async () => ({ privacy_level_options: ['SELF_ONLY'], duet_disabled: true, comment_disabled: true, stitch_disabled: true });
    await assert.rejects(deliver(f.provider, post(settings)), { code: 'tiktok-creator-settings-changed' });
    assert.equal(f.calls.length, 0);
  }
});

test('local, HTTP, credentialed, private and unresolved video URLs stop before init', async () => {
  for (const videoPath of [
    '/tmp/video.mp4', 'file:///tmp/video.mp4', 'http://media.example.jp/video.mp4',
    'https://user:secret@media.example.jp/video.mp4', 'https://user@media.example.jp/video.mp4',
    'https://127.0.0.1/video.mp4', 'https://private.example/video.mp4', 'https://unresolved.example/video.mp4',
  ]) {
    const f = fixture();
    await assert.rejects(deliver(f.provider, post({}, [{ path: videoPath }])), { code: 'tiktok-media-url-required' });
    assert.equal(f.calls.length, 0);
  }
});

test('existing server path and signed URL are sent unchanged', async () => {
  for (const videoPath of ['https://post.example.jp/uploads/2026/09/11/a.mp4', 'https://media.example.jp/a.mp4?signature=abc&expires=999']) {
    const f = fixture();
    await deliver(f.provider, post({}, [{ path: videoPath, thumbnailTimestamp: 2000 }]));
    assert.deepEqual(f.calls[0].body.source_info, { source: 'PULL_FROM_URL', video_url: videoPath });
  }
});

test('domain verification errors identify the administrator action without reinitializing', async () => {
  const f = fixture();
  const mapped = f.provider.handleErrors('{"error":{"code":"url_ownership_unverified"}}');
  assert.equal(mapped.type, 'bad-body');
  assert.match(mapped.value, /ドメイン.*所有確認/);
  let initCalls = 0;
  f.provider.fetch = async () => {
    initCalls++;
    return { ok: false, status: 403, json: async () => ({ error: { code: 'url_ownership_unverified' } }) };
  };
  await assert.rejects(deliver(f.provider, post()), { code: 'tiktok-init-rejected', message: mapped.value });
  assert.equal(initCalls, 1);
});

test('PULL download failure stays terminal and does not initialize another post', async () => {
  const f = fixture();
  f.provider.fetch = async (url, options) => {
    f.calls.push({ url, body: JSON.parse(options.body) });
    return { json: async () => ({ data: { status: 'FAILED', fail_reason: 'video_pull_failed' } }) };
  };
  await assert.rejects(f.provider.checkPostStatus('fake-test-token', { publishId: 'publish-1' }, integration), /Failed to pull video/);
  assert.deepEqual(f.calls.map((call) => call.url), ['https://open.tiktokapis.com/v2/post/publish/status/fetch/']);
});

test('legacy blocking post shares one PULL init and resolves through status polling', async () => {
  const f = fixture();
  f.provider.fetch = async (url, options) => {
    f.calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ data: url.endsWith('/status/fetch/')
      ? { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['12345'] }
      : { publish_id: 'publish-1' } }) };
  };
  const [result] = await f.provider.post('creator', 'fake-test-token', [post()], integration);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.source_info.source, 'PULL_FROM_URL');
  assert.equal(f.calls[1].url, 'https://open.tiktokapis.com/v2/post/publish/status/fetch/');
  assert.deepEqual(plain(result), { id: 'local-post', releaseURL: 'https://www.tiktok.com/@review_creator/video/12345', postId: '12345', status: 'success' });
});

test('lost, malformed, empty or ambiguous init responses stop without resending', async () => {
  for (const response of [
    () => { throw new Error('Response lost after acceptance'); },
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
    () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }),
    () => ({ ok: true, status: 200, json: async () => ({ data: { publish_id: ' ' } }) }),
    () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'internal_error' } }) }),
  ]) {
    const f = fixture();
    let calls = 0;
    f.provider.fetch = async (_url, options) => {
      calls++;
      assert.ok(options.signal instanceof AbortSignal);
      return response();
    };
    await assert.rejects(deliver(f.provider, post()), { code: 'tiktok-init-unconfirmed' });
    assert.equal(calls, 1);
  }
});

test('explicit rate limit rejection makes one init request', async () => {
  const f = fixture();
  let calls = 0;
  f.provider.fetch = async () => {
    calls++;
    return { ok: false, status: 429, json: async () => ({ error: { code: 'rate_limit_exceeded' } }) };
  };
  await assert.rejects(deliver(f.provider, post()), { code: 'tiktok-init-rejected' });
  assert.equal(calls, 1);
});

for (const [status, code, errorClass] of [
  [401, 'access_token_invalid', 'RefreshToken'],
  [403, 'reached_active_user_cap', 'Disconnect'],
]) {
  test(`explicit ${code} keeps the existing ${errorClass} classification`, async () => {
    const f = fixture();
    let calls = 0;
    f.provider.fetch = async () => {
      calls++;
      return { ok: false, status, json: async () => ({ error: { code } }) };
    };
    const ExpectedError = stubs['@gitroom/nestjs-libraries/integrations/social.abstract'][errorClass];
    await assert.rejects(deliver(f.provider, post()), (error) => error instanceof ExpectedError);
    assert.equal(calls, 1);
  });
}

test('init uncertainty keeps the no-resend advice through repeated notification formatting', async () => {
  const f = fixture();
  f.provider.fetch = async () => { throw new Error('Response lost'); };
  let failure;
  try { await deliver(f.provider, post()); } catch (error) { failure = error; }
  assert.equal(failure.code, 'tiktok-init-unconfirmed');
  const { toybacoNotificationJa } = loadSource('libraries/nestjs-libraries/src/toybaco/notification.ja.ts');
  const notification = toybacoNotificationJa(
    'Error posting on tiktok for Test Creator',
    `An error occurred while posting on tiktok: ${failure.message}`
  );
  assert.equal(notification.subject, 'TikTokへの投稿の公開を確認できませんでした');
  assert.equal(notification.message, failure.message);
  assert.deepEqual(plain(toybacoNotificationJa(notification.subject, notification.message)), plain(notification));
  const untrusted = toybacoNotificationJa('Error posting on tiktok for Test Creator', 'An error occurred while posting on tiktok: secret-remote-response');
  assert.doesNotMatch(untrusted.message, /secret-remote-response/);
});

test('existing calendar error guidance asks for verification before manual resend', () => {
  const { toybacoPostingFailure } = loadSource('libraries/helpers/src/utils/posts.list.minify.ts');
  const result = toybacoPostingFailure({ state: 'ERROR', toybacoFailureCode: 'POST_PUBLICATION_UNCONFIRMED' });
  assert.match(result.reason, /結果を確認できません/);
  assert.match(result.nextAction, /確認が終わるまで再送を控え/);
});
