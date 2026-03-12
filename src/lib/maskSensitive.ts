/**
 * Masks account numbers, card numbers, and other sensitive identifiers
 * in transaction descriptions. Applied during parsing so sensitive data
 * is never stored or sent to external APIs.
 */

// Patterns that indicate the following digits are an account/reference number
const SENSITIVE_PREFIXES = [
  /(?:acct?|account)\s*#?\s*/i,
  /(?:ref|reference)\s*#?\s*/i,
  /(?:card|visa|mastercard|mc|amex)\s*#?\s*/i,
  /(?:chq|cheque|check)\s*#?\s*/i,
  /(?:transit)\s*#?\s*/i,
  /(?:inst|institution)\s*#?\s*/i,
];

/**
 * Mask long digit sequences that look like account numbers.
 * Preserves amounts (patterns like $123.45 or 1,234.56).
 * Preserves dates.
 * Masks sequences of 4+ consecutive digits that aren't amounts.
 */
export function maskAccountNumbers(description: string): string {
  if (!description) return description;

  let result = description;

  // Step 1: Mask digits after known sensitive prefixes
  for (const prefix of SENSITIVE_PREFIXES) {
    result = result.replace(
      new RegExp(`(${prefix.source})(\\d[\\d\\s\\-*]{3,})`, prefix.flags),
      (match, p1: string, digits: string) => {
        const cleaned = digits.replace(/[\s\-*]/g, "");
        if (cleaned.length < 4) return match;
        const lastFour = cleaned.slice(-4);
        return `${p1}****${lastFour}`;
      }
    );
  }

  // Step 2: Mask standalone long digit sequences (5+ digits) that aren't amounts
  // Preserve: dollar amounts ($123.45), comma amounts (1,234.56), dates (01/15, 2024-01-15)
  result = result.replace(
    /(?<!\$)(?<!\d[,.])\b(\d{5,}(?:[\s\-]\d+)*)\b(?!\.\d{2}\b)(?!\/\d)/g,
    (match) => {
      const cleaned = match.replace(/[\s\-]/g, "");
      // Don't mask if it looks like a date component
      if (/^\d{4}$/.test(cleaned) && parseInt(cleaned) >= 1900 && parseInt(cleaned) <= 2100) {
        return match;
      }
      if (cleaned.length < 5) return match;
      const lastFour = cleaned.slice(-4);
      return `****${lastFour}`;
    }
  );

  // Step 3: Mask e-Transfer recipients/senders that contain email-like patterns
  // Don't mask emails themselves (those are handled separately), but mask
  // any recipient reference numbers
  result = result.replace(
    /(?:e-?transfer|interac)\s*(?:to|from|sent|received)\s*[^,]*?(\d{6,})/gi,
    (match, digits: string) => {
      const lastFour = digits.slice(-4);
      return match.replace(digits, `****${lastFour}`);
    }
  );

  return result;
}

/**
 * Mask email addresses in descriptions (replace with first char + ***@domain)
 */
export function maskEmails(description: string): string {
  return description.replace(
    /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (_, local: string, domain: string) => {
      return `${local[0]}***@${domain}`;
    }
  );
}

/**
 * Apply all sensitive data masking to a description
 */
export function maskSensitiveData(description: string): string {
  let masked = maskAccountNumbers(description);
  masked = maskEmails(masked);
  return masked;
}
