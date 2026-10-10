import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createInterface } from "node:readline";

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

const LINE_DELAY_MS = 90;

function ensureScript() {
  try {
    const src = join(__dirname, "sdk-scripts", SCRIPT_NAME);
    execSync(`docker cp "${src}" ${CONTAINER}:${SCRIPT_PATH}`);
    console.log(`[startup] Copied ${SCRIPT_NAME} into ${CONTAINER}`);
  } catch (e) {
    console.error("[startup] Could not copy script:", e.message);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const proc = spawn("docker", ["exec", CONTAINER, "node", SCRIPT_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rl = createInterface({ input: proc.stdout });
  const lines = [];

  rl.on("line", (line) => {
    lines.push(line);
  });

  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await new Promise((resolve) => {
    proc.on("close", resolve);
  });

  if (lines.length === 0 && stderr) {
    send("error", { message: stderr.trim() });
    res.end();
    return;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let phase = null;
    if (line.includes("[PHASE 1]")) phase = 1;
    else if (line.includes("[PHASE 2]")) phase = 2;
    else if (line.includes("[PHASE 3]")) phase = 3;
    else if (line.includes("[PHASE 4]")) phase = 4;
    else if (line.includes("SUMMARY")) phase = "summary";

    send("line", { text: line, phase });

    const isBlank = line.trim() === "";
    const isSep = /^[= ]+$/.test(line.trim());
    const delay = isBlank || isSep ? 40 : LINE_DELAY_MS;
    await sleep(delay);
  }

  send("done", { totalLines: lines.length });
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/run-demo-stream") {
    return handleStream(req, res);
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
