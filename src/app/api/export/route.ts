import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { Transaction } from "@/types";
import { decryptServer } from "@/lib/serverEncryption";

export async function POST(request: NextRequest) {
  try {
    const encryptionKey = request.headers.get("X-Encryption-Key");
    let transactions: Transaction[];
    let summary: Record<string, number>;

    if (encryptionKey) {
      const { encrypted } = await request.json();
      const decrypted = decryptServer(encrypted, encryptionKey);
      const body = JSON.parse(decrypted);
      transactions = body.transactions;
      summary = body.summary;
    } else {
      const body = await request.json();
      transactions = body.transactions;
      summary = body.summary;
    }

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: "Invalid data" },
        { status: 400 }
      );
    }

    const workbook = new ExcelJS.Workbook();

    // Sheet 1: Transactions
    const txSheet = workbook.addWorksheet("Transactions");
    txSheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Description", key: "description", width: 40 },
      { header: "Amount", key: "amount", width: 15 },
      { header: "Category", key: "category", width: 22 },
      { header: "Source File", key: "source", width: 25 },
    ];

    txSheet.getRow(1).font = { bold: true, size: 11 };
    txSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A1A2E" },
    };
    txSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

    for (const tx of transactions) {
      const row = txSheet.addRow({
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        category: tx.category,
        source: tx.source,
      });
      row.getCell("amount").numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    }

    // Sheet 2: Summary
    const summarySheet = workbook.addWorksheet("Summary");
    summarySheet.columns = [
      { header: "Category", key: "category", width: 25 },
      { header: "Total", key: "total", width: 18 },
      { header: "Count", key: "count", width: 10 },
    ];

    summarySheet.getRow(1).font = { bold: true, size: 11 };
    summarySheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A1A2E" },
    };
    summarySheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

    let grandTotal = 0;
    const categoryCounts: Record<string, number> = {};

    for (const tx of transactions) {
      categoryCounts[tx.category] = (categoryCounts[tx.category] ?? 0) + 1;
    }

    for (const [category, total] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
      const row = summarySheet.addRow({
        category,
        total,
        count: categoryCounts[category] ?? 0,
      });
      row.getCell("total").numFmt = '"$"#,##0.00';
      grandTotal += total;
    }

    const totalRow = summarySheet.addRow({
      category: "TOTAL",
      total: grandTotal,
      count: transactions.length,
    });
    totalRow.font = { bold: true };
    totalRow.getCell("total").numFmt = '"$"#,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="categorized-transactions.xlsx"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate Excel file" },
      { status: 500 }
    );
  }
}
