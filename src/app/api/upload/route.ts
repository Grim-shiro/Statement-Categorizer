import { NextRequest, NextResponse } from "next/server";
import { parseCSV } from "@/lib/csvParser";
import { parsePDFWithDetails } from "@/lib/pdfParser";
import { encryptServer } from "@/lib/serverEncryption";

export async function POST(request: NextRequest) {
  try {
    const encryptionKey = request.headers.get("X-Encryption-Key");
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const filename = file.name.toLowerCase();

    if (!filename.endsWith(".csv") && !filename.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only CSV and PDF files are supported" },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size must be under 10MB" },
        { status: 400 }
      );
    }

    if (filename.endsWith(".csv")) {
      const text = await file.text();
      const transactions = parseCSV(text);

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
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await parsePDFWithDetails(buffer);

    if (result.transactions.length === 0) {
      // Return raw lines so the client can show them for manual selection
      const responseData = {
        transactions: [],
        filename: "PDF Statement (0 transactions)",
        bankDetected: result.bankDetected,
        rawLines: result.rawLines,
        needsManualSelection: true,
      };

      if (encryptionKey) {
        const encrypted = encryptServer(JSON.stringify(responseData), encryptionKey);
        return NextResponse.json({ encrypted, e2e: true });
      }
      return NextResponse.json(responseData);
    }

    const safeLabel = `PDF Statement (${result.transactions.length} transactions)`;
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
