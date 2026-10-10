#!/usr/bin/env node
// Research Vault Demo: encrypt fictional research data, then show
// what each role sees when reading it back.
//
// Run inside the labs Docker container:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node research-vault-demo.mjs
//
// This script:
//   1. Encrypts four synthetic research entries (FLE per field)
//   2. Decrypts them as CLERK (researcher) — full access
//   3. Attempts decryption as OUTSIDER — CSA denies keys
//   4. Prints the raw ciphertext (what an attacker's DB dump shows)

import { encryptField, decryptField, newRecordKeyId } from "/challenge/labs/build/cy4kit.live.mjs";

const RESEARCH = [
  {
    project_name:   "Cobalt Strike Beacon Detector",
    classification: "INTERNAL",
    lead:           "Sarah Chen",
    description:    "Custom detection rules for CS beacons in network traffic. YARA signatures and Suricata rules targeting malleable C2 profiles.",
    findings:       "Identified 3 novel evasion techniques in APT campaign DUSTWALKER. Detection rate: 94.2% across 1,200 PCAPs."
  },
  {
    project_name:   "ProjectGhost Exfil Framework",
    classification: "RESTRICTED",
    lead:           "Marcus Rivera",
    description:    "Internal red team exfiltration tool using DNS-over-HTTPS tunneling with AES-256 payload encryption.",
    findings:       "Bypassed 7/8 commercial DLP solutions. Average covert channel throughput: 12 KB/s."
  },
  {
    project_name:   "Acme Financial — Red Team Report",
    classification: "CLIENT CONFIDENTIAL",
    lead:           "Sarah Chen",
    description:    "Full engagement report: external pentest, internal pivot, AD compromise. 47 findings across 3 severity levels.",
    findings:       "Critical: Domain Admin via Kerberoasting in 4 hours. SMB signing disabled on 94% of hosts."
  },
  {
    project_name:   "CVE-2024-31337 Analysis",
    classification: "INTERNAL",
    lead:           "James Park",
    description:    "Zero-day buffer overflow in VPN appliance firmware. Pre-auth RCE via crafted IKEv2 packet.",
    findings:       "Affects firmware 4.2.x through 4.5.3. Single UDP packet, no auth needed. CVSS 9.8."
  }
];

const SENSITIVE_FIELDS = ["description", "findings"];

console.log("=".repeat(70));
console.log("  RESEARCH VAULT DEMO — Cy4Secure Field-Level Encryption");
console.log("=".repeat(70));

// Step 1: Encrypt all sensitive fields
console.log("\n[1] Encrypting research entries...\n");
const encrypted = [];

for (const entry of RESEARCH) {
  const row = { ...entry };
  for (const field of SENSITIVE_FIELDS) {
    const keyId = newRecordKeyId();
    row[field] = await encryptField(entry[field], keyId);
  }
  encrypted.push(row);
  console.log(`  ✓ ${entry.project_name}`);
  console.log(`    description → ${row.description.substring(0, 60)}...`);
  console.log(`    findings    → ${row.findings.substring(0, 60)}...`);
}

// Step 2: Researcher view (CLERK — full access)
console.log("\n" + "=".repeat(70));
console.log("  RESEARCHER VIEW (clerk account — CSA grants all keys)");
console.log("=".repeat(70));

for (const row of encrypted) {
  console.log(`\n--- ${row.project_name} [${row.classification}] ---`);
  for (const field of SENSITIVE_FIELDS) {
    const plaintext = await decryptField(row[field], "clerk", field);
    console.log(`  ${field}: ${plaintext}`);
  }
}

// Step 3: Outsider view (no grants — CSA denies)
console.log("\n" + "=".repeat(70));
console.log("  OUTSIDER VIEW (outsider account — CSA denies key requests)");
console.log("=".repeat(70));

for (const row of encrypted) {
  console.log(`\n--- ${row.project_name} [${row.classification}] ---`);
  for (const field of SENSITIVE_FIELDS) {
    const masked = await decryptField(row[field], "outsider", field);
    console.log(`  ${field}: ${masked}`);
  }
}

// Step 4: Attacker view (raw ciphertext from a stolen database)
console.log("\n" + "=".repeat(70));
console.log("  ATTACKER VIEW (raw database dump — no CSA access at all)");
console.log("=".repeat(70));
console.log("\nThe attacker stole every row. Here is what they see:\n");

for (const row of encrypted) {
  console.log(`--- ${row.project_name} [${row.classification}] ---`);
  for (const field of SENSITIVE_FIELDS) {
    console.log(`  ${field}: ${row[field]}`);
  }
  console.log();
}

console.log("=".repeat(70));
console.log("  RESULT: The table was stolen. The research was not.");
console.log("=".repeat(70));
