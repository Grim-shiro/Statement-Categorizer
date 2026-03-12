import { Category } from "@/types";

export const KEYWORD_RULES: Record<string, Category> = {
  // Rent
  rent: "Rent",
  lease: "Rent",
  "property management": "Rent",
  mortgage: "Rent",

  // Utilities
  electric: "Utilities",
  "power company": "Utilities",
  "water bill": "Utilities",
  "water department": "Utilities",
  "water utility": "Utilities",
  "gas company": "Utilities",
  "pacific gas": "Utilities",
  "pg&e": "Utilities",
  "con edison": "Utilities",
  "duke energy": "Utilities",
  sewer: "Utilities",
  garbage: "Utilities",
  waste: "Utilities",

  // Payroll
  payroll: "Payroll",
  salary: "Payroll",
  wages: "Payroll",
  adp: "Payroll",
  gusto: "Payroll",
  paychex: "Payroll",

  // Supplies
  "office depot": "Supplies",
  staples: "Supplies",
  amazon: "Supplies",
  walmart: "Supplies",
  target: "Supplies",
  "home depot": "Supplies",
  lowes: "Supplies",
  costco: "Supplies",

  // Travel
  airline: "Travel",
  delta: "Travel",
  united: "Travel",
  american: "Travel",
  southwest: "Travel",
  jetblue: "Travel",
  frontier: "Travel",
  spirit: "Travel",
  hilton: "Travel",
  marriott: "Travel",
  hyatt: "Travel",
  airbnb: "Travel",
  hotel: "Travel",
  expedia: "Travel",
  booking: "Travel",
  kayak: "Travel",

  // Meals & Entertainment
  restaurant: "Meals & Entertainment",
  "uber eats": "Meals & Entertainment",
  doordash: "Meals & Entertainment",
  grubhub: "Meals & Entertainment",
  postmates: "Meals & Entertainment",
  starbucks: "Meals & Entertainment",
  mcdonald: "Meals & Entertainment",
  chipotle: "Meals & Entertainment",
  "panera": "Meals & Entertainment",
  "chick-fil-a": "Meals & Entertainment",
  subway: "Meals & Entertainment",
  "pizza": "Meals & Entertainment",
  "taco bell": "Meals & Entertainment",
  cafe: "Meals & Entertainment",
  diner: "Meals & Entertainment",
  "dunkin": "Meals & Entertainment",

  // Insurance
  insurance: "Insurance",
  "state farm": "Insurance",
  geico: "Insurance",
  allstate: "Insurance",
  progressive: "Insurance",
  "liberty mutual": "Insurance",
  "blue cross": "Insurance",
  aetna: "Insurance",
  cigna: "Insurance",
  anthem: "Insurance",

  // Professional Services
  attorney: "Professional Services",
  lawyer: "Professional Services",
  legal: "Professional Services",
  "law firm": "Professional Services",
  accountant: "Professional Services",
  cpa: "Professional Services",
  consulting: "Professional Services",
  consultant: "Professional Services",
  audit: "Professional Services",

  // Advertising
  "google ads": "Advertising",
  "facebook ads": "Advertising",
  "meta ads": "Advertising",
  "linkedin ads": "Advertising",
  "yelp ads": "Advertising",
  marketing: "Advertising",
  advertising: "Advertising",
  promotion: "Advertising",

  // Office Expenses
  "microsoft": "Office Expenses",
  "google workspace": "Office Expenses",
  "adobe": "Office Expenses",
  zoom: "Office Expenses",
  slack: "Office Expenses",
  dropbox: "Office Expenses",
  "notion": "Office Expenses",
  quickbooks: "Office Expenses",
  "intuit": "Office Expenses",

  // Telecommunications
  "at&t": "Telecommunications",
  verizon: "Telecommunications",
  "t-mobile": "Telecommunications",
  sprint: "Telecommunications",
  comcast: "Telecommunications",
  xfinity: "Telecommunications",
  spectrum: "Telecommunications",
  internet: "Telecommunications",
  phone: "Telecommunications",

  // Vehicle & Fuel
  shell: "Vehicle & Fuel",
  chevron: "Vehicle & Fuel",
  exxon: "Vehicle & Fuel",
  mobil: "Vehicle & Fuel",
  bp: "Vehicle & Fuel",
  gasoline: "Vehicle & Fuel",
  fuel: "Vehicle & Fuel",
  uber: "Vehicle & Fuel",
  lyft: "Vehicle & Fuel",
  parking: "Vehicle & Fuel",
  "auto repair": "Vehicle & Fuel",
  "car wash": "Vehicle & Fuel",

  // Bank Fees
  "service charge": "Bank Fees",
  "monthly fee": "Bank Fees",
  "overdraft": "Bank Fees",
  "wire transfer fee": "Bank Fees",
  "atm fee": "Bank Fees",
  "late fee": "Bank Fees",
  "interest charge": "Bank Fees",

  // Taxes
  irs: "Taxes",
  "tax payment": "Taxes",
  "state tax": "Taxes",
  "property tax": "Taxes",
  "sales tax": "Taxes",
};

export function normalizeMerchant(description: string): string {
  return description
    .toUpperCase()
    .replace(/[0-9#*]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchKeywordRule(description: string): Category | null {
  const lower = description.toLowerCase();
  for (const [keyword, category] of Object.entries(KEYWORD_RULES)) {
    if (lower.includes(keyword)) {
      return category;
    }
  }
  return null;
}
