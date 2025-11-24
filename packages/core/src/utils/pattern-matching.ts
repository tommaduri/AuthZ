/**
 * Pattern Matching Utilities
 *
 * Shared utilities for pattern matching in authorization rules.
 */

/**
 * Matches an action against a pattern with wildcard support.
 *
 * Wildcard Specification:
 * - Action patterns use `:` as delimiter
 * - `prefix:*` matches any action starting with `prefix:` (greedy - matches all remaining segments)
 * - `*:suffix` matches any action ending with `:suffix`
 * - `prefix:*:suffix` matches actions with prefix and suffix (middle * matches single segment)
 * - `*` alone matches any single action
 * - `*:*` matches any action with exactly two segments
 *
 * @param pattern - The pattern to match against (may contain wildcards)
 * @param action - The action to check
 * @returns true if the action matches the pattern
 */
export function matchesActionPattern(pattern: string, action: string): boolean {
  // Handle exact match
  if (pattern === action) return true;

  // Handle universal wildcard
  if (pattern === '*') return true;

  // Split by ':' delimiter
  const patternParts = pattern.split(':');
  const actionParts = action.split(':');

  // Check if pattern ends with a trailing wildcard (greedy matching)
  const lastPatternPart = patternParts[patternParts.length - 1];
  const hasTrailingWildcard = lastPatternPart === '*';

  // If pattern ends with *, it can match multiple remaining segments (greedy)
  if (hasTrailingWildcard && patternParts.length <= actionParts.length) {
    // Match all segments before the trailing wildcard exactly
    for (let i = 0; i < patternParts.length - 1; i++) {
      const patternPart = patternParts[i];
      const actionPart = actionParts[i];

      if (patternPart === '*') {
        // Middle wildcard matches single non-empty segment
        if (actionPart === '') {
          return false;
        }
        continue;
      }

      if (patternPart !== actionPart) {
        return false;
      }
    }

    // Trailing wildcard matches remaining segments (must have at least one non-empty)
    // For "prefix:*" matching "prefix:", we need at least one char after prefix:
    const remainingParts = actionParts.slice(patternParts.length - 1);
    // Check that there's something to match (at least one non-empty remaining part)
    return remainingParts.length > 0 && remainingParts.some(part => part !== '');
  }

  // Different segment counts - no match when no trailing wildcard
  if (patternParts.length !== actionParts.length) {
    return false;
  }

  // Match segment by segment
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const actionPart = actionParts[i];

    // Wildcard matches any non-empty segment
    if (patternPart === '*') {
      // Empty segment should not match wildcard (e.g., "prefix:" with empty after colon)
      if (actionPart === '') {
        return false;
      }
      continue;
    }

    // Exact segment match required
    if (patternPart !== actionPart) {
      return false;
    }
  }

  return true;
}
