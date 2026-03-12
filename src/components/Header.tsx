"use client";

interface HeaderProps {
  onSettingsClick: () => void;
  mappingsCount: number;
}

export default function Header({ onSettingsClick, mappingsCount }: HeaderProps) {
  return (
    <header className="bg-[#1a1a2e] text-white px-6 py-4 shadow-lg">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#e94560] rounded-lg flex items-center justify-center font-bold text-lg">
            BC
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Budget Categorizer
            </h1>
            <p className="text-sm text-gray-400">
              Smart transaction categorization for accountants
            </p>
          </div>
        </div>

        <button
          onClick={onSettingsClick}
          className="flex items-center gap-2 px-4 py-2 bg-[#16213e] hover:bg-[#0f3460] rounded-lg transition-colors text-sm"
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
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Learned Merchants
          {mappingsCount > 0 && (
            <span className="bg-[#e94560] text-white text-xs px-2 py-0.5 rounded-full">
              {mappingsCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
