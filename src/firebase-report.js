// firebase-report.js — Calls the Pinnacle Firebase report generation backend.
// Uses Firebase Admin SDK to create/look up a web user by email, mint a custom
// token, exchange it for an ID token via the Firebase Auth REST API, then POST
// to the Pinnacle Cloud Function. Falls back gracefully when Admin SDK or env
// vars are not configured.

'use strict';

const https = require('https');

const FIREBASE_FUNCTIONS_URL = 'https://us-central1-pinnacle-numerology.cloudfunctions.net/api';

// ---------------------------------------------------------------------------
// Internal HTTP helper (keeps firebase-report.js free of extra deps)
// ---------------------------------------------------------------------------
function httpsPost(urlStr, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = JSON.stringify(data);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Lazy Firebase Admin init (shared across calls in the same process)
// ---------------------------------------------------------------------------
let _admin = null;

function getAdmin() {
  if (_admin) return _admin;
  try { _admin = require('firebase-admin'); } catch { return null; }
  return _admin;
}

function ensureAdminInit(serviceAccount) {
  const admin = getAdmin();
  if (!admin) return null;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------
/**
 * Generates a Pinnacle report for a customer by:
 *   1. Getting or creating a Firebase Auth user for customerEmail
 *   2. Minting a custom token for that uid
 *   3. Exchanging the custom token for an ID token via REST
 *   4. POSTing to /report/generate with a Bearer token
 *
 * @param {object} opts
 * @param {string}  opts.productId      - Pinnacle product id (e.g. 'career_edge')
 * @param {object}  opts.personA        - { name, birthdate } for the primary person
 * @param {object}  [opts.personB]      - { name, birthdate } for compatibility reports
 * @param {object}  [opts.discProfile]  - { dominant_type, scores: { D, I, S, C } }
 * @param {string}  opts.customerEmail  - email used to look up / create the Firebase user
 *
 * @returns {Promise<{reportId, downloadUrl, title}|null>}
 *   Returns null when not configured or on error (logged to console).
 */
async function generateReport({ productId, personA, personB, discProfile, customerEmail }) {
  const credsEnv  = process.env.FIREBASE_SERVICE_ACCOUNT;
  const webApiKey = process.env.FIREBASE_WEB_API_KEY;

  if (!credsEnv || !webApiKey) {
    console.warn('[firebase-report] FIREBASE_SERVICE_ACCOUNT or FIREBASE_WEB_API_KEY not set — skipping report generation.');
    return null;
  }

  // Parse service account
  let serviceAccount;
  try { serviceAccount = JSON.parse(credsEnv); }
  catch (e) { console.error('[firebase-report] Invalid FIREBASE_SERVICE_ACCOUNT JSON:', e.message); return null; }

  const admin = ensureAdminInit(serviceAccount);
  if (!admin) {
    console.warn('[firebase-report] firebase-admin package not installed — skipping report generation.');
    return null;
  }

  // 1. Get or create Firebase user
  let uid;
  try {
    const user = await admin.auth().getUserByEmail(customerEmail);
    uid = user.uid;
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      try {
        const newUser = await admin.auth().createUser({ email: customerEmail });
        uid = newUser.uid;
      } catch (ce) {
        console.error('[firebase-report] Failed to create Firebase user:', ce.message);
        return null;
      }
    } else {
      console.error('[firebase-report] Failed to get Firebase user:', e.message);
      return null;
    }
  }

  // 2. Mint custom token
  let customToken;
  try { customToken = await admin.auth().createCustomToken(uid); }
  catch (e) { console.error('[firebase-report] Failed to create custom token:', e.message); return null; }

  // 3. Exchange custom token for ID token via Firebase Auth REST API
  const tokenRes = await httpsPost(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(webApiKey)}`,
    { token: customToken, returnSecureToken: true }
  );

  if (tokenRes.status !== 200 || !tokenRes.body.idToken) {
    console.error('[firebase-report] Token exchange failed:', tokenRes.status, tokenRes.body);
    return null;
  }
  const idToken = tokenRes.body.idToken;

  // 4. Build payload and call /report/generate
  const payload = { product_id: productId, person_a: personA };
  if (personB)     payload.person_b     = personB;
  if (discProfile) payload.disc_profile = discProfile;

  const reportRes = await httpsPost(
    `${FIREBASE_FUNCTIONS_URL}/report/generate`,
    payload,
    { Authorization: `Bearer ${idToken}` }
  );

  if (reportRes.status !== 200) {
    console.error('[firebase-report] Report generation failed:', reportRes.status, reportRes.body);
    return null;
  }

  const result = reportRes.body;
  return {
    reportId:    result.reportId    || result.id   || null,
    downloadUrl: result.downloadUrl || result.url  || null,
    title:       result.title       || productId,
  };
}

module.exports = { generateReport };
