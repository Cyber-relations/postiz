'use strict';
// Real installed HTTP clients, only an ephemeral local fixture. No remote requests.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');

const EXPECTED = Object.freeze({
  'webhook.url.validator.ts': '81091d44c3eb4057bdcfbbf37a3627bf43637a07bd4cb423725547a34856a903',
  'ssrf.safe.dispatcher.ts': '38129e64cbb6c5d8ad152cffcb1099328d58846509acc290a8cfdd3b490adf34',
});

async function verify(root) {
  root = path.resolve(root);
  const directory = path.join(root, 'libraries/nestjs-libraries/src/dtos/webhooks');
  const files = Object.keys(EXPECTED).map(name => path.join(directory, name));
  // Refuse old/drifted/symlinked sources before loading modules or opening a socket.
  for (const [name, digest] of Object.entries(EXPECTED)) {
    const file = path.join(directory, name);
    for (let item = file; item !== root; item = path.dirname(item)) {
      assert.equal(fs.lstatSync(item).isSymbolicLink(), false, 'regular source required');
    }
    assert.equal(fs.lstatSync(file).isFile(), true, 'regular source required');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), digest, 'SSRF source drift');
  }
  const deps = createRequire(path.join(root, 'package.json'));
  const ts = deps('typescript');
  const oldLoader = require.extensions['.ts'];
  const oldOptOut = process.env.DISABLE_SSRF_PROTECTION;
  let dispatcher;
  let server;
  let requests = 0;
  let cases = 0;
  try {
    require.extensions['.ts'] = (module, filename) => {
      assert.ok(files.includes(filename), 'unexpected TypeScript module');
      const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true, esModuleInterop: true, emitDecoratorMetadata: false },
      });
      module._compile(result.outputText, filename);
    };
    const validator = require(files[0]);
    const transport = require(files[1]);
    dispatcher = transport.ssrfSafeDispatcher;
    const blocked = ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254',
      '172.16.0.1', '192.168.0.1', '100.64.0.1', '198.18.0.1', '224.0.0.1',
      '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fe90::1', 'fc00::1', 'ff02::1'];
    for (const address of blocked) { assert.equal(validator.isBlockedIp(address), true); cases++; }
    for (const address of ['1.1.1.1', '2606:4700:4700::1111']) {
      assert.equal(validator.isBlockedIp(address), false); cases++;
    }
    // Preserve the explicit self-hosting opt-out, never enable it for the socket tests.
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    assert.equal(transport.getSsrfSafeDispatcher(), undefined);
    assert.equal(transport.getSsrfSafeAxios(), deps('axios'));
    cases += 2;
    delete process.env.DISABLE_SSRF_PROTECTION;
    assert.equal(transport.getSsrfSafeDispatcher(), dispatcher); cases++;
    server = http.createServer((_req, res) => { requests++; res.end('local fixture'); });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    for (const client of ['undici', 'axios']) {
      for (const host of ['localhost', '127.0.0.1', '[::ffff:127.0.0.1]']) {
        const before = requests;
        const url = `http://${host}:${server.address().port}/fixture`;
        await assert.rejects(async () => {
          if (client === 'undici') {
            const response = await fetch(url, { dispatcher, signal: AbortSignal.timeout(2000) });
            await response.arrayBuffer();
          } else {
            await transport.getSsrfSafeAxios().get(url, { timeout: 2000, proxy: false });
          }
        }, 'private origin must be blocked before connection');
        assert.equal(requests, before, 'private fixture must receive zero requests');
        cases++;
      }
    }
    return { cases, ownLoopbackRequests: requests, socketCases: 6,
      sourceHashes: EXPECTED, installedUndiciVersion: deps('undici/package.json').version,
      actualInstalledAgents: true, sourceTypeScriptLoader: true,
      compiledHTTPControllerOrLiveAPIProven: false };
  } finally {
    if (dispatcher) await dispatcher.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (oldLoader) require.extensions['.ts'] = oldLoader; else delete require.extensions['.ts'];
    if (oldOptOut === undefined) delete process.env.DISABLE_SSRF_PROTECTION;
    else process.env.DISABLE_SSRF_PROTECTION = oldOptOut;
    for (const file of files) delete require.cache[file];
  }
}

module.exports = { verify, EXPECTED };
if (require.main === module) {
  verify(process.argv[2] || '.').then(result => {
    console.log('TOYBACO_SSRF_ORIGIN=PASS ' + JSON.stringify(result));
  }).catch(() => { console.error('ERROR: SSRF origin contract failed'); process.exitCode = 1; });
}
