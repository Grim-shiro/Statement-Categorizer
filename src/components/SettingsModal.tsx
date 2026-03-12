"use client";

import { MerchantMappings, Category } from "@/types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mappings: MerchantMappings;
  onRemoveMapping: (merchant: string) => void;
  onClearMappings: () => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  mappings,
  onRemoveMapping,
  onClearMappings,
}: SettingsModalProps) {
  if (!isOpen) return null;

  const entries = Object.entries(mappings).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              Learned Merchant Mappings
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              When you change a transaction&apos;s category, the merchant is
              remembered for future uploads.
            </p>
          </div>
          <button
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
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {entries.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <p className="text-lg font-medium">No learned mappings yet</p>
              <p className="text-sm mt-2">
                Change a transaction&apos;s category to start teaching the
                system.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map(([merchant, category]) => (
                <div
                  key={merchant}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {merchant}
                    </p>
                    <p className="text-xs text-gray-500">{category as Category}</p>
                  </div>
                  <button
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
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {entries.length > 0 && (
          <div className="p-6 border-t border-gray-200 flex justify-between items-center">
            <span className="text-sm text-gray-500">
              {entries.length} mapping{entries.length !== 1 ? "s" : ""}
            </span>
            <button
              onClick={onClearMappings}
              className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Clear All Mappings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
