import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilesRequestHandler, MAX_FILE_BYTES, ALLOWED_CONTENT_TYPES } from './files-proxy.mjs';

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(chunk) { this.body = chunk; this.ended = true; },
  };
}

// Fake store: every parent exists, metadata reads hit. Each method records its
// call args so tests can assert the function drove them with the caller's uid.
function makeStore(overrides = {}) {
  const calls = { parentExists: [], createFileMeta: [], getFileMeta: [], deleteFileMeta: [] };
  return {
    calls,
    parentExists: async (uid, pt, pid) => { calls.parentExists.push([uid, pt, pid]); return true; },
    createFileMeta: async (uid, pt, pid, fid, data) => { calls.createFileMeta.push({ uid, pt, pid, fid, data }); },
    getFileMeta: async (uid, pt, pid, fid) => { calls.getFileMeta.push([uid, pt, pid, fid]); return { fileName: 'stored.pdf' }; },
    deleteFileMeta: async (uid, pt, pid, fid) => { calls.deleteFileMeta.push([uid, pt, pid, fid]); },
    ...overrides,
  };
}

function makeBucket(overrides = {}) {
  const calls = { save: [], download: [], remove: [] };
  return {
    calls,
    save: async (path, buffer, contentType, metadata) => { calls.save.push({ path, buffer, contentType, metadata }); },
    download: async path => { calls.download.push(path); return { buffer: Buffer.from('FILEBYTES'), contentType: 'application/pdf' }; },
    remove: async path => { calls.remove.push(path); },
    ...overrides,
  };
}

const generateFileId = () => 'fileidABC123'; // matches ID_PATTERN

function makeReq({ method = 'GET', url = '/api/files', uid = 'uid-1', name = 'Jane', headers = {}, rawBody } = {}) {
  return { method, url, omniUid: uid, omniName: name, headers, rawBody };
}

function buildHandler({ store, bucket, generateFileId: gen = generateFileId, now } = {}) {
  return createFilesRequestHandler({
    store: store ?? makeStore(),
    bucket: bucket ?? makeBucket(),
    generateFileId: gen,
    now,
  });
}

async function drive(handler, reqOpts) {
  const res = makeRes();
  await handler(makeReq(reqOpts), res);
  return res;
}

test('exports the shared constants from the contract', () => {
  assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
  assert.deepEqual(ALLOWED_CONTENT_TYPES, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
});

test('405 for an unknown method', async () => {
  const res = await drive(buildHandler(), { method: 'PUT' });
  assert.equal(res.statusCode, 405);
});

test('400 for an unrecognized parentType', async () => {
  const res = await drive(buildHandler(), {
    method: 'GET',
    url: '/api/files?parentType=widgets&parentId=v1&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 400);
});

test('400 for a parentId that breaks the id pattern', async () => {
  const res = await drive(buildHandler(), {
    method: 'GET',
    url: '/api/files?parentType=vendors&parentId=bad.id&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 400);
});

test('POST 415 for a disallowed content type', async () => {
  const res = await drive(buildHandler(), {
    method: 'POST',
    url: '/api/files?parentType=vendors&parentId=v1&fileName=note.txt',
    headers: { 'content-type': 'text/plain' },
    rawBody: Buffer.from('hello'),
  });
  assert.equal(res.statusCode, 415);
});

test('POST 400 for an empty body', async () => {
  const res = await drive(buildHandler(), {
    method: 'POST',
    url: '/api/files?parentType=vendors&parentId=v1&fileName=a.pdf',
    headers: { 'content-type': 'application/pdf' },
    rawBody: Buffer.alloc(0),
  });
  assert.equal(res.statusCode, 400);
});

test('POST 413 when the body exceeds MAX_FILE_BYTES', async () => {
  const res = await drive(buildHandler(), {
    method: 'POST',
    url: '/api/files?parentType=vendors&parentId=v1&fileName=a.pdf',
    headers: { 'content-type': 'application/pdf' },
    rawBody: Buffer.alloc(MAX_FILE_BYTES + 1),
  });
  assert.equal(res.statusCode, 413);
});

test('POST 404 when the parent record does not exist', async () => {
  const store = makeStore({ parentExists: async () => false });
  const res = await drive(buildHandler({ store }), {
    method: 'POST',
    url: '/api/files?parentType=purchases&parentId=p1&fileName=a.pdf',
    headers: { 'content-type': 'application/pdf' },
    rawBody: Buffer.from('%PDF-1.4'),
  });
  assert.equal(res.statusCode, 404);
});

test('POST happy path stores the bytes under the caller uid, writes metadata, and echoes the descriptor', async () => {
  const store = makeStore();
  const bucket = makeBucket();
  const handler = buildHandler({ store, bucket, now: () => 1_700_000_000_000 });
  const payload = Buffer.from('%PDF-1.7 binary bytes \x00\x01\x02');
  const res = await drive(handler, {
    method: 'POST',
    url: `/api/files?parentType=vendors&parentId=v1&fileName=${encodeURIComponent('My Warranty.pdf')}`,
    name: 'Jane Smith',
    headers: { 'content-type': 'application/pdf; charset=utf-8' }, // charset must be stripped
    rawBody: payload,
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body, {
    fileId: 'fileidABC123',
    storagePath: 'userFiles/uid-1/vendors/v1/fileidABC123',
    contentType: 'application/pdf',
    size: payload.length,
    fileName: 'My Warranty.pdf',
  });

  assert.equal(bucket.calls.save.length, 1);
  const saved = bucket.calls.save[0];
  assert.equal(saved.path, 'userFiles/uid-1/vendors/v1/fileidABC123');
  assert.ok(saved.buffer.equals(payload)); // exact bytes, not re-encoded
  assert.equal(saved.contentType, 'application/pdf');
  assert.deepEqual(saved.metadata, { uploadedBy: 'uid-1', fileName: 'My Warranty.pdf' });

  assert.equal(store.calls.createFileMeta.length, 1);
  const { uid, pt, pid, fid, data } = store.calls.createFileMeta[0];
  assert.deepEqual([uid, pt, pid, fid], ['uid-1', 'vendors', 'v1', 'fileidABC123']);
  assert.deepEqual(data, {
    fileName: 'My Warranty.pdf',
    storagePath: 'userFiles/uid-1/vendors/v1/fileidABC123',
    contentType: 'application/pdf',
    size: payload.length,
    createdBy: 'uid-1',
    authorName: 'Jane Smith',
    createdAt: new Date(1_700_000_000_000).toISOString(),
  });
});

test('POST falls back to Explorer when the caller sets no name', async () => {
  const store = makeStore();
  const handler = buildHandler({ store });
  await drive(handler, {
    method: 'POST',
    url: '/api/files?parentType=vendors&parentId=v1&fileName=a.pdf',
    name: '',
    headers: { 'content-type': 'application/pdf' },
    rawBody: Buffer.from('%PDF'),
  });
  assert.equal(store.calls.createFileMeta[0].data.authorName, 'Explorer');
});

test('POST sanitizes a hostile fileName before it reaches Storage or the metadata doc', async () => {
  const store = makeStore();
  const bucket = makeBucket();
  const handler = buildHandler({ store, bucket });
  const res = await drive(handler, {
    method: 'POST',
    url: `/api/files?parentType=vendors&parentId=v1&fileName=${encodeURIComponent('a\r\nb"c/..\\x')}`,
    headers: { 'content-type': 'image/png' },
    rawBody: Buffer.from('PNG'),
  });
  assert.equal(res.statusCode, 200);
  const stored = store.calls.createFileMeta[0].data.fileName;
  assert.doesNotMatch(stored, /[\r\n/\\]/); // control chars + path separators gone
  assert.equal(stored, bucket.calls.save[0].metadata.fileName);
});

test('every store call is scoped by the verified uid, so accounts are isolated structurally', async () => {
  const store = makeStore();
  const bucket = makeBucket();
  const handler = buildHandler({ store, bucket });
  const res = await drive(handler, {
    method: 'GET',
    uid: 'other-uid',
    url: '/api/files?parentType=vendors&parentId=v1&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.calls.getFileMeta, [['other-uid', 'vendors', 'v1', 'fileidABC123']]);
  assert.equal(bucket.calls.download[0], 'userFiles/other-uid/vendors/v1/fileidABC123');
});

test('GET 404 when the metadata doc is missing (deleted attachment stays undownloadable)', async () => {
  const store = makeStore({ getFileMeta: async () => null });
  const bucket = makeBucket();
  const res = await drive(buildHandler({ store, bucket }), {
    method: 'GET',
    url: '/api/files?parentType=vendors&parentId=v1&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 404);
  assert.equal(bucket.calls.download.length, 0); // Storage never consulted
});

test('GET 404 when the Storage object is gone even though metadata lingers', async () => {
  const store = makeStore({ getFileMeta: async () => ({ fileName: 'x.pdf' }) });
  const bucket = makeBucket({ download: async () => null });
  const res = await drive(buildHandler({ store, bucket }), {
    method: 'GET',
    url: '/api/files?parentType=vendors&parentId=v1&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 404);
});

test('GET streams bytes with nosniff/no-store and an RFC 5987 filename* for a hostile name', async () => {
  const store = makeStore({ getFileMeta: async () => ({ fileName: 'a\r\nb"c' }) });
  const bucket = makeBucket(); // default: records the path, returns application/pdf + FILEBYTES
  const res = await drive(buildHandler({ store, bucket }), {
    method: 'GET',
    url: '/api/files?parentType=purchases&parentId=p1&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(bucket.calls.download[0], 'userFiles/uid-1/purchases/p1/fileidABC123');
  assert.equal(res.headers['content-type'], 'application/pdf'); // obj.contentType passed through
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['cache-control'], 'private, no-store');
  const cd = res.headers['content-disposition'];
  assert.equal(cd, "inline; filename*=UTF-8''a%0D%0Ab%22c");
  assert.doesNotMatch(cd, /[\r\n"]/); // header injection impossible
  assert.ok(Buffer.isBuffer(res.body) && res.body.equals(Buffer.from('FILEBYTES')));
});

test('DELETE removes the object idempotently and deletes the metadata doc', async () => {
  const store = makeStore();
  let removed = 0;
  const bucket = makeBucket({ remove: async () => { removed += 1; } }); // missing object is a no-op
  const res = await drive(buildHandler({ store, bucket }), {
    method: 'DELETE',
    url: '/api/files?parentType=vendors&parentId=v1&fileId=fileidABC123',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(removed, 1);
  assert.deepEqual(store.calls.deleteFileMeta, [['uid-1', 'vendors', 'v1', 'fileidABC123']]);
});

test('429 with Retry-After once a uid exceeds the per-verb POST limit, per verb and window', async () => {
  let clock = 1_000_000;
  const handler = buildHandler({ now: () => clock });
  const post = () => drive(handler, {
    method: 'POST',
    url: '/api/files?parentType=vendors&parentId=v1&fileName=a.pdf',
    headers: { 'content-type': 'application/pdf' },
    rawBody: Buffer.from('%PDF'),
  });
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await post()).statusCode, 200); // POST budget is 20/min
  }
  const limited = await post();
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) >= 1);

  // GET keeps its own separate budget.
  const getRes = await drive(handler, {
    method: 'GET',
    url: '/api/files?parentType=vendors&parentId=v1&fileId=fileidABC123',
  });
  assert.equal(getRes.statusCode, 200);

  // The window rolls over.
  clock += 60_000;
  assert.equal((await post()).statusCode, 200);
});
