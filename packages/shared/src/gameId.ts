/** Canonical game ID format: 4 uppercase letters (no I/O) + hyphen + 4 digits */
export const GAME_ID_REGEX = /^[A-HJ-NP-Z]{4}-[0-9]{4}$/;

/**
 * Generate a game ID: 4 uppercase letters (excluding I/O for readability) + hyphen + 4 digits.
 * Example: "ABCD-1234"
 */
export function generateGameId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += nums[Math.floor(Math.random() * nums.length)];
  return code;
}
