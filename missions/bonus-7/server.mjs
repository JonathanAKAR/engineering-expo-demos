import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execSync, exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3007;
const CONTAINER = "cy4-challenge";
const SCRIPT_NAME = "exploit-vault-demo.mjs";
const SCRIPT_PATH = `/challenge/labs/attack/${SCRIPT_NAME}`;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function ensureScript() {
  try {
    const src = join(__dirname, "sdk-scripts", SCRIPT_NAME);
    execSync(`docker cp "${src}" ${CONTAINER}:${SCRIPT_PATH}`);
    console.log(`[startup] Copied ${SCRIPT_NAME} into ${CONTAINER}`);
  } catch (e) {
    console.error("[startup] Could not copy script:", e.message);
  }
}

function runDemo() {
  return new Promise((resolve, reject) => {
    exec(
      `docker exec ${CONTAINER} node ${SCRIPT_PATH}`,
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(stdout);
      }
    );
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/run-demo") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const output = await runDemo();
      res.end(JSON.stringify({ ok: true, output }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = join(__dirname, filePath);

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

ensureScript();
server.listen(PORT, () => {
  console.log(`Cy4Secure demo server running at http://localhost:${PORT}`);
});
