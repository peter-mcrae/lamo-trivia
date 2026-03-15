/**
 * Feature-specific test scenarios that guide the agent through
 * particular flows with targeted system prompt additions.
 */

export interface TestScenario {
  name: string;
  description: string;
  /** Starting URL path (appended to baseUrl) */
  startPath: string;
  /** Whether auth is required */
  requiresAuth: boolean;
  /** Additional system prompt instructions for this scenario */
  instructions: string;
  /** Suggested turn count */
  suggestedTurns: number;
}

export const SCENARIOS: Record<string, TestScenario> = {
  "trivia-create-play": {
    name: "Trivia: Create & Play",
    description: "Create a trivia game with various settings and play through it",
    startPath: "/create",
    requiresAuth: false,
    suggestedTurns: 40,
    instructions: `You are testing the TRIVIA GAME creation and play flow.

Your mission:
1. Start at /create. Fill in the game creation form:
   - Try different question sources: "Pick Categories" and "AI Generated"
   - For categories, select 2-3 from the grid (Harry Potter, General, Science, History, Sports, Entertainment, Geography, Math, Wimpy Kid)
   - For AI generated, type a creative topic
   - Adjust question count, time per question, scoring method
   - Try both public and private games
2. Click "Create Game" and wait for the game room
3. In the game room, enter a username (use "TestBot-1")
4. Click "Start Game" (you may need to wait if there's a min player requirement)
5. For each question, read the question and select an answer
6. After the game ends, check the results/podium screen
7. Try "Play Again" if available, or go back and create another game with different settings

Edge cases to test:
- Very short time per question (5s) - can you answer in time?
- Maximum questions (20)
- Try creating a game, then refreshing the page mid-waiting
- Try going back during a game
- Enter a very long username or one with special characters
- Try to start with fewer than minimum players`,
  },

  "trivia-categories": {
    name: "Trivia: All Categories",
    description: "Create and play a game in each available category",
    startPath: "/create",
    requiresAuth: false,
    suggestedTurns: 60,
    instructions: `You are testing ALL TRIVIA CATEGORIES systematically.

Categories to test: Harry Potter, General, Science, History, Sports, Entertainment, Geography, Math, Wimpy Kid

For each category:
1. Go to /create
2. Select "Pick Categories" and choose ONE category
3. Set question count to 3 (to keep it quick)
4. Create and play through the game
5. Note if questions seem appropriate for the category
6. Note any duplicate questions

Also try:
- Selecting ALL categories at once
- AI-generated topics: "90s Movies", "Space", "Ancient Rome"
- Check that category-specific routes work (e.g., /trivia/harry-potter)`,
  },

  "hunt-photo": {
    name: "Scavenger Hunt: Photo Submission",
    description: "Create a scavenger hunt and test photo submissions",
    startPath: "/hunt/create",
    requiresAuth: true,
    suggestedTurns: 50,
    instructions: `You are testing the SCAVENGER HUNT photo submission flow.

Your mission:
1. Go to /hunt/create
2. Configure a hunt:
   - Set items to 3 (keep it manageable)
   - Set max retries to 3
   - Set duration to 15 minutes
   - Set max players to 2
3. Create the hunt (requires credits/auth)
4. Enter username "TestBot-1"
5. Start the hunt
6. For each item:
   - Read the item description
   - Click "Take Photo" button
   - In the photo capture modal, upload a test image
   - Wait for AI verification result
   - If rejected, try the "Contest" button
   - Try revealing clues (click "Reveal Clue" buttons)
7. Test edge cases:
   - Submit a photo for an already-found item
   - Try when no attempts remain
   - Refresh the page mid-hunt
   - Check the timer display

Photo upload: When you see the file input, upload the test photo file.
The file input accepts image/* files (JPEG, PNG, WebP).`,
  },

  "riddle-wordle": {
    name: "Riddle Wordle",
    description: "Play through the riddle guessing game",
    startPath: "/riddle-wordle",
    requiresAuth: false,
    suggestedTurns: 30,
    instructions: `You are testing the RIDDLE WORDLE game.

Your mission:
1. Navigate to /riddle-wordle
2. Read the riddle displayed
3. Note the answer length shown (e.g., "Answer: 5 letters")
4. Use the on-screen keyboard to type guesses:
   - Click letter buttons (Q, W, E, R, etc.) to build a word
   - Click ENTER to submit
   - Click BACK to delete letters
5. Observe the color feedback:
   - Green = correct position
   - Yellow = letter in word but wrong position
   - Dark gray = letter not in word
6. Use the feedback to narrow down the answer
7. After winning or losing, click "New Riddle" to play again
8. Play at least 3 riddles

Edge cases to test:
- Try submitting a word that's too short (fewer letters than required)
- Try submitting a non-dictionary word
- Click "Show hint" if available
- Try using the physical keyboard (type letters directly)
- Check keyboard letter colors update after each guess
- Try clicking a letter that's already been tried`,
  },

  "groups": {
    name: "Groups: Create & Manage",
    description: "Create a group, explore the lobby, create games within it",
    startPath: "/group/new",
    requiresAuth: true,
    suggestedTurns: 40,
    instructions: `You are testing the GROUPS feature.

Your mission:
1. Go to /group/new
2. Create a group with name "Test Group Bot"
3. In the group lobby, observe:
   - Group code display
   - Member list
   - Share functionality
4. Try creating a trivia game within the group:
   - Click "Create New Game" or similar
   - Configure and create
   - Check it appears in the group's active games
5. Try creating a hunt within the group
6. Go to /groups to see your groups list
7. Try joining a group with an invalid code at /group/join

Edge cases to test:
- Create a group with special characters in the name
- Create a group with a very long name (50+ chars)
- Try the share button
- Check the group code format (should be 4 hyphenated words)
- Try refreshing the group lobby page`,
  },

  "navigation": {
    name: "Full Site Navigation",
    description: "Visit every page and check all links work",
    startPath: "/",
    requiresAuth: false,
    suggestedTurns: 40,
    instructions: `You are testing SITE-WIDE NAVIGATION and page accessibility.

Visit every page systematically:
1. / (Home) - Check all links, CTAs
2. /create - Game creation page
3. /about - About page
4. /how-to-play - How to play guide
5. /how-to-hunt - How to hunt guide
6. /login - Login page
7. /credits - Credits/purchase page
8. /groups - Groups listing (may need auth)
9. /riddle-wordle - Riddle game
10. /group/new - Create group (needs auth)
11. /group/join - Join group

For each page:
- Check the page loads without errors
- Check all navigation links work
- Check responsive behavior (try resizing)
- Look for broken images, missing text, layout issues
- Check that the header/footer navigation is consistent
- Test browser back/forward buttons
- Check page titles are correct`,
  },

  "auth-flow": {
    name: "Authentication Flow",
    description: "Test the login/logout flow with magic codes",
    startPath: "/login",
    requiresAuth: false,
    suggestedTurns: 20,
    instructions: `You are testing the AUTHENTICATION flow.

Your mission:
1. Navigate to /login
2. Test the email input:
   - Enter a valid email address
   - Click "Send Code" or similar
   - Observe the code input appears
3. Test edge cases on the email form:
   - Empty email submission
   - Invalid email format (no @, no domain)
   - Very long email
4. Test the code input:
   - Enter an incorrect 6-digit code
   - Check error message
5. Test the login state:
   - After auth (if possible), check that protected pages work
   - Check /groups, /hunt/create are accessible
   - Test logout

Note: You may not be able to complete actual login without access to the email.
Focus on testing the UI behavior and error handling.`,
  },

  "mobile": {
    name: "Mobile Viewport Testing",
    description: "Test all features at mobile viewport (375x812)",
    startPath: "/",
    requiresAuth: false,
    suggestedTurns: 50,
    instructions: `You are testing MOBILE RESPONSIVENESS at 375x812 viewport.

Check every page for mobile layout issues:
1. Home page: Are CTAs visible? Is text readable?
2. Game creation: Do form controls fit? Dropdowns usable?
3. Game room: Can you see questions and answers?
4. Riddle Wordle: Is the keyboard usable on small screen?
5. Groups: Does the layout adapt?
6. Navigation: Is the menu/hamburger working?
7. Login: Are inputs sized correctly?

For each page look for:
- Horizontal scrolling (bad - content should fit)
- Text truncation or overlap
- Buttons too small to tap (< 44x44px)
- Forms that are hard to fill out
- Modals that overflow the screen
- Images that don't resize
- Navigation that's hard to access`,
  },
};

export function getScenario(name: string): TestScenario | undefined {
  return SCENARIOS[name];
}

export function listScenarios(): string[] {
  return Object.keys(SCENARIOS);
}
