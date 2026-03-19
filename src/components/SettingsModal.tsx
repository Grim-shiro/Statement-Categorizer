"use client";

import { motion, AnimatePresence } from "framer-motion";
import { MerchantMappings } from "@/types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mappings: MerchantMappings;
  onRemoveMapping: (merchant: string) => void;
  onClearMappings: () => void;
  customCategories?: string[];
}

export default function SettingsModal({
  isOpen,
  onClose,
  mappings,
  onRemoveMapping,
  onClearMappings,
  customCategories = [],
}: SettingsModalProps) {
  const entries = Object.entries(mappings).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col border border-white/60"
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200/60">
              <div>
                <h2 className="text-xl font-bold text-gray-800">
                  Learned Merchant Mappings
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  When you change a transaction&apos;s category, the merchant is
                  remembered for future uploads.
                </p>
              </div>
              <motion.button
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </motion.button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {customCategories.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Custom categories (saved for future use)
                  </h3>
                  <p className="text-xs text-gray-500 mb-2">
                    These persist after refresh and can be used when categorizing transactions.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {customCategories.map((label) => (
                      <motion.span
                        key={label}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gradient-to-r from-[#0f3460]/10 to-[#0f3460]/5 text-[#0f3460] text-xs font-medium border border-[#0f3460]/10"
                      >
                        {label}
                      </motion.span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  Learned merchant mappings
                </h3>
                {entries.length === 0 ? (
                  <div className="text-center text-gray-400 py-6 rounded-xl bg-gray-50/60">
                    <p className="font-medium">No learned mappings yet</p>
                    <p className="text-sm mt-1">
                      Change a transaction&apos;s category to start teaching the
                      system.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {entries.map(([merchant, category], i) => (
                      <motion.div
                        key={merchant}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50/60 hover:bg-gray-100/80 group transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {merchant}
                          </p>
                          <p className="text-xs text-gray-500">{category}</p>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.15 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => onRemoveMapping(merchant)}
                          className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 ml-2"
                          title="Remove mapping"
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
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </motion.button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {entries.length > 0 && (
              <div className="p-6 border-t border-gray-200/60 flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  {entries.length} mapping{entries.length !== 1 ? "s" : ""}
                </span>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onClearMappings}
                  className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Clear All Mappings
                </motion.button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
