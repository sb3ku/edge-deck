'use strict';
// Bambu Lab cloud: the picture of each print, from the account's print history.
// The printer only shares its files with a storage device inserted; the cloud
// keeps every sliced job's plate picture ("cover"), exactly as it was sent.
//
// Sign-in happens in Edge Deck's settings: the user types their own account
// email and password (or the emailed code). The password is sent to Bambu Lab
// once and never stored; only the returned access token is kept, encrypted with
// Windows credential protection. The API is not officially documented; paths
// follow the open-source Bambu clients (OrcaSlicer, ha-bambulab).
const HOSTS = { global: 'https://api.bambulab.com', china: 'https://api.bambulab.cn' };
const HEADERS = {
  'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Name': 'OrcaSlicer', 'X-BBL-Client-Type': 'slicer',
  'X-BBL-Client-Version': '01.09.05.51', 'X-BBL-Language': 'en-US', accept: 'application/json', 'Content-Type': 'application/json',
};
const MAX_PICTURE = 4 * 1024 * 1024;
const normal = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const maskEmail = email => String(email).replace(/^(.)(.*)(@.*)$/, (all, first, middle, domain) => `${first}${'•'.repeat(Math.min(6, middle.length))}${domain}`);

function createBambuCloud({ storage, fetch = globalThis.fetch, now = Date.now } = {}) {
  let saved = null, pending = null, lastError = null, names = { at: 0, value: new Map() };
  try { saved = storage?.read() || null; } catch { saved = null; }
  const host = () => HOSTS[saved?.region || pending?.region] || HOSTS.global;

  async function request(method, pathname, { body, token, region } = {}) {
    const response = await fetch(`${HOSTS[region] || host()}${pathname}`, {
      method, headers: { ...HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    let data = null; try { data = await response.json(); } catch {}
    return { status: response.status, ok: response.ok, data: data && typeof data === 'object' ? data : {} };
  }
  function message(data, fallback) {
    const text = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : '';
    return text && text.length < 200 && !/token|password/i.test(text) ? text : fallback;
  }
  function keep(data, account, region) {
    if (typeof data.accessToken !== 'string' || !data.accessToken) throw Error('Bambu Lab did not return a sign-in token.');
    saved = { accessToken: data.accessToken, refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : '',
      expiresAt: Number.isFinite(data.expiresIn) ? now() + data.expiresIn * 1000 : null, account: maskEmail(account), region };
    pending = null; lastError = null; storage?.write(saved);
    return { status: 'signed-in' };
  }

  async function token() {
    if (!saved) return null;
    // Refresh a day before expiry when a refresh token was given.
    if (saved.expiresAt && saved.refreshToken && now() > saved.expiresAt - 86400000) {
      try {
        const { ok, data } = await request('POST', '/v1/user-service/user/refreshtoken', { body: { refreshToken: saved.refreshToken } });
        if (ok && data.accessToken) keep(data, saved.account, saved.region);
      } catch {}
    }
    return saved?.accessToken || null;
  }

  return {
    state() {
      return { connected: Boolean(saved), account: saved?.account || null, region: saved?.region || 'global',
        awaiting: pending ? pending.kind : null, error: lastError };
    },
    // Step one: email and password. Bambu Lab usually answers with an emailed code.
    async signIn({ account, password, region = 'global' } = {}) {
      account = String(account || '').trim(); password = String(password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account) || account.length > 200) throw Error('Enter the email address of your Bambu Lab account.');
      if (!password || password.length > 200) throw Error('Enter your Bambu Lab password.');
      if (!HOSTS[region]) region = 'global';
      const { data } = await request('POST', '/v1/user-service/user/login', { body: { account, password, apiError: '' }, region });
      if (data.accessToken) return keep(data, account, region);
      if (data.loginType === 'verifyCode') {
        await request('POST', '/v1/user-service/user/sendemail/code', { body: { email: account, type: 'codeLogin' }, region });
        pending = { kind: 'code', account, region, at: now() };
        return { status: 'code', message: `Bambu Lab sent a code to ${maskEmail(account)}.` };
      }
      if (data.loginType === 'tfa' && typeof data.tfaKey === 'string') {
        pending = { kind: 'tfa', account, region, tfaKey: data.tfaKey, at: now() };
        return { status: 'code', message: 'Enter the code from your authenticator app.' };
      }
      throw Error(message(data, 'Bambu Lab did not accept that email and password.'));
    },
    // Step two: the emailed or authenticator code.
    async verify({ code } = {}) {
      code = String(code || '').trim();
      if (!pending || now() - pending.at > 15 * 60000) { pending = null; throw Error('Start the sign-in again.'); }
      if (!/^\d{4,8}$/.test(code)) throw Error('Enter the code you received.');
      const { account, region } = pending;
      const { data } = pending.kind === 'tfa'
        ? await request('POST', '/api/sign-in/tfa', { body: { tfaKey: pending.tfaKey, tfaCode: code }, region })
        : await request('POST', '/v1/user-service/user/login', { body: { account, code }, region });
      if (data.accessToken || data.token) return keep({ ...data, accessToken: data.accessToken || data.token }, account, region);
      throw Error(message(data, 'That code was not accepted.'));
    },
    signOut() { saved = null; pending = null; lastError = null; names = { at: 0, value: new Map() }; storage?.write(null); },
    // The names you gave your printers in Bambu Handy / Studio, by serial number.
    async printerNames() {
      if (names.at && now() - names.at < 600000) return names.value;
      const access = await token(); if (!access) return new Map();
      try {
        const { ok, data } = await request('GET', '/v1/iot-service/api/user/bind', { token: access });
        if (ok) names = { at: now(), value: new Map((Array.isArray(data.devices) ? data.devices : [])
          .filter(device => typeof device?.dev_id === 'string' && typeof device.name === 'string' && device.name.trim())
          .map(device => [device.dev_id, device.name.trim().slice(0, 60)])) };
        else names = { at: now() - 540000, value: names.value };
      } catch { names = { at: now() - 540000, value: names.value }; }
      return names.value;
    },

    // The cover picture of the job a printer is running, matched by name.
    async picture(serial, job) {
      const access = await token();
      if (!access || !serial) return null;
      let tasks = [];
      for (const path of [`/v1/user-service/my/tasks?deviceId=${encodeURIComponent(serial)}&limit=10`, '/v1/iot-service/api/user/task']) {
        const { status, ok, data } = await request('GET', path, { token: access });
        if (status === 401) { lastError = 'Bambu Lab sign-in expired. Sign in again.'; return null; }
        if (!ok) continue;
        tasks = Array.isArray(data.hits) ? data.hits : Array.isArray(data.tasks) ? data.tasks : [];
        if (tasks.length) break;
      }
      lastError = null;
      const mine = tasks.filter(task => task && (!task.deviceId || task.deviceId === serial));
      const want = normal(job?.name);
      const task = mine.find(task => want && [task.title, task.designTitle].some(title => normal(title) && (normal(title) === want || want.startsWith(normal(title)) || normal(title).startsWith(want))))
        // Otherwise the newest job on this printer, if it started recently.
        || mine.filter(task => Date.parse(task.startTime) > now() - 2 * 86400000).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0];
      if (!task || typeof task.cover !== 'string') return null;
      let url; try { url = new URL(task.cover); } catch { return null; }
      if (url.protocol !== 'https:') return null;
      // Covers are public object-storage links; no account header is sent to them.
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!response.ok) return null;
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_PICTURE) return null;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_PICTURE || data.length < 8) return null;
      const png = data.readUInt32BE(0) === 0x89504e47, jpeg = data[0] === 0xff && data[1] === 0xd8;
      if (!png && !jpeg) return null;
      return { type: png ? 'image/png' : 'image/jpeg', data, source: 'cloud' };
    },
  };
}

module.exports = { createBambuCloud, maskEmail };
