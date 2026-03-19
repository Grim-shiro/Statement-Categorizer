"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Header from "@/components/Header";
import UploadZone from "@/components/UploadZone";
import TransactionsTable from "@/components/TransactionsTable";
import CategorySummary from "@/components/CategorySummary";
import SettingsModal from "@/components/SettingsModal";
import PDFVisualizer from "@/components/PDFVisualizer";
import { useTransactions } from "@/hooks/useTransactions";
import { useMerchantMappings } from "@/hooks/useMerchantMappings";
import { useCategories } from "@/hooks/useCategories";
import { Category } from "@/types";
import { normalizeCategoryForStorage } from "@/lib/categoryUtils";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    transactions,
    summary,
    appState,
    error,
    uploadFile,
    categorize,
    updateCategory,
    exportToExcel,
    clearAll,
    dismissVisualizer,
    addManualTransactions,
    pdfVisualizerData,
    hasRawData,
    rawTransactions,
  } = useTransactions();
  const { mappings, saveMapping, removeMapping, clearMappings } =
    useMerchantMappings();
  const { allCategories, addCategory, canAddCategory, customCategories } = useCategories();

  const handleCategoryChange = (
    id: string,
    category: Category,
    merchant: string
  ) => {
    const normalized = normalizeCategoryForStorage(category);
    updateCategory(id, normalized);
    if (merchant) {
      saveMapping(merchant, normalized);
    }
  };

  const rawTxCount = rawTransactions.reduce(
    (sum, batch) => sum + batch.transactions.length,
    0
  );

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        onSettingsClick={() => setSettingsOpen(true)}
        mappingsCount={Object.keys(mappings).length}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mappings={mappings}
        onRemoveMapping={removeMapping}
        onClearMappings={clearMappings}
        customCategories={customCategories}
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 space-y-6">
        {/* Upload Zone */}
        <UploadZone
          onFileAccepted={uploadFile}
          appState={appState}
          fileCount={rawTransactions.length}
        />

        {/* Error Banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm">{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PDF Visualizer - shown when no transactions auto-detected */}
        <AnimatePresence>
          {pdfVisualizerData && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <PDFVisualizer
                data={pdfVisualizerData}
                onDismiss={dismissVisualizer}
                onTransactionsExtracted={addManualTransactions}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Bar */}
        <AnimatePresence>
          {(hasRawData || transactions.length > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 flex-wrap"
            >
              {hasRawData && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => categorize(mappings)}
                  disabled={appState === "categorizing"}
                  className="px-6 py-2.5 bg-gradient-to-r from-[#0f3460] to-[#16213e] text-white rounded-xl hover:shadow-lg hover:shadow-[#0f3460]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium text-sm flex items-center gap-2"
                >
                  {appState === "categorizing" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Categorizing...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                        />
                      </svg>
                      Categorize {rawTxCount} Transaction
                      {rawTxCount !== 1 ? "s" : ""}
                    </>
                  )}
                </motion.button>
              )}

              {transactions.length > 0 && summary && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={exportToExcel}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:shadow-lg hover:shadow-emerald-500/20 transition-all font-medium text-sm flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Export to Excel
                </motion.button>
              )}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={clearAll}
                className="px-4 py-2.5 text-gray-500 hover:text-gray-700 hover:bg-white/60 rounded-xl transition-all text-sm backdrop-blur-sm"
              >
                Clear All
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary */}
        <AnimatePresence>
          {summary && <CategorySummary summary={summary} transactions={transactions} />}
        </AnimatePresence>

        {/* Transactions Table */}
        <AnimatePresence>
          {transactions.length > 0 && (
            <TransactionsTable
              transactions={transactions}
              onCategoryChange={handleCategoryChange}
              allCategories={allCategories}
              onAddCategory={addCategory}
              canAddCategory={canAddCategory}
            />
          )}
        </AnimatePresence>
      </main>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="border-t border-gray-200/60 py-4 px-3 sm:px-6 bg-white/40 backdrop-blur-sm mt-auto"
      >
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-2">
          <div className="flex items-start sm:items-center gap-2 text-emerald-700 bg-emerald-50/80 px-3 sm:px-4 py-2 rounded-xl border border-emerald-100/60">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-xs font-medium">
              Your data is secure. Files are processed in memory only &mdash; nothing is stored, cached, or logged on our servers. All data is discarded after processing.
            </span>
          </div>
          <p className="text-gray-400 text-xs">
            Budget Categorizer &mdash; AI-powered transaction categorization
          </p>
        </div>
      </motion.footer>
    </div>
  );
}
