"use client";

import { useState, useRef, useEffect } from "react";
import type { Category } from "@/types";
import { normalizeCategoryLabel } from "@/lib/categoryUtils";

const ADD_NEW_VALUE = "__add_new_category__";

interface CategorySelectProps {
  value: Category;
  allCategories: string[];
  onChange: (category: Category) => void;
  onAddCategory: (rawInput: string) => { success: true; label: string } | { success: false; reason: string };
  canAddCategory: boolean;
  /** Optional: id for the row (e.g. transaction id) for focus management */
  id?: string;
  className?: string;
}

export default function CategorySelect({
  value,
  allCategories,
  onChange,
  onAddCategory,
  canAddCategory,
  id,
  className = "",
}: CategorySelectProps) {
  const [showAddInput, setShowAddInput] = useState(false);
  const [addInputValue, setAddInputValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showAddInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAddInput]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === ADD_NEW_VALUE) {
      setShowAddInput(true);
      setAddInputValue("");
      setAddError(null);
      setAddSuccess(false);
      e.target.value = value; // reset select to current value
      return;
    }
    onChange(v);
  };

  const handleAddSubmit = () => {
    const trimmed = addInputValue.trim();
    if (!trimmed) {
      setAddError("Enter a category name.");
      return;
    }
    const result = onAddCategory(trimmed);
    if (result.success) {
      onChange(result.label);
      setAddSuccess(true);
      setAddError(null);
      setShowAddInput(false);
      setAddInputValue("");
      setTimeout(() => setAddSuccess(false), 2000);
    } else {
      setAddError(result.reason);
    }
  };

  const handleAddCancel = () => {
    setShowAddInput(false);
    setAddInputValue("");
    setAddError(null);
  };

  const effectiveOptions =
    value && !allCategories.includes(value)
      ? [value, ...allCategories]
      : allCategories;

  if (showAddInput) {
    const preview = addInputValue.trim() ? normalizeCategoryLabel(addInputValue) : "";
    return (
      <div className="flex flex-col gap-1 min-w-[180px]">
        <div className="flex items-center gap-1 flex-wrap">
          <input
            ref={inputRef}
            type="text"
            value={addInputValue}
            onChange={(e) => {
              setAddInputValue(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddSubmit();
              if (e.key === "Escape") handleAddCancel();
            }}
            placeholder="e.g. office supplies"
            className="flex-1 min-w-[120px] px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#0f3460] focus:border-transparent"
            aria-label="New category name"
          />
          <button
            type="button"
            onClick={handleAddSubmit}
            className="px-2 py-1 bg-[#0f3460] text-white rounded text-xs font-medium hover:bg-[#16213e]"
          >
            Add
          </button>
          <button
            type="button"
            onClick={handleAddCancel}
            className="px-2 py-1 text-gray-600 hover:text-gray-800 text-xs"
          >
            Cancel
          </button>
        </div>
        {preview && (
          <span className="text-xs text-gray-500">Preview: {preview}</span>
        )}
        {addError && (
          <span className="text-xs text-red-600" role="alert">
            {addError}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={handleSelectChange}
        className={`w-full min-w-[140px] px-2 py-1 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0f3460] focus:border-transparent ${className}`}
        aria-label="Category"
      >
        {effectiveOptions.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
        {canAddCategory && (
          <option value={ADD_NEW_VALUE}>— Add new category —</option>
        )}
      </select>
      {addSuccess && (
        <span className="absolute left-0 top-full mt-0.5 text-xs text-green-600 whitespace-nowrap">
          Saved
        </span>
      )}
    </div>
  );
}
