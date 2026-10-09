# Bonus Mission 6: Cipher in the Cloud — Complete Guide

**Up to 40 points** | Advanced | 5–7 hours

Build a Manifest V3 browser extension on the Cy4Secure SDK that protects a hosted Wekan kanban board, so the vendor stores only what it cannot read.

**Board:** `https://board.cy4challenge.com`
**Prerequisite:** Acts II and VI complete, IP allowlisted, starter kit downloaded, two Chrome profiles set up.

---

## Prerequisites

1. **Ensure Acts II and VI are complete** — you need working knowledge of the Cy4Secure SDK, key management, schemas, and nomadic ciphertext.
2. **Get IP-allowlisted** — Visit `https://board.cy4challenge.com/my-ip`, send the IP shown to your challenge sponsor, and wait for confirmation.
3. **Download the starter kit** — From the Tracker home page, under "From the Challenge team", open "Bonus Mission 6: your starter kit and sign-ins" and download the zip. It contains:
   - A skeleton Chrome extension (Manifest V3, service worker)
   - Two board sign-in credentials (CLERK and OUTSIDER)
   - The Cy4Secure SDK bundle
4. **Set up two Chrome profiles** — One for CLERK (your main working identity), one for OUTSIDER (no key access). This lets you test both perspectives.
5. **Load the extension** — In Chrome, go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", and point it to the starter kit folder.

### Account Roles

| Account | Privileges | Role |
|---------|-----------|------|
| `<you>.clerk` | login, own keys, create keys | Main working identity on the board |
| `<you>.outsider` | login only, no key access | Reader who sees only ciphertext |

---

## Part 1: Make the Extension Work (Steps 1–4, 8 pts)

### Step 1: Sign In & Get the Control Key

1. Sign in to Wekan at `https://board.cy4challenge.com` with the CLERK credentials from the zip.
2. Your extension's service worker calls `GET /cy4/session` to retrieve the current session info (user ID, boards).
3. Call the CSA (Cy4Secure Authority) to fetch or create the Control Key — a 200-character hex value. Store the Control Key ID.
4. Call `PUT /cy4/session` to register your Control Key ID with the vendor so it knows which key to reference.

**Commands (curl):**

```bash
# 1a. Sign in to Wekan, get your token
curl -s https://board.cy4challenge.com/users/login \
  -H "Content-Type: application/json" \
  -d '{"username": "<you>.clerk", "password": "<password>"}'
# Returns: {"id": "<userId>", "token": "<token>"}

# 1b. Check your current session (controlKeyId will be null initially)
curl -s https://board.cy4challenge.com/cy4/session \
  -H "Authorization: Bearer <token>"
# Returns: {"userId": "...", "controlKeyId": null}

# 1d. Register your Control Key ID with the vendor (after SDK creates it)
curl -s -X PUT https://board.cy4challenge.com/cy4/session \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"controlKeyId": "<controlKeyId>"}'
```

**SDK script — `step1-control-key.mjs`** (run with `CHALLENGER_DIR=... node step1-control-key.mjs`):

```javascript
#!/usr/bin/env node
// Step 1: Sign in, check the Control Key, register it with the vendor.
//
// Run:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node step1-control-key.mjs
//
// cy4kit.live.mjs reads clerk.json / keyset.json from CHALLENGER_DIR and
// builds an authenticated SDK client for each role. The Control Key defaults
// to "5a" x 100 (CY4_CONTROL_KEY env overrides it).

import { encryptField, decryptField } from "/challenge/labs/build/cy4kit.live.mjs";

const BOARD    = "https://board.cy4challenge.com";
const USERNAME = "<you>.clerk";
const PASSWORD = "<password>";

// --- 1a. Sign in to Wekan ---
const loginRes = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

const token  = loginRes.token;
const userId = loginRes.id;
console.log("Signed in:", { userId });

// --- 1b. Check current session ---
const session = await fetch(`${BOARD}/cy4/session`, {
  headers: { "Authorization": `Bearer ${token}` }
}).then(r => r.json());
console.log("Current session:", session);

// The Control Key is baked into cy4kit.live.mjs (default "5a".repeat(100)).
// It is passed to the Cy4SDK constructor as `controlKey` and mixed into
// every key derivation. The vendor only stores its ID, not the value.
//
// If controlKeyId is null, you haven't registered yet. The ID comes from
// the CSA — your challenger dir's keyset.json holds the provisioned key IDs.
// The Control Key's value (the 200-char hex) stays behind the CSA's grant.
console.log("Control Key value used by SDK:", process.env.CY4_CONTROL_KEY || "5a".repeat(100));

if (!session.controlKeyId) {
  // You need to register one. Use the first key from your keyset as the
  // Control Key ID, or create one via the Portal.
  console.log("controlKeyId is null — register it:");
  console.log(`  curl -s -X PUT ${BOARD}/cy4/session \\`);
  console.log(`    -H "Authorization: Bearer ${token}" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"controlKeyId": "<keyId-from-keyset.json-or-Portal>"}'`);
} else {
  console.log("controlKeyId already set:", session.controlKeyId);
}

// --- Quick test: prove encrypt/decrypt round-trips ---
const keyId = (await import("node:fs")).readFileSync(
  (await import("node:path")).join(process.env.CHALLENGER_DIR, "keyset.json"), "utf8"
).replace(/.*"key_ids"\s*:\s*\[/, "").replace(/\].*/, "").split(",")[0].replace(/["\s]/g, "");

const ct = await encryptField("hello from step 1", keyId);
const pt = await decryptField(ct, "clerk", "title");
console.log("\nRound-trip test:");
console.log("  encrypted:", ct);
console.log("  decrypted:", pt);
```

> **Why this matters:** The vendor stores only the Control Key's ID, never the value. The CSA decides who can fetch the actual key. Knowing the ID alone gives nobody access — only accounts with a CSA grant can retrieve it.

**Finding your boardId and listId:**

```bash
# Get your boards
curl -s https://board.cy4challenge.com/api/users/<userId>/boards \
  -H "Authorization: Bearer <token>"

# Get lists in your board
curl -s https://board.cy4challenge.com/api/boards/<boardId>/lists \
  -H "Authorization: Bearer <token>"
```

---

### Step 2: Create the CLE Pool & Write the Schema

1. Generate a pool of 10 CLE keys via the CSA. Each key is selected deterministically: `SHA-256(value_utf8_bytes) mod 10` picks which pool key encrypts a given value.
2. Create one or more FLE keys (a new key per value — used for fields needing strongest protection).
3. Write the schema to the vendor via `PUT /cy4/schema/<boardId>`. The schema specifies which fields get which protection:
   - Card title: `cle` (deterministic, enables search/sort)
   - Card description: `fle` (unique key per value, maximum protection)
   - Comments: `fle`
   - Other fields: choose `cle` or `fle` as appropriate
4. Store a local copy of the schema as your Local Policy — this is your minimum-protection floor for Step 9.

**SDK script — `step2-pool-schema.mjs`** (run with `CHALLENGER_DIR=... node step2-pool-schema.mjs`):

```javascript
#!/usr/bin/env node
// Step 2: Read the pre-provisioned key pool and write the board schema.
//
// Run:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node step2-pool-schema.mjs
//
// The pool key IDs are already provisioned in keyset.json — you don't
// create them from scratch. newRecordKeyId() cycles through them.

import { newRecordKeyId, encryptField, decryptField } from "/challenge/labs/build/cy4kit.live.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BOARD    = "https://board.cy4challenge.com";
const USERNAME = "<you>.clerk";
const PASSWORD = "<password>";
const BOARD_ID = "<boardId>";   // from step 1 — GET /api/users/<userId>/boards

// --- Sign in ---
const { token } = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

// --- Read the pre-provisioned pool from keyset.json ---
const keyset = JSON.parse(
  readFileSync(path.join(process.env.CHALLENGER_DIR, "keyset.json"), "utf8")
);
const poolKeyIds = keyset.key_ids;
console.log(`Pool has ${poolKeyIds.length} key IDs:`, poolKeyIds);

// newRecordKeyId() cycles through the same pool:
console.log("newRecordKeyId() samples:", [
  newRecordKeyId(), newRecordKeyId(), newRecordKeyId()
]);

// --- Build the schema ---
// Use the first 10 pool keys for CLE (or all of them if the pool is 10).
const clePoolIds = poolKeyIds.slice(0, 10);
const schema = {
  version: 1,
  fields: {
    "card.title":        { mode: "cle", security: "S", pool: clePoolIds },
    "card.description":  { mode: "fle" },
    "comment.comment":   { mode: "fle" },
    "customField.value": { mode: "none" }
  }
};
console.log("Schema:", JSON.stringify(schema, null, 2));

// --- Write the schema to the vendor ---
const writeRes = await fetch(`${BOARD}/cy4/schema/${BOARD_ID}`, {
  method:  "PUT",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type":  "application/json"
  },
  body: JSON.stringify(schema)
});
console.log("Schema PUT status:", writeRes.status);

// --- Read it back to confirm ---
const readBack = await fetch(`${BOARD}/cy4/schema/${BOARD_ID}`, {
  headers: { "Authorization": `Bearer ${token}` }
}).then(r => r.json());
console.log("Schema from vendor:", JSON.stringify(readBack, null, 2));

// --- Save the schema as the Local Policy (for Step 9) ---
writeFileSync("local-policy.json", JSON.stringify(schema, null, 2));
console.log("Local policy saved to local-policy.json");

// --- Quick encrypt/decrypt with a pool key ---
const testKeyId = clePoolIds[0];
const ct = await encryptField("Test card title", testKeyId);
const pt = await decryptField(ct, "clerk", "title");
console.log("\nEncrypt round-trip with pool key[0]:");
console.log("  ciphertext:", ct);
console.log("  decrypted: ", pt);
```

**Verify with curl:**

```bash
# 2b. Write the schema to the vendor (or let the SDK code above do it)
curl -s -X PUT https://board.cy4challenge.com/cy4/schema/<boardId> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 1,
    "fields": {
      "card.title":        {"mode": "cle", "security": "S", "pool": ["<keyId1>","<keyId2>","...all 10..."]},
      "card.description":  {"mode": "fle"},
      "comment.comment":   {"mode": "fle"},
      "customField.value": {"mode": "none"}
    }
  }'

# 2c. Read it back to confirm
curl -s https://board.cy4challenge.com/cy4/schema/<boardId> \
  -H "Authorization: Bearer <token>"
```

**Schema modes:**

| Mode | Means |
|------|-------|
| `none` | Stored in the clear. Not everything needs protecting |
| `fle` | Field-level encryption: a new key for every value, so a leaked or granted key opens exactly one value |
| `cle` | Column-level encryption: the same input always gives the same ciphertext, so equal values can still be matched. Draws its key from a pool of ten |

---

### Step 3: Protect Outbound Data (Intercept WebSocket/DDP)

This is the core engineering challenge. Wekan uses Meteor's DDP protocol over WebSocket.

1. Intercept the WebSocket connection to `wss://board.cy4challenge.com/sockjs/<n>/<id>/websocket`.
2. Hook into outbound DDP method calls:
   - `/cards/insertAsync` — new card creation. Encrypt the title (CLE) and description (FLE) before the message leaves the browser.
   - `/cards/update` — card edits. Same encryption on the updated fields.
   - `/card_comments/insert` — comments. Encrypt with FLE.
3. **Draft leakage** — Wekan sends partial text to the server as you type, before you click Save. You must intercept these draft/typing events too and either encrypt them or suppress them entirely. Suppressing is simpler and safer.
4. The encrypted output must be in nomadic ciphertext format: `CY41GHFLE<key-id>...` or `CY41GHCLE<key-id>...` — self-describing so any holder of the right key can decrypt without needing the schema.

**No curl commands for the interception** — that's extension code (below). But you can test the SDK encrypt/decrypt calls directly from the lab shell:

**SDK script — `step3-encrypt-test.mjs`** (run with `CHALLENGER_DIR=... node step3-encrypt-test.mjs`):

```javascript
#!/usr/bin/env node
// Step 3: Test encrypt + decrypt from the lab shell.
//
// Run:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node step3-encrypt-test.mjs
//
// encryptField(value, keyId) encrypts as FLE with nomadic output (CY41GH...).
// decryptField(value, role, column) decrypts — role controls CSA grant check,
// column picks the mask string if the grant is denied.

import { encryptField, decryptField, newRecordKeyId } from "/challenge/labs/build/cy4kit.live.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// --- Load pool key IDs from local-policy.json (saved by step 2) ---
const poolKeyIds = JSON.parse(readFileSync("local-policy.json", "utf8"))
  .fields["card.title"].pool;
console.log("Pool key IDs:", poolKeyIds);

// --- CLE-style encrypt: SHA-256 mod 10 picks the pool key ---
// encryptField always marks protection as FLE in cy4kit.live.mjs.
// For true CLE ciphertext headers in your extension, you'll call
// convertValue directly with { protection: "CLE" } — but the key
// selection logic is the same, and round-trips fine here.
const title     = "Burglary report";
const hash      = createHash("sha256").update(title, "utf8").digest();
const poolIndex = hash[0] % poolKeyIds.length;
const cleKeyId  = poolKeyIds[poolIndex];
console.log(`\nTitle "${title}"`);
console.log(`  SHA-256[0] = ${hash[0]} → pool[${poolIndex}] → key ${cleKeyId}`);

const titleCt = await encryptField(title, cleKeyId);
console.log("  ciphertext:", titleCt);

const titlePt = await decryptField(titleCt, "clerk", "title");
console.log("  decrypted: ", titlePt);

// --- Verify determinism: same title + same key → same ciphertext ---
const titleCt2 = await encryptField(title, cleKeyId);
console.log("  same again:", titleCt2);
console.log("  deterministic?", titleCt === titleCt2);

// --- FLE encrypt: use newRecordKeyId() for each value ---
const description = "Window was forced open on the north side";
const fleKeyId    = newRecordKeyId();
console.log(`\nDescription → FLE key ${fleKeyId}`);

const descCt = await encryptField(description, fleKeyId);
console.log("  ciphertext:", descCt);

const descPt = await decryptField(descCt, "clerk", "description");
console.log("  decrypted: ", descPt);

// --- OUTSIDER cannot decrypt (no grant → masked) ---
const outsiderView = await decryptField(descCt, "outsider", "description");
console.log("\nOUTSIDER sees:", outsiderView);
// Expected: "[masked]" or "[masked: ...]"
```

**Extension code (content script) — WebSocket interception:**

This part runs in the browser, not node. Put it in your content script (`content.js`, injected with `"world": "MAIN"` in manifest.json):

```javascript
// Replace WebSocket to intercept Meteor's DDP connection.
const OriginalWebSocket = window.WebSocket;

window.WebSocket = function(url, protocols) {
  const ws = new OriginalWebSocket(url, protocols);
  const originalSend = ws.send.bind(ws);

  ws.send = async function(data) {
    const msg = JSON.parse(data);

    if (msg.msg === "method") {
      if (msg.method === "/cards/insertAsync") {
        msg.params[0].title = await encryptCLE(msg.params[0].title);
        if (msg.params[0].description)
          msg.params[0].description = await encryptFLE(msg.params[0].description);
      } else if (msg.method === "/cards/update") {
        const mod = msg.params[1]?.$set || {};
        if (mod.title)       mod.title       = await encryptCLE(mod.title);
        if (mod.description) mod.description = await encryptFLE(mod.description);
      } else if (msg.method === "/card_comments/insert") {
        msg.params[0].comment = await encryptFLE(msg.params[0].comment);
      }
      // Suppress draft-save methods to prevent plaintext leakage
      else if (msg.method?.includes("draft")) {
        return; // swallow — plaintext never leaves the browser
      }
    }
    originalSend(JSON.stringify(msg));
  };
  return ws;
};
```

> The `encryptCLE` / `encryptFLE` functions in the extension send messages to the service worker, which holds the SDK client and does the actual CSA calls. The node script above proves the same SDK calls work — port them into your service worker's `onMessage` handler.

**Key points from the PDF:**

- The live connection is a native WebSocket at `wss://board.cy4challenge.com/sockjs/<n>/<id>/websocket`
- A content script can replace `WebSocket`, rewrite what is sent, and wrap what arrives (`onmessage` and `addEventListener`)
- The REST API (`PUT /api/boards/<b>/lists/<l>/cards/<c>`, `POST /api/boards/<b>/cards/<c>/comments`) also exists — work out which path your extension covers and what the other path does with plaintext
- Wekan saves drafts while you type — a hook that covers only card and comment methods leaves the drafts readable to the vendor

---

### Step 4: Read Inbound Data (Decrypt in Collections)

1. Intercept inbound DDP `added`/`changed` messages that populate Meteor's client-side collections.
2. Detect nomadic ciphertext (starts with `CY41GH`).
3. Look up the key ID embedded in the ciphertext, fetch the key from CSA (or cache), and decrypt.
4. Replace the ciphertext with plaintext in the client-side collection so the UI renders readable cards.
5. **Activity log:** Wekan copies card titles into activity log entries. These also arrive as collection updates — decrypt them too, or they'll show ciphertext in the sidebar.

**SDK script — `step4-decrypt-test.mjs`** (run with `CHALLENGER_DIR=... node step4-decrypt-test.mjs`):

```javascript
#!/usr/bin/env node
// Step 4: Read the vendor's stored data and decrypt every CY41GH value.
//
// Run:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node step4-decrypt-test.mjs
//
// decryptField(value, role, column):
//   role  = "clerk" | "outsider"  — controls CSA grant check
//   column = field name for the mask string if access is denied

import { decryptField } from "/challenge/labs/build/cy4kit.live.mjs";

const BOARD    = "https://board.cy4challenge.com";
const USERNAME = "<you>.clerk";
const PASSWORD = "<password>";
const BOARD_ID = "<boardId>";

// --- Sign in ---
const { token } = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

// --- Read what the vendor stores ---
const vendorData = await fetch(`${BOARD}/cy4/vendor/board/${BOARD_ID}`, {
  headers: { "Authorization": `Bearer ${token}` }
}).then(r => r.json());

// --- Decrypt as CLERK ---
console.log("=== CLERK view ===");
for (const card of (vendorData.cards || [])) {
  console.log("\n--- Card ---");
  for (const [field, value] of Object.entries(card)) {
    if (typeof value === "string" && value.includes("CY4")) {
      const plain = await decryptField(value, "clerk", field);
      console.log(`  ${field}: "${plain}"`);
    } else {
      console.log(`  ${field}: ${value}`);
    }
  }
}

for (const comment of (vendorData.comments || [])) {
  if (typeof comment.comment === "string" && comment.comment.includes("CY4")) {
    const plain = await decryptField(comment.comment, "clerk", "comment");
    console.log(`Comment: "${plain}"`);
  }
}

// --- Decrypt as OUTSIDER (should show masks) ---
console.log("\n=== OUTSIDER view ===");
for (const card of (vendorData.cards || [])) {
  for (const [field, value] of Object.entries(card)) {
    if (typeof value === "string" && value.includes("CY4")) {
      const masked = await decryptField(value, "outsider", field);
      console.log(`  ${field}: ${masked}`);
    }
  }
}
```

**Extension code (content script) — inbound DDP decryption:**

This runs in the browser. Add it to the WebSocket wrapper from Step 3:

```javascript
// Inside your WebSocket replacement, wrap inbound messages:
function wrapInbound(ws) {
  const origAEL = ws.addEventListener.bind(ws);
  ws.addEventListener = function(type, listener, opts) {
    if (type === "message") {
      origAEL(type, async function(event) {
        const msg = JSON.parse(event.data);
        if ((msg.msg === "added" || msg.msg === "changed") && msg.fields) {
          for (const [k, v] of Object.entries(msg.fields)) {
            if (typeof v === "string" && v.startsWith("CY41GH")) {
              try {
                msg.fields[k] = await chrome.runtime.sendMessage(
                  { action: "decrypt", ciphertext: v }
                );
              } catch { msg.fields[k] = "[Decryption failed]"; }
            }
          }
        }
        listener.call(ws, new MessageEvent("message", { data: JSON.stringify(msg) }));
      }, opts);
    } else { origAEL(type, listener, opts); }
  };
}
```

**Key points:**

- The page keeps its data in client-side collections: `Package.mongo.Mongo.getCollection("cards")`, same for `card_comments`, `customFields`, etc.
- After a reload the page repaints from them, which is where decrypting for display can happen
- Activity log entries also carry card titles — decrypt those too or the sidebar shows ciphertext
- Check these: open a card and see the description; reload the page and see it again; change a card in a second tab as CLERK and see the first tab show the change, readable

---

## Part 2: Control Key & Modes (Steps 5–7, 12 pts)

### Step 5: OUTSIDER View (4 pts)

1. Open your second Chrome profile (no extension, or extension without the Control Key).
2. Sign in to the board with the OUTSIDER credentials.
3. Demonstrate that the OUTSIDER sees only ciphertext — card titles are `CY41GHCLE...`, descriptions are `CY41GHFLE...`, comments are encrypted.
4. **Screenshot this for your finding submission.**

**Commands:**

```bash
# Sign in as OUTSIDER (via curl to verify, or just use the browser)
curl -s https://board.cy4challenge.com/users/login \
  -H "Content-Type: application/json" \
  -d '{"username": "<you>.outsider", "password": "<password>"}'
```

**Screenshot needed:** OUTSIDER's board view showing ciphertext in card titles, descriptions, and comments.

---

### Step 6: Grant, Read, Revoke (6 pts)

1. As CLERK, grant the OUTSIDER read access to one description's FLE key via the CSA's key-grant mechanism.
2. Load the extension in the OUTSIDER's Chrome profile (with the granted key).
3. Demonstrate that the OUTSIDER can now decrypt and read that one card.
4. As CLERK, revoke the OUTSIDER's access.
5. Demonstrate that the OUTSIDER can no longer decrypt — they see ciphertext again.
6. Document the grant/revoke cycle with screenshots.

**Two paths for grant/revoke:**

- **Programmatically:** SDK calls from the extension's service worker (what the mission means by "CSA's key-grant mechanism")
- **Via Portal UI:** Key Management -> Account Access Control (requires VPN connection to the Portal)

**SDK script — `step6-grant-revoke.mjs`** (run with `CHALLENGER_DIR=... node step6-grant-revoke.mjs`):

```javascript
#!/usr/bin/env node
// Step 6: Demonstrate grant and revoke by decrypting as OUTSIDER before
// and after. The actual grant/revoke is done through the Portal UI
// (Key Management → Account Access Control), because cy4kit.live.mjs
// does not export grant/revoke — those are admin operations on the CSA.
//
// Run:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node step6-grant-revoke.mjs
//
// Workflow:
//   1. Run this script → OUTSIDER gets "[masked]"
//   2. Open Portal (VPN) → Key Management → Account Access Control →
//      add OUTSIDER to the FLE key → "read" access → save
//   3. Run: CHALLENGER_DIR=... node -e "
//        import {clearCache} from '/challenge/labs/build/cy4kit.live.mjs';
//        clearCache();"
//      (clears the SDK's in-memory cache so it re-checks the CSA)
//   4. Run this script again → OUTSIDER can now decrypt
//   5. Revoke in the Portal, clearCache again, run again → "[masked]"

import { encryptField, decryptField, newRecordKeyId, clearCache } from "/challenge/labs/build/cy4kit.live.mjs";

// --- Encrypt a test description as CLERK ---
const keyId = newRecordKeyId();
const description = "Confidential: window was forced open on the north side";
const ct = await encryptField(description, keyId);
console.log("FLE key ID used:", keyId);
console.log("Ciphertext:", ct);

// --- Decrypt as CLERK (should work) ---
const clerkView = await decryptField(ct, "clerk", "description");
console.log("\nCLERK sees:    ", clerkView);

// --- Decrypt as OUTSIDER (masked unless granted) ---
clearCache(); // drop any cached keys so grant status is re-checked
const outsiderView = await decryptField(ct, "outsider", "description");
console.log("OUTSIDER sees: ", outsiderView);

if (outsiderView.includes("masked")) {
  console.log("\n→ OUTSIDER is denied. Grant the key in the Portal, then");
  console.log("  clearCache() and run again to confirm the grant works.");
} else {
  console.log("\n→ OUTSIDER can read it — the grant is active.");
  console.log("  Revoke in the Portal, clearCache(), run again to confirm revoke.");
}
```

> **Portal UI path:** Connect to VPN → open the Portal → Key Management → Account Access Control → select the FLE key ID shown above → add the OUTSIDER account → set access to "read" → save. To revoke, remove the OUTSIDER from the key's access list. After each change, call `clearCache()` so the SDK re-checks the CSA.

**Screenshots needed (3):**
1. Before grant — OUTSIDER sees ciphertext
2. After grant — OUTSIDER can read that one card's description
3. After revoke — OUTSIDER sees ciphertext again

---

### Step 7: Deterministic Encryption Analysis (6 pts)

1. Create several cards with duplicate titles (e.g., ten cards titled "TODO").
2. With CLE pool of 10: observe that identical titles produce identical ciphertext (same pool key selected by `SHA-256 mod 10`). With a pool of 10, you should see up to 10 distinct ciphertexts, and every copy of a title under one slot is identical.
3. Change the schema to a pool of 1 and create 10 more. Count again — should be exactly 1 distinct ciphertext.
4. Analyze the privacy tradeoff.

**Commands:**

```bash
# 7a. Create cards with duplicate titles — through the UI (so your extension
#     encrypts them), or via the REST API:
for i in $(seq 1 10); do
  curl -s -X POST "https://board.cy4challenge.com/api/boards/<boardId>/lists/<listId>/cards" \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"title": "TODO"}'
done
# NOTE: If your extension only hooks WebSocket, create cards through the UI instead.
# The REST API sends plaintext unless your extension also intercepts that path.

# 7b. Read the vendor's stored values to count distinct ciphertexts
curl -s https://board.cy4challenge.com/cy4/vendor/board/<boardId> \
  -H "Authorization: Bearer <token>"
# Parse the response and count distinct title values
```

**Debrief answer:** With 1 key, every identical value maps to the same ciphertext — trivial frequency analysis. With 10, the hash distributes values across keys, but identical values still always map to the same key, so duplicates are still detectable. The pool size doesn't eliminate the deterministic property; it only adds a layer.

**Screenshot/evidence needed:** Count of distinct stored ciphertext values for identical titles, with pool of 10 vs pool of 1.

---

## Part 3: Vendor Attacks (Steps 8–10, 10 pts)

### Step 8: Vendor's View (part of tamper detection)

1. Call `GET /cy4/vendor/board/<boardId>` to see what the vendor (server) actually stores.
2. Confirm the vendor sees only ciphertext — no plaintext card data.
3. Screenshot the API response showing encrypted values.

**Commands:**

```bash
# See what the vendor actually stores
curl -s https://board.cy4challenge.com/cy4/vendor/board/<boardId> \
  -H "Authorization: Bearer <token>"
# Screenshot this — all protected fields should show CY41GH... ciphertext
# For each "none" field, note what the vendor learns from it
```

**Screenshot needed:** API response showing ciphertext in every protected field.

---

### Step 9: Schema Downgrade Attack & Local Policy (6 pts)

1. As the "attacker" (vendor), call `PUT /cy4/schema/<boardId>` and change a field's protection from `fle` to `none` — this is a schema downgrade.
2. Your extension must detect this by comparing the vendor's schema against the Local Policy (your stored minimum).
3. The extension must refuse the downgrade — it should either reject the schema and keep using the local policy, or alert the user and block outbound writes until the schema is restored.
4. Demonstrate that after the attempted downgrade, data is still encrypted at the original protection level.

**Simulate the attack (curl):**

```bash
# 9a. As the "attacker" (vendor), downgrade card.description from fle to none
curl -s -X PUT https://board.cy4challenge.com/cy4/schema/<boardId> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 2,
    "fields": {
      "card.title":        {"mode": "cle", "security": "S", "pool": ["<keyId1>","..."]},
      "card.description":  {"mode": "none"},
      "comment.comment":   {"mode": "fle"},
      "customField.value": {"mode": "none"}
    }
  }'

# 9b. Now try creating a card as CLERK with the extension running.
#     The extension should detect the downgrade, refuse it, and keep
#     encrypting at the original level.
```

**SDK script — `step9-check-policy.mjs`** (run with `node step9-check-policy.mjs`):

```javascript
#!/usr/bin/env node
// Step 9: Compare the vendor's current schema against your local policy.
// Run: node step9-check-policy.mjs
//
// Reads local-policy.json (saved by step 2), fetches the vendor's current
// schema, and reports any downgrade. Use this AFTER running the curl attack
// command above to confirm your local policy catches it.

import { readFileSync } from "node:fs";

const BOARD    = "https://board.cy4challenge.com";
const USERNAME = "<you>.clerk";
const PASSWORD = "<password>";
const BOARD_ID = "<boardId>";

// --- Sign in ---
const { token } = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

// --- Load local policy (saved by step 2) ---
const localPolicy = JSON.parse(readFileSync("local-policy.json", "utf8"));
console.log("Local policy:", JSON.stringify(localPolicy, null, 2));

// --- Fetch the vendor's current schema ---
const vendorSchema = await fetch(`${BOARD}/cy4/schema/${BOARD_ID}`, {
  headers: { "Authorization": `Bearer ${token}` }
}).then(r => r.json());
console.log("\nVendor schema:", JSON.stringify(vendorSchema, null, 2));

// --- Compare: vendor must not go below the local minimum ---
const MODE_STRENGTH = { none: 0, cle: 1, fle: 2 };
let downgradeDetected = false;

for (const [field, policy] of Object.entries(localPolicy.fields)) {
  const vendorMode = vendorSchema.fields?.[field]?.mode ?? "none";
  const policyMode = policy.mode;

  if (MODE_STRENGTH[vendorMode] < MODE_STRENGTH[policyMode]) {
    console.error(
      `\nDOWNGRADE DETECTED: "${field}" — vendor says "${vendorMode}", ` +
      `policy requires at least "${policyMode}". REFUSING.`
    );
    downgradeDetected = true;
  } else {
    console.log(`  ${field}: vendor=${vendorMode}, policy=${policyMode} — OK`);
  }

  // Check CLE pool key IDs haven't been swapped
  if (policyMode === "cle" && policy.pool) {
    const vendorPool = vendorSchema.fields[field]?.pool || [];
    const policyPool = policy.pool;
    const match = JSON.stringify([...vendorPool].sort()) ===
                  JSON.stringify([...policyPool].sort());
    if (!match) console.warn(`  WARNING: pool keys changed for "${field}"`);
  }
}

if (downgradeDetected) {
  console.error("\nFail closed: the extension must use the local policy, not the vendor's.");
  process.exit(1);
} else {
  console.log("\nSchema OK — no downgrades.");
}
```

> **Key concept:** The local policy holds the minimum mode per field. The vendor controls the schema endpoint — without this client-side floor, a compromised vendor could silently set every field to `none` and receive plaintext. In your extension, this same logic runs in the service worker every time the schema is fetched; store the local policy in `chrome.storage.local`.

**Screenshot needed:** Extension refusing the downgraded schema + the local policy that triggered the refusal.

---

### Step 10: Tamper Detection (4 pts)

Test these tampering scenarios against stored ciphertext and verify your extension detects each.

**Commands:**

```bash
# First, get the current stored data to find ciphertext values to tamper with:
curl -s https://board.cy4challenge.com/cy4/vendor/board/<boardId> \
  -H "Authorization: Bearer <token>"

# For each tampering test, edit a card's field via the REST API,
# then reload as CLERK and observe what the extension shows:

# 10a. Byte flip — change one hex character in the ciphertext body
curl -s -X PUT "https://board.cy4challenge.com/api/boards/<boardId>/lists/<listId>/cards/<cardId>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "<ciphertext-with-one-byte-changed>"}'

# 10b. Truncation — remove characters from the end of the ciphertext
curl -s -X PUT "https://board.cy4challenge.com/api/boards/<boardId>/lists/<listId>/cards/<cardId>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "<truncated-ciphertext>"}'

# 10c. Swap — copy Card A title ciphertext into Card B title
curl -s -X PUT "https://board.cy4challenge.com/api/boards/<boardId>/lists/<listId>/cards/<cardB_Id>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "<cardA-ciphertext>"}'

# 10d. Key ID change — alter the key ID portion in the CY41GH header
curl -s -X PUT "https://board.cy4challenge.com/api/boards/<boardId>/lists/<listId>/cards/<cardId>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "<ciphertext-with-altered-keyId>"}'
```

For each, the extension must show something distinct:

| What happened | The reader should see |
|--------------|----------------------|
| Value decrypted successfully | The plaintext |
| Reader may not read it (no key access) | That, plainly (not blank) |
| Value was altered or damaged | That, plainly, and the card is not shown as empty |

**Screenshot needed:** What the extension shows for each of the 4 tamper cases — they must look different from each other and from an empty field.

---

## Part 4: Keep It Running (Steps 11–12, 3 pts)

### Step 11: Token Refresh (1.5 pts)

1. The service worker may go idle and wake up later. Session tokens can expire in the meantime.
2. Before every CSA call, check the token's expiry. If expired or near-expiry, refresh it.
3. Store tokens with their expiry timestamps in the service worker's state (or `chrome.storage.session`).
4. Demonstrate the extension works after a long idle period (let the service worker sleep for several minutes, then interact with the board).

**SDK script — `step11-token-refresh.mjs`** (run with `node step11-token-refresh.mjs`):

```javascript
#!/usr/bin/env node
// Step 11: Demonstrate token refresh by logging in, decoding the JWT,
// waiting for it to approach expiry, then re-authenticating.
// Run: node step11-token-refresh.mjs
//
// This prints the iat/exp timestamps the way your extension should log them.
// In the extension, wrap this logic in a getValidToken() function and call it
// before every CSA or board API call.

const BOARD    = "https://board.cy4challenge.com";
const USERNAME = "<you>.clerk";
const PASSWORD = "<password>";

function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
}

// --- First login ---
const res1 = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

const p1 = decodeJwtPayload(res1.token);
console.log("First token:");
console.log(`  iat: ${new Date(p1.iat * 1000).toISOString()}`);
console.log(`  exp: ${new Date(p1.exp * 1000).toISOString()}`);

const ttl = p1.exp - p1.iat;
console.log(`  TTL: ${ttl}s (${(ttl / 60).toFixed(1)} minutes)`);

// --- Check if expired or near-expiry ---
const nowSec = Math.floor(Date.now() / 1000);
const remaining = p1.exp - nowSec;
const BUFFER = 60; // refresh 60s before actual expiry
console.log(`\n  Time remaining: ${remaining}s`);

if (remaining <= BUFFER) {
  console.log("  Token expired or near-expiry — refreshing...");
} else {
  console.log(`  Token still valid for ${remaining - BUFFER}s before refresh needed.`);
  console.log("  Simulating refresh anyway for the screenshot...");
}

// --- Second login (refresh) ---
const res2 = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

const p2 = decodeJwtPayload(res2.token);
console.log("\nRefreshed token:");
console.log(`  iat: ${new Date(p2.iat * 1000).toISOString()}`);
console.log(`  exp: ${new Date(p2.exp * 1000).toISOString()}`);

console.log("\n--- For your extension service worker ---");
console.log("Store tokens in chrome.storage.session (survives SW restarts).");
console.log("Call getValidToken() before every CSA call.");
console.log("Log iat/exp only — never the raw token.");
```

> **In the extension:** Wrap this same logic in a `getValidToken()` function. Store the token in `chrome.storage.session` (survives service worker restarts within a browser session). Check `exp` minus a 60s buffer before every CSA call; if expired, re-authenticate with `POST /users/login`.

**Screenshot needed:** Refresh log lines showing old and new `iat`/`exp` timestamps.

---

### Step 12: Key-Fetch Optimization (1.5 pts)

1. When loading a board with 25+ encrypted cards, a naive implementation makes 25+ individual key-fetch calls to the CSA — one per card.
2. **Batch key fetches** — collect all unique key IDs from the visible cards, deduplicate, and fetch them in as few CSA calls as possible.
3. **Cache keys** — once fetched, cache keys in memory (service worker) or `chrome.storage.session` so subsequent decryptions don't re-fetch.
4. **Avoid governance triggers** — rapid sequential key fetches may trip the CSA's behavioral governance (from Act III). Batching and caching prevent this.
5. Demonstrate with a board of 25+ cards loading smoothly without lag or errors.

**SDK script — `step12-batch-decrypt.mjs`** (run with `CHALLENGER_DIR=... node step12-batch-decrypt.mjs`):

```javascript
#!/usr/bin/env node
// Step 12: Decrypt an entire board and measure timing.
//
// Run:
//   CHALLENGER_DIR=/challenge/orchestration/challengers/<id> \
//     node step12-batch-decrypt.mjs
//
// The SDK caches keys internally after the first fetch. This script
// decrypts all cards twice: first run fills the cache (cold), second
// run hits the cache (warm). Compare the times.

import { decryptField, clearCache } from "/challenge/labs/build/cy4kit.live.mjs";

const BOARD    = "https://board.cy4challenge.com";
const USERNAME = "<you>.clerk";
const PASSWORD = "<password>";
const BOARD_ID = "<boardId>";

// --- Sign in ---
const { token } = await fetch(`${BOARD}/users/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD })
}).then(r => r.json());

// --- Read vendor data ---
const vendorData = await fetch(`${BOARD}/cy4/vendor/board/${BOARD_ID}`, {
  headers: { "Authorization": `Bearer ${token}` }
}).then(r => r.json());

const cards    = vendorData.cards    || [];
const comments = vendorData.comments || [];
console.log(`Board has ${cards.length} cards, ${comments.length} comments`);

// Count encrypted values
let encCount = 0;
for (const card of cards)
  for (const v of Object.values(card))
    if (typeof v === "string" && v.includes("CY4")) encCount++;
for (const c of comments)
  if (typeof c.comment === "string" && c.comment.includes("CY4")) encCount++;
console.log(`Encrypted values to decrypt: ${encCount}`);

// --- Pass 1: cold cache (every key fetched from CSA) ---
clearCache();
const t0 = Date.now();
let decrypted = 0;
for (const card of cards) {
  for (const [field, val] of Object.entries(card)) {
    if (typeof val === "string" && val.includes("CY4")) {
      card[`${field}_plain`] = await decryptField(val, "clerk", field);
      decrypted++;
    }
  }
}
for (const c of comments) {
  if (typeof c.comment === "string" && c.comment.includes("CY4")) {
    c.comment_plain = await decryptField(c.comment, "clerk", "comment");
    decrypted++;
  }
}
const t1 = Date.now();
console.log(`\nCold cache: decrypted ${decrypted} values in ${t1 - t0}ms`);

// --- Pass 2: warm cache (keys already fetched, served from memory) ---
const t2 = Date.now();
let warm = 0;
for (const card of cards) {
  for (const [field, val] of Object.entries(card)) {
    if (typeof val === "string" && val.includes("CY4")) {
      await decryptField(val, "clerk", field);
      warm++;
    }
  }
}
const t3 = Date.now();
console.log(`Warm cache: decrypted ${warm} values in ${t3 - t2}ms`);
console.log(`Speedup: ${((t1 - t0) / (t3 - t2)).toFixed(1)}x`);

// --- Print decrypted cards ---
console.log("\n--- Decrypted cards ---");
for (const card of cards) {
  const title = card.title_plain || card.title;
  const desc  = card.description_plain || card.description || "";
  console.log(`  ${title}${desc ? ": " + desc : ""}`);
}
```

> **Why caching matters:** 25 encrypted cards can mean 25+ CSA round-trips on a cold cache. The SDK caches keys internally after each fetch (cleared by `clearCache()`). In your extension, this cache lives as long as the service worker is awake; persist it to `chrome.storage.session` so it survives restarts. Rapid sequential fetches without caching may also trip the CSA's behavioral governance (Act III lockout: 10 failed calls in 6 minutes can lock the account for up to an hour).

**Screenshot needed:** Board with 25+ encrypted cards loading smoothly, or logs showing batched/cached key fetches.

---

## Screenshot Checklist

| # | What to capture | Step |
|---|----------------|------|
| 1 | CLERK view (plaintext) vs OUTSIDER view (ciphertext) — side by side | 5 |
| 2 | Vendor API response (`GET /cy4/vendor/board/<boardId>`) showing all fields encrypted | 8 |
| 3 | Grant/revoke cycle: OUTSIDER before grant, after grant, after revoke (3 screenshots) | 6 |
| 4 | Duplicate titles: count of distinct ciphertexts with pool=10 vs pool=1 | 7 |
| 5 | Schema downgrade refusal: extension alert/log + local policy | 9 |
| 6 | Tamper detection: extension response for byte flip, truncation, swap, key ID change (4 cases) | 10 |
| 7 | Token refresh log: old and new `iat`/`exp` after service worker wakes from idle | 11 |
| 8 | 25+ cards loading smoothly with batched key fetches | 12 |

---

## Deliverables (Post as Finding)

Title: **Bonus Mission 6: Cipher in the Cloud**

1. The schema you wrote (JSON), and the ten pool key IDs
2. A screenshot of a card as CLERK and the same card as OUTSIDER, side by side
3. The vendor's stored values for the same card: its title, description, and one comment, as returned from the vendor's side
4. The key ID you granted OUTSIDER, and the transcript of the three reads: before, after, revoked
5. The count of distinct stored names for ten identical titles with a pool of ten and with a pool of one
6. The request or log line showing your extension refusing the downgraded schema, and the local policy that refused it
7. What the reader saw for each of the edits in Step 10 (tamper detection)
8. The refresh lines from Step 11 (decoded `iat` and `exp` only, never a raw token)
9. The parts of your source that decide where encryption happens, apply the policy, and fail closed

---

## Debrief Questions (3 pts)

| Question | Key Point |
|----------|-----------|
| Why CLE for titles and FLE for descriptions? | CLE enables server-side equality checks (search/sort); FLE gives maximum confidentiality where search isn't needed |
| What does the vendor learn from CLE-encrypted titles? | Frequency patterns — which cards share a title, how many distinct titles exist |
| Pool of 1 vs pool of 10 — what changes? | Both are deterministic; pool-10 distributes across keys but identical values still collide — frequency analysis is harder but not prevented |
| Why must the local policy exist if the schema is on the vendor? | The vendor controls the schema endpoint — without a local floor, a compromised/malicious vendor can silently downgrade protection |
| What does tamper detection actually prove? | Integrity — that ciphertext hasn't been modified, reordered, or substituted since encryption. Authenticated encryption provides this |
| Why is draft leakage a problem even if the final save is encrypted? | Plaintext hits the server before the user clicks Save; encrypting only on submit still leaks content during typing |

---

## Answer These Too (from the PDF)

1. Where in the page does your extension encrypt, and what path to the vendor could it have missed (the REST API, an import, a draft the page saves before you press Add, anything that is not the page)?
2. Which fields did you leave as `none`, and what does the vendor learn from each?
3. Which field is `cle`, why, and what did the pool of ten change about what the vendor sees?
4. How does your extension decide a schema is too weak, and what does it do on a board that really needs a legitimate field change?
5. A value was altered in the vendor's database. What did your reader show, and how do you tell that apart from an empty field and from a refusal?
6. The vendor can tell anyone a Control Key ID. What stops that from being a problem?

---

## Scoring

| Part | Points |
|------|--------|
| Extension protects and reads the real page, schema driven, live updates included | 8 |
| Control Key taken from the CSA by ID, refused cleanly when it cannot be | 4 |
| `fle` per value, OUTSIDER grant and revoke both ways | 6 |
| `cle` with a pool of ten, distinct counts compared and discussed | 6 |
| Downgraded schema refused by a local policy | 6 |
| Altered, denied and empty look different; the decrypting-but-wrong case named | 4 |
| Token and key-fetch handling through a long session and a heavy page | 3 |
| Answers | 3 |
| **Total** | **40** |

---

## Suggested Build Order

1. **WebSocket interception + encrypt/decrypt (Steps 3–4)** — the hardest engineering; get this working first
2. **Sign-in + Control Key + schema (Steps 1–2)** — needed for #1 to work, but simpler
3. **OUTSIDER demo + grant/revoke (Steps 5–6)** — straightforward once encryption works
4. **Schema downgrade defense (Step 9)** — add local policy comparison logic
5. **Tamper detection (Step 10)** — mostly verifying that authenticated encryption does its job
6. **Deterministic analysis (Step 7)** — create test cards, observe, write up
7. **Token refresh + key caching (Steps 11–12)** — polish and optimization
8. **Debrief answers** — write these last, informed by what you built
