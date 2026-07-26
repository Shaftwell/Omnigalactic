import { randomUUID } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createQuotesRequestHandler, createRateLimiter } from './quotes-proxy.mjs';
import { createFilesRequestHandler } from './files-proxy.mjs';
import config from './firebase-applet-config.json' with { type: 'json' };

// The same request handler the local Vite dev server mounts at /api/quotes;
// a hosting rewrite points that path here in production. quotes-proxy.mjs is
// a committed copy of scripts/quotes-proxy.mjs, kept identical by
// scripts/functions-sync.test.mjs.
//
// The endpoint is invoker-public (hosting rewrites require it) but refuses
// anonymous callers: a verified Firebase ID token from this project is
// required, checked before any upstream fetch. The per-IP limiter runs
// before token verification so anonymous floods stay cheap; the per-uid
// limiter inside the handler governs authenticated use.
initializeApp();

const perIpLimit = createRateLimiter({ limit: 120, windowMs: 60_000 });
const handler = createQuotesRequestHandler({
  rateLimit: { limit: 30, windowMs: 60_000 },
  keyForRequest: req => req.omniUid,
});

export const quotes = onRequest({ region: 'us-central1', maxInstances: 2 }, async (req, res) => {
  const deny = (status, error) => res.status(status).json({ error });

  // Trust the LAST X-Forwarded-For hop: Google's front end appends the real
  // client IP there, while any leftmost values are attacker-supplied.
  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const ip = hops[hops.length - 1] || req.ip || 'unknown';
  const ipVerdict = perIpLimit(ip);
  if (!ipVerdict.allowed) {
    res.set('Retry-After', String(ipVerdict.retryAfterSec));
    deny(429, 'Too many quote requests; retry shortly.');
    return;
  }

  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!bearer) {
    deny(401, 'Live quotes require signing in to the app.');
    return;
  }
  let token;
  try {
    token = await getAuth().verifyIdToken(bearer[1]);
  } catch {
    deny(401, 'Live quotes require signing in to the app.');
    return;
  }
  if (!token.email_verified) {
    deny(403, 'Live quotes require a verified account.');
    return;
  }

  req.omniUid = token.uid;
  handler(req, res).catch(error => {
    res.status(500).json({ error: error?.message ?? 'Quote lookup failed' });
  });
});

// Preferred Vendors file proxy at /api/files. files-proxy.mjs is a committed
// copy of scripts/files-proxy.mjs, kept identical by scripts/functions-sync.test.mjs.
// It fronts every warranty/invoice upload so clients never touch Cloud Storage
// directly: this function owns the object AND the per-user
// users/{uid}/(vendors|purchases)/{id}/files/{fileId} metadata docs via the
// Admin SDK. Every path is scoped by the verified caller's uid, so one
// account can never reach another account's records or files.
const db = getFirestore(getApp(), config.firestoreDatabaseId);
const filesBucketRef = getStorage().bucket(config.storageBucket);

const parentDoc = (uid, parentType, parentId) =>
  db.collection('users').doc(uid).collection(parentType).doc(parentId);

const filesStore = {
  parentExists: async (uid, parentType, parentId) =>
    (await parentDoc(uid, parentType, parentId).get()).exists,
  createFileMeta: async (uid, parentType, parentId, fileId, data) => {
    await parentDoc(uid, parentType, parentId).collection('files').doc(fileId).set(data);
  },
  getFileMeta: async (uid, parentType, parentId, fileId) => {
    const snap = await parentDoc(uid, parentType, parentId).collection('files').doc(fileId).get();
    return snap.exists ? snap.data() : null;
  },
  deleteFileMeta: async (uid, parentType, parentId, fileId) => {
    await parentDoc(uid, parentType, parentId).collection('files').doc(fileId).delete();
  },
};

const filesBucket = {
  save: async (storagePath, buffer, contentType, metadata) => {
    // Nest the caller's fields under `metadata` so they become object custom metadata.
    await filesBucketRef.file(storagePath).save(buffer, { contentType, metadata: { metadata } });
  },
  download: async storagePath => {
    const file = filesBucketRef.file(storagePath);
    try {
      const [buffer] = await file.download();
      const [meta] = await file.getMetadata();
      return { buffer, contentType: meta.contentType };
    } catch (error) {
      if (error?.code === 404) return null;
      throw error;
    }
  },
  remove: async storagePath => {
    await filesBucketRef.file(storagePath).delete({ ignoreNotFound: true });
  },
};

const filesHandler = createFilesRequestHandler({
  store: filesStore,
  bucket: filesBucket,
  generateFileId: () => randomUUID().replace(/-/g, ''),
});

const filesPerIpLimit = createRateLimiter({ limit: 240, windowMs: 60_000 });

export const files = onRequest({ region: 'us-central1', maxInstances: 2, memory: '512MiB' }, async (req, res) => {
  const deny = (status, error) => res.status(status).json({ error });

  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const ip = hops[hops.length - 1] || req.ip || 'unknown';
  const ipVerdict = filesPerIpLimit(ip);
  if (!ipVerdict.allowed) {
    res.set('Retry-After', String(ipVerdict.retryAfterSec));
    deny(429, 'Too many file requests; retry shortly.');
    return;
  }

  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!bearer) {
    deny(401, 'File access requires signing in to the app.');
    return;
  }
  let token;
  try {
    token = await getAuth().verifyIdToken(bearer[1]);
  } catch {
    deny(401, 'File access requires signing in to the app.');
    return;
  }
  if (!token.email_verified) {
    deny(403, 'File access requires a verified account.');
    return;
  }

  req.omniUid = token.uid;
  req.omniName = token.name || token.email || 'Explorer';
  filesHandler(req, res).catch(error => {
    res.status(500).json({ error: error?.message ?? 'File request failed' });
  });
});
