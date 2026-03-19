#!/usr/bin/env node
/**
 * Test PDF upload API. Run with dev server: npm run dev
 * Then: node scripts/test-upload.mjs [path/to/file.pdf]
 * Default PDF path: user's Downloads BMO sample if present.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(
  process.env.HOME || process.env.USERPROFILE || "",
  "Downloads",
  "ilovepdf_split",
  "January 31, 2025 (1)-5.pdf"
);

const pdfPath = process.argv[2] || defaultPath;
const baseUrl = process.env.API_BASE || "http://localhost:3000";

async function main() {
  if (!existsSync(pdfPath)) {
    console.error("PDF not found:", pdfPath);
    console.error("Usage: node scripts/test-upload.mjs [path/to/file.pdf]");
    process.exit(1);
  }

  const form = new FormData();
  form.append("file", new Blob([readFileSync(pdfPath)]), "statement.pdf");

  console.log("POST", baseUrl + "/api/upload", "with", pdfPath);
  const res = await fetch(baseUrl + "/api/upload", { method: "POST", body: form });
  const data = await res.json();

  if (!res.ok) {
    console.error("Error", res.status, data);
    process.exit(1);
  }

  if (data.error) {
    console.error("Error:", data.error);
    process.exit(1);
  }

  if (data.needsManualSelection) {
    console.log("Bank detected:", data.bankDetected);
    console.log("Transactions: 0 (needs manual selection)");
    console.log("Raw lines:", data.rawLines?.length ?? 0);
    return;
  }

  console.log("Bank detected:", data.bankDetected);
  console.log("Transactions:", data.transactions?.length ?? 0);
  if (data.transactions?.length > 0) {
    const first = data.transactions[0];
    console.log("Sample:", first?.date, first?.description?.slice(0, 40), first?.amount);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
