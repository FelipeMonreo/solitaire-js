const { spawn } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function findBrowser() {
  if (process.env.BROWSER_PATH) {
    if (!existsSync(process.env.BROWSER_PATH)) throw new Error('BROWSER_PATH does not point to an existing executable.');
    return process.env.BROWSER_PATH;
  }
  const candidates = process.platform === 'win32'
    ? [
        join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
        join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const cache = join(process.env.LOCALAPPDATA, 'ms-playwright');
    if (existsSync(cache)) {
      for (const directory of readdirSync(cache).filter(name => /^chromium-\d+$/.test(name))) {
        candidates.push(join(cache, directory, 'chrome-win64/chrome.exe'));
      }
    }
  }

  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Chromium, Chrome, or Edge is required. Set BROWSER_PATH to its executable.');
  return executable;
}

async function launchBrowser() {
  const executable = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), 'solitaire-tests-'));
  const root = join(__dirname, '..');
  const routes = new Map([
    ['/Solitaire-site.html', ['Solitaire-site.html', 'text/html; charset=utf-8']],
    ['/Assets/style.css', ['Assets/style.css', 'text/css; charset=utf-8']],
    ['/Assets/script.js', ['Assets/script.js', 'text/javascript; charset=utf-8']],
  ]);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    const route = routes.get(path);
    if (!route) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': route[1] });
    response.end(readFileSync(join(root, route[0])));
  });

  let child;
  let sessionId;
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  async function close() {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('solitaire-tests-')) {
      throw new Error('Refusing to remove a profile outside the test temporary directory.');
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    child = spawn(executable, [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      ...(process.env.BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--disable-background-networking', '--disable-component-update',
      '--remote-debugging-pipe',
      `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    function receive(data) {
      const message = JSON.parse(data);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(message.params.args.map(argument => argument.value || argument.description).join(' '));
      } else if (message.method === 'Network.loadingFailed') {
        errors.push(message.params.errorText);
      } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        errors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`);
      }
    }
    let buffer = '';
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', chunk => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\0')) !== -1) {
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (message) receive(message);
      }
    });
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser command timed out: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timeout });
        child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
      });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    return {
      send, evaluate, errors, close,
      async reset() {
        errors.length = 0;
        await evaluate('globalThis.__previousTestDocument = true');
        await send('Page.navigate', { url: `${origin}/Solitaire-site.html` });
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await evaluate('!globalThis.__previousTestDocument && document.readyState === "complete" && typeof deck !== "undefined" && deck.length === 24')) return;
          await delay(25);
        }
        throw new Error('The game did not finish loading.');
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { launchBrowser };
