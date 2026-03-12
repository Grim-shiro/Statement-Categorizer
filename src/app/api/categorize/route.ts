import { NextRequest, NextResponse } from "next/server";
import { categorizeTransactions, computeSummary } from "@/lib/categorizer";
import { MerchantMappings, RawTransaction } from "@/types";
import { decryptServer, encryptServer } from "@/lib/serverEncryption";

export async function POST(request: NextRequest) {
  try {
    const encryptionKey = request.headers.get("X-Encryption-Key");
    let transactions: RawTransaction[];
    let source: string;
    let merchantMappings: MerchantMappings;

    if (encryptionKey) {
      // Decrypt the encrypted request body
      const { encrypted } = await request.json();
      const decrypted = decryptServer(encrypted, encryptionKey);
      const body = JSON.parse(decrypted);
      transactions = body.transactions;
      source = body.source;
      merchantMappings = body.merchantMappings;
    } else {
      const body = await request.json();
      transactions = body.transactions;
      source = body.source;
      merchantMappings = body.merchantMappings;
    }

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: "Invalid transactions data" },
        { status: 400 }
      );
    }

    const categorized = await categorizeTransactions(
      transactions,
      source || "Unknown",
      merchantMappings || {}
    );

    const summary = computeSummary(categorized);
    const responseData = { transactions: categorized, summary };

    // Encrypt response if client sent a key
    if (encryptionKey) {
      const encryptedResponse = encryptServer(
        JSON.stringify(responseData),
        encryptionKey
      );
      return NextResponse.json({ encrypted: encryptedResponse, e2e: true });
    }

    return NextResponse.json(responseData);
  } catch {
    return NextResponse.json(
      { error: "Failed to categorize transactions" },
      { status: 500 }
    );
  }
}
