// Persistence for saved assessments and partner invites.
//
// Render's filesystem is ephemeral: every deploy wipes it. These records hold
// each person's 6-character accessCode, which is printed on their PDF and
// required to retrieve their results, so losing the file locks people out of
// their own reports permanently.
//
// Uses Firestore when FIREBASE_SERVICE_ACCOUNT is present, and falls back to
// the original JSON files otherwise so local development needs no credentials.

const fs = require("fs");
const path = require("path");

let backend = "json";
let db = null;
const paths = { assessments: "", invites: "" };

// ---- JSON fallback, identical behavior to the original helpers -------------

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return {}; }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function assessmentsCol() { return db.collection("assessments"); }
function invitesCol()     { return db.collection("partnerInvites"); }

const normalize = (email) => (email || "").trim().toLowerCase();

// ---- Assessments -----------------------------------------------------------

async function getAssessmentByEmail(email) {
  const key = normalize(email);
  if (!key) return null;
  if (backend === "firestore") {
    const snap = await assessmentsCol().doc(key).get();
    return snap.exists ? snap.data() : null;
  }
  return readJsonFile(paths.assessments)[key] || null;
}

async function saveAssessmentByEmail(email, record) {
  const key = normalize(email);
  if (!key) return;
  if (backend === "firestore") {
    await assessmentsCol().doc(key).set(record, { merge: false });
    return;
  }
  const store = readJsonFile(paths.assessments);
  store[key] = record;
  writeJsonFile(paths.assessments, store);
}

// ---- Partner invites -------------------------------------------------------

async function getAllPartnerInvites() {
  if (backend === "firestore") {
    const snap = await invitesCol().get();
    const out = {};
    snap.forEach((doc) => { out[doc.id] = doc.data(); });
    return out;
  }
  return readJsonFile(paths.invites);
}

async function getPartnerInvite(key) {
  if (!key) return null;
  if (backend === "firestore") {
    const snap = await invitesCol().doc(String(key)).get();
    return snap.exists ? snap.data() : null;
  }
  return readJsonFile(paths.invites)[key] || null;
}

async function savePartnerInvite(key, record) {
  if (!key) return;
  if (backend === "firestore") {
    await invitesCol().doc(String(key)).set(record, { merge: false });
    return;
  }
  const store = readJsonFile(paths.invites);
  store[key] = record;
  writeJsonFile(paths.invites, store);
}

// ---- One-time migration ----------------------------------------------------

async function migrateFile(jsonPath, col, label) {
  if (!fs.existsSync(jsonPath)) return;
  let data;
  try { data = JSON.parse(fs.readFileSync(jsonPath, "utf8")); }
  catch { return; }
  const keys = Object.keys(data || {});
  if (!keys.length) return;
  let moved = 0;
  for (const k of keys) {
    const snap = await col.doc(String(k)).get();
    if (!snap.exists) {
      await col.doc(String(k)).set(data[k]);
      moved++;
    }
  }
  console.log(`[store] migrated ${moved} of ${keys.length} ${label} records into Firestore`);
}

// ---- Init ------------------------------------------------------------------

function init({ assessmentsPath, invitesPath }) {
  paths.assessments = assessmentsPath;
  paths.invites = invitesPath;

  const creds = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!creds) {
    console.log("[store] FIREBASE_SERVICE_ACCOUNT not set, using local JSON files (ephemeral)");
    return;
  }

  let admin;
  try { admin = require("firebase-admin"); }
  catch {
    console.warn("[store] firebase-admin unavailable, using local JSON files");
    return;
  }

  let serviceAccount;
  try { serviceAccount = JSON.parse(creds); }
  catch (e) {
    console.error("[store] FIREBASE_SERVICE_ACCOUNT is not valid JSON:", e.message, "- using local JSON files");
    return;
  }

  try {
    // src/firebase-report.js may have initialized the default app already.
    if (!admin.apps.length) {
      const cert = admin.credential["cert"];
      admin.initializeApp({ credential: cert(serviceAccount) });
    }
    db = admin.firestore();
    backend = "firestore";
    console.log("[store] using Firestore, project", serviceAccount.project_id);

    // Background, non-blocking: never let migration delay or crash startup.
    migrateFile(assessmentsPath, assessmentsCol(), "assessment")
      .then(() => migrateFile(invitesPath, invitesCol(), "partner invite"))
      .catch((e) => console.error("[store] migration failed:", e.message));
  } catch (e) {
    console.error("[store] Firestore init failed:", e.message, "- using local JSON files");
    backend = "json";
    db = null;
  }
}

module.exports = {
  init,
  getAssessmentByEmail,
  saveAssessmentByEmail,
  getAllPartnerInvites,
  getPartnerInvite,
  savePartnerInvite,
  get backend() { return backend; },
};
