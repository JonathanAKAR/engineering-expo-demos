#!/usr/bin/env node
// Stolen Database Viewer: reads the "stolen" contacts table and
// demonstrates that the ciphertext is unreadable without CSA keys.
//
// Run inside the labs Docker container:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node stolen-db-viewer.mjs
//
// Uses the pre-loaded stolen-db contacts data.

import { decryptField } from "/challenge/labs/build/cy4kit.live.mjs";
import { readFileSync } from "node:fs";

const CONTACTS_PATH = "/challenge/stolen-db/contacts.csv";

console.log("=".repeat(70));
console.log("  STOLEN DATABASE VIEWER — What a breach actually yields");
console.log("=".repeat(70));

// Read the stolen contacts table
let lines;
try {
  const raw = readFileSync(CONTACTS_PATH, "utf8");
  lines = raw.trim().split("\n");
} catch {
  console.log("\n  contacts.csv not found at expected path.");
  console.log("  Run: docker compose exec labs challenge steal");
  process.exit(1);
}

const headers = lines[0].split(",");
console.log(`\nStolen table has ${lines.length - 1} rows, columns: ${headers.join(", ")}\n`);

// Show raw ciphertext
console.log("-".repeat(70));
console.log("  RAW DUMP — What the attacker sees");
console.log("-".repeat(70));

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",");
  console.log(`\nRow ${i}: ${cols[1]} (name in the clear)`);
  console.log(`  ssn:   ${cols[2].substring(0, 70)}...`);
  console.log(`  phone: ${cols[3].substring(0, 70)}...`);
  console.log(`  notes: ${cols[4].substring(0, 70)}...`);
}

// Try to decrypt as CLERK (authorized)
console.log("\n" + "-".repeat(70));
console.log("  CLERK VIEW — Authorized decryption attempt");
console.log("-".repeat(70));

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",");
  console.log(`\nRow ${i}: ${cols[1]}`);
  for (const [fi, fname] of [[2, "ssn"], [3, "phone"], [4, "notes"]]) {
    try {
      const pt = await decryptField(cols[fi], "clerk", fname);
      console.log(`  ${fname}: ${pt}`);
    } catch (e) {
      console.log(`  ${fname}: [decrypt error: ${e.message}]`);
    }
  }
}

// Try to decrypt as OUTSIDER (unauthorized)
console.log("\n" + "-".repeat(70));
console.log("  OUTSIDER VIEW — Unauthorized decryption attempt");
console.log("-".repeat(70));

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(",");
  console.log(`\nRow ${i}: ${cols[1]}`);
  for (const [fi, fname] of [[2, "ssn"], [3, "phone"], [4, "notes"]]) {
    try {
      const pt = await decryptField(cols[fi], "outsider", fname);
      console.log(`  ${fname}: ${pt}`);
    } catch (e) {
      console.log(`  ${fname}: [decrypt error: ${e.message}]`);
    }
  }
}

console.log("\n" + "=".repeat(70));
console.log("  The attacker has the entire table.");
console.log("  Every sensitive field is sealed ciphertext.");
console.log("  Without a CSA grant, the keys stay wrapped.");
console.log("=".repeat(70));
