# Category System Design: Business Spending Categorization

## 1. Business need

- **Spending categorization**: Business account transactions must be assignable to categories so users and accountants can understand needs, patterns, and reporting.
- **Accountant-added categories**: Accountants need to create custom categories that persist across sessions and are available for future use alongside built-in categories.
- **Consistency**: Every category label must be stored and displayed in a single, professional format (e.g. Title Case) so that "office supplies", "Office Supplies", and "OFFICE SUPPLIES" are treated as one category, not three.
- **Scalability**: The system must avoid category sprawl by encouraging reuse (choose existing first, add new only when necessary) and by deduplicating on a canonical key.

## 2. Risks, edge cases, design decisions

| Risk / edge case | Mitigation |
|------------------|------------|
| Duplicates from casing | Store and compare by a **canonical key** (normalized: trim, lowercase, collapse spaces). Display and persist a **display label** in Title Case. |
| Near-duplicates ("Office Supplies" vs "Office Supply") | Canonical key reduces some; UX shows "matching categories" so user can pick existing before adding. Optional: suggest "Did you mean Office Supplies?" when adding. |
| Category deletion | Prefer **archival** (hide from new assignments, keep on existing transactions) to avoid orphaning data. For MVP, deletion can be "soft": mark archived, exclude from picker. |
| Scope (global vs per-business) | **Per-tenant/business** is best long-term. For this app (single-user/local), categories are **global to the app**; persistence is localStorage. A future backend would scope by business or accountant. |
| Role-based behavior | **Regular user**: can assign only existing categories. **Accountant**: can assign and **add** new categories. **Admin** (optional): can archive/merge. For MVP we implement "can add category" as a single permission (everyone or a flag); roles can be wired later. |
| Sprawl | UI: show **matching existing** first; "Add new" only when no match. Optional: cap custom categories or require confirmation when count is high. |

## 3. Data model

- **Default categories**: Read-only list (e.g. Rent, Utilities, Payroll, …). Never persisted as "custom".
- **Custom categories**: Stored in a **persistent list** (e.g. localStorage key `budget-categorizer-custom-categories`).
  - Each entry: `{ key: string, label: string }`.
  - **key**: canonical form (trim, lowercase, collapse spaces). Used for dedupe and lookup.
  - **label**: display form (Title Case). Used in UI and exports.
- **Effective category list** = default + custom (custom appended, no duplicates by key).
- **Transactions** and **merchant mappings** store the **label** (so exports and UI are human-readable). Lookup and validation use the same normalization so any casing input resolves to the stored label.

## 4. UX flow

- **Choosing a category (e.g. in table)**  
  - **Combobox**: user can type to filter.  
  - Show **matching existing categories** first (by label or key).  
  - If user’s input (after normalization) matches an existing category → select it and show it in Title Case.  
  - If no match and user confirms (e.g. "Add ‘X’") → **add category** (normalize, dedupe by key), then select it. Optionally restrict "Add" to accountant (or allow for everyone in MVP).  
  - On save/selection: always persist and display the **normalized label** (Title Case).

- **Adding a new category (standalone)**  
  - Input → normalize to Title Case for preview.  
  - Check canonical key: if key already exists, do not create duplicate; use existing label and show message "Category already exists."  
  - On success: persist custom list, show confirmation, and make the category available in the picker.

- **Editing / archival**  
  - **Edit**: change label only; key can stay (update label in list and in any merchant mappings / transactions that reference it) or be treated as rename (old key archived, new key added). MVP: edit label, same key.  
  - **Archive**: mark category as archived; hide from picker; keep on existing transactions. Optional for later.

## 5. Validation and capitalization logic

- **Normalize for display/storage (Title Case)**  
  - Trim, collapse internal spaces.  
  - First letter of each word uppercase, rest lowercase.  
  - Handle special cases: "&" and similar can be left as-is (e.g. "Meals & Entertainment").  
  - Examples: `"office supplies"` → `"Office Supplies"`, `"software subscriptions"` → `"Software Subscriptions"`.

- **Canonical key**  
  - Same as above, then lowercase: e.g. `"Office Supplies"` → key `"office supplies"`.  
  - Used for: dedupe, checking "category already exists", and matching user input to an existing category.

- **When to apply**  
  - **On add**: normalize input to label; compute key; if key exists, do not add duplicate.  
  - **On select/save**: ensure stored value is the normalized label.  
  - **On load**: custom categories are stored with label (and key); display label everywhere.

## 6. Persistence (current app)

- **Where**: `localStorage` key `budget-categorizer-custom-categories`.  
- **Format**: JSON array of `{ key: string, label: string }`.  
- **When**: Read on app load; write whenever a new custom category is added (and optionally on edit/archive).  
- **Reuse**: Effective category list (default + custom) is used by the category picker, transaction table, merchant mappings, and export. All new assignments and mappings use the normalized label so added categories are reused consistently.
