import { NextRequest, NextResponse } from "next/server";
import { parseCSV } from "@/lib/csvParser";
import { parsePDFWithDetails } from "@/lib/pdfParser";
import { encryptServer, decryptServer } from "@/lib/serverEncryption";

/** Convert bankDetected id to a human-readable "BANK TYPE Statement" label */
function bankLabel(bankDetected: string, txCount: number): string {
  const BANK_LABELS: Record<string, string> = {
    "bmo": "BMO Credit",
    "cibc-credit": "CIBC Credit Card",
    "cibc-bank": "CIBC Chequing",
    "eq": "EQ Bank",
    "rbc-credit": "RBC Credit Card",
    "rbc-chequing": "RBC Chequing",
    "chase": "Chase",
    "scotiabank": "Scotiabank Credit Card",
    "scotiabank-bank": "Scotiabank Chequing",
    "td-credit": "TD Credit Card",
    "td-bank": "TD Chequing/Savings",
    "unknown": "PDF",
  };
  const label = BANK_LABELS[bankDetected] || bankDetected.toUpperCase();
  return `${label} Statement (${txCount} transactions)`;
}

export async function POST(request: NextRequest) {
  try {
    const encryptionKey = request.headers.get("X-Encryption-Key");
    let filename: string;
    let fileBuffer: Buffer | null = null;
    let fileText: string | null = null;

    if (encryptionKey && request.headers.get("Content-Type")?.includes("application/json")) {
      // E2E encrypted upload: JSON body with encrypted file data
      const { encrypted } = await request.json();
      const decrypted = decryptServer(encrypted, encryptionKey);
      const { filename: fname, fileBase64 } = JSON.parse(decrypted);
      filename = (fname || "").toLowerCase();
      const rawBuffer = Buffer.from(fileBase64, "base64");

      if (rawBuffer.length > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: "File size must be under 10MB" },
          { status: 400 }
        );
      }

      if (filename.endsWith(".csv")) {
        fileText = rawBuffer.toString("utf-8");
      } else if (filename.endsWith(".pdf")) {
        fileBuffer = rawBuffer;
      }
    } else {
      // Plain FormData upload (fallback)
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      filename = file.name.toLowerCase();

      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: "File size must be under 10MB" },
          { status: 400 }
        );
      }

      if (filename.endsWith(".csv")) {
        fileText = await file.text();
      } else if (filename.endsWith(".pdf")) {
        const arrayBuffer = await file.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
      }
    }

    if (!filename.endsWith(".csv") && !filename.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only CSV and PDF files are supported" },
        { status: 400 }
      );
    }

    if (filename.endsWith(".csv") && fileText !== null) {
      const transactions = parseCSV(fileText);

      if (transactions.length === 0) {
        return NextResponse.json(
          { error: "No transactions could be parsed from this CSV file." },
          { status: 422 }
        );
      }

      const safeLabel = `CSV Statement (${transactions.length} transactions)`;
      const responseData = { transactions, filename: safeLabel };

      if (encryptionKey) {
        const encrypted = encryptServer(JSON.stringify(responseData), encryptionKey);
        return NextResponse.json({ encrypted, e2e: true });
      }
      return NextResponse.json(responseData);
    }

    // PDF parsing with details
    if (!fileBuffer) {
      return NextResponse.json({ error: "Failed to read PDF file" }, { status: 400 });
    }
    const buffer = fileBuffer;
    const result = await parsePDFWithDetails(buffer);

    if (result.transactions.length === 0) {
      // Return raw lines + PDF base64 so client can render pages for manual selection
      const pdfBase64 = buffer.toString("base64");
      const responseData = {
        transactions: [],
        filename: "PDF Statement (0 transactions)",
        bankDetected: result.bankDetected,
        rawLines: result.rawLines,
        pdfBase64,
        needsManualSelection: true,
      };

      if (encryptionKey) {
        const encrypted = encryptServer(JSON.stringify(responseData), encryptionKey);
        return NextResponse.json({ encrypted, e2e: true });
      }
      return NextResponse.json(responseData);
    }

    const safeLabel = bankLabel(result.bankDetected, result.transactions.length);
    const responseData = {
      transactions: result.transactions,
      filename: safeLabel,
      bankDetected: result.bankDetected,
    };

    if (encryptionKey) {
      const encrypted = encryptServer(JSON.stringify(responseData), encryptionKey);
      return NextResponse.json({ encrypted, e2e: true });
    }
    return NextResponse.json(responseData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to process file";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
