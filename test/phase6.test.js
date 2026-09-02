// Phase 6 end-to-end test. Run: node test/phase6.test.js
// Runs the FULL pipeline in dry-run mode (no AI key, no SMTP, local storage).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { runAssessment } = require("../src/pipeline");

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log("  ok -", name); }

const TMP = path.join(__dirname, ".tmp6");

(async () => {
  console.log("Phase 6 end-to-end pipeline tests\n");

  // clean tmp
  fs.rmSync(TMP, { recursive: true, force: true });
  const config = {
    outDir: path.join(TMP, "reports"),
    storage: { localStore: path.join(TMP, "assessments.json") },
    adminEmail: "madison-admin@palmbeachplacements.com",
  };
  const submission = {
    person: { firstName: "Dana", lastName: "Rivera", email: "dana@example.com", birthday: "1988-04-12" },
    optional: { birthName: "Dana Rivera", birthplace: "Miami, FL, USA" },
    answers: [5,1,3,4,5,2,3,5,5,5,1,3,4,5,5,1,5],
    config,
  };

  let first;
  await check("full pipeline runs end-to-end (dry-run)", async () => {
    first = await runAssessment(submission);
    assert.ok(first.id && first.inputHash);
    assert.ok(first.archetype && first.archetype.name);
    assert.strictEqual(first.generatedBy, "deterministic"); // no AI key => fallback
  });

  await check("PDF (or HTML fallback) artifact is written to disk", async () => {
    assert.ok(fs.existsSync(first.pdf.path), `missing ${first.pdf.path}`);
    assert.ok(["pdf", "html"].includes(first.pdf.format));
  });

  await check("both participant and admin emails are targeted (dry-run)", async () => {
    const roles = first.email.results.map((r) => r.role).sort();
    assert.deepStrictEqual(roles, ["admin", "participant"]);
    assert.strictEqual(first.email.sent, false); // no SMTP => dry-run
    assert.ok(first.profile.delivery.participantEmailed);
    assert.ok(first.profile.delivery.adminEmailed);
  });

  await check("assessment stored on first run", async () => {
    assert.strictEqual(first.storage.stored, true);
    assert.strictEqual(first.storage.reused, false);
    assert.ok(fs.existsSync(config.storage.localStore));
  });

  await check("identical resubmission is REUSED, not regenerated", async () => {
    const second = await runAssessment(submission);
    assert.strictEqual(second.reused, true);
    assert.strictEqual(second.storage.reused, true);
    assert.strictEqual(second.inputHash, first.inputHash);
  });

  await check("different answers produce a new stored assessment", async () => {
    const changed = { ...submission, answers: [1,5,5,2,3,4,5,1,1,1,5,5,2,1,1,5,1] };
    const res = await runAssessment(changed);
    assert.notStrictEqual(res.inputHash, first.inputHash);
    assert.strictEqual(res.storage.stored, true);
  });

  await check("report has all 4 pages and the legal disclaimer", async () => {
    for (let i = 1; i <= 4; i++) assert.ok(first.report.pages[i].title);
    assert.ok(!Object.values(first.report.pages).some((p) => p.title === "Personality Assessment"));
    assert.ok(/not affiliated/i.test(first.report.disclaimer));
  });

  await check("missing optional data still completes the pipeline", async () => {
    const bare = {
      person: { firstName: "Pat", lastName: "Kim", email: "pat@example.com", birthday: "1995-02-20" },
      optional: {},
      answers: Array(17).fill(3),
      config: { ...config, storage: { localStore: path.join(TMP, "bare.json") } },
    };
    const res = await runAssessment(bare);
    assert.ok(res.id);
    assert.ok(fs.existsSync(res.pdf.path));
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\nAll ${passed} tests passed.`);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
