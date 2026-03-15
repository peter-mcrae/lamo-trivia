# Autonomous Testing Agents - Plan

## Goal

Build 2-4 autonomous agents that use LAMO Games in production like real users — exploring every feature, finding bugs, edge cases, and generating ideas for improvements.

## Architecture

### Approach: Playwright + Claude API (browser agents)

Each agent is a Node.js script that controls a headless browser via Playwright and uses Claude to make decisions about what to do next.

```
Loop:
  1. Capture page state (screenshot + DOM text)
  2. Send to Claude with system prompt: "You are testing a game app. Be curious. Try everything. Report anything broken, confusing, or unexpected."
  3. Claude returns a structured action: { action: "click", selector: "#start-btn" }
  4. Execute action in Playwright
  5. Log everything (screenshots, actions, observations)
  6. Repeat
```

### Agent Types

**Explorer Agent (solo)**
- Navigates the full app surface area
- Creates games with different settings, plays through them
- Tries edge cases: weird inputs, rapid clicks, back/forward navigation, refreshing mid-game
- Tests responsive behavior (mobile vs desktop viewport)

**Multiplayer Agent (coordinated pair)**
- Agent A creates a game/group, Agent B joins via the link or code
- They play through a full game together
- Tests: host leaving mid-game, rejoining, simultaneous actions, slow connections
- Scavenger hunts: both submit photos, test appeals

## Key Challenges & Solutions

### 1. Authentication (magic link codes)

The app uses email-based passwordless auth (6-digit codes). Agents need to sign in to create groups and scavenger hunts.

**Options (pick one):**
- **Mailosaur / Mailpit** — Use a test email service with an API. Agent sends login request, polls email API for the code, enters it.
- **Test bypass** — Add a backend route (behind an env flag, prod-disabled or secret-gated) that returns the code for a given email. Simplest but requires a backend change.
- **Pre-authenticated sessions** — Manually sign in, export the JWT, and inject it into the agent's browser. Works but tokens expire.

**Recommendation:** Mailosaur (or similar) is cleanest — no backend changes, works in real prod conditions. Use dedicated test email addresses like `agent1@yourdomain.testmail.app`.

### 2. Photo Submissions (scavenger hunts)

Agents need to submit photos for hunt items. The AI vision verifier checks if the photo matches the item.

**Approach:**
- Maintain a folder of stock/AI-generated photos organized by common categories (animals, food, landmarks, etc.)
- When an agent gets a hunt item, use Claude to pick the best matching photo from the library
- Also test failure cases: submit wrong photos, blurry photos, unrelated images
- Test the appeal flow when photos are rejected

### 3. Multiplayer Coordination

Agents playing together need to be loosely synchronized (one creates, others join before the game starts).

**Approach:**
- Use a shared coordination file or simple in-memory queue
- Agent A writes game/group codes to the queue after creating
- Agent B polls the queue and joins
- Add configurable delays to simulate real human timing (2-10 seconds between actions)

### 4. Avoiding Data Pollution

These agents will create real games, groups, and accounts in prod.

**Approach:**
- Use clearly marked test accounts: `lamo-test-agent-1@...`, `lamo-test-agent-2@...`
- Use obvious test usernames: `TestBot-1`, `TestBot-2`
- Periodically clean up test data (or add a cleanup script that removes games/groups from test accounts)
- Consider a `test` group that all agent games go into

## Tech Stack

- **Runtime:** Node.js
- **Browser automation:** Playwright
- **AI decisions:** Claude API (claude-sonnet-4-20250514, vision-capable)
- **Logging:** JSON logs per session + screenshots saved to disk
- **Coordination:** Simple file-based or Redis pub/sub for multiplayer sync
- **Email:** Mailosaur or similar test email service

## Agent System Prompt (draft)

```
You are an autonomous QA tester for a multiplayer game web app called LAMO Games.

Your job is to explore the app thoroughly and find bugs, UX issues, and edge cases. Be curious — try everything you can.

On each turn, you'll see a screenshot of the current page. Respond with:
1. observations: What do you see? Is anything broken, confusing, or unexpected?
2. action: What to do next (click, type, navigate, wait, etc.)
3. severity: If you found an issue, rate it (critical / major / minor / suggestion)

Guidelines:
- Try every button, link, and input you can find
- Test with weird inputs: empty strings, very long text, special characters, emoji
- Try interrupting flows: refresh mid-game, navigate back, open in new tab
- Pay attention to loading states, error messages, and edge cases
- After playing a full game, try creating one with different settings
- Test mobile viewport (375x812) and desktop (1440x900)
- When you run out of things to try on a page, navigate somewhere new

Report format for issues:
{ page, action, expected, actual, severity, screenshot }
```

## Output & Reporting

Each agent session produces:
- **Session log** — JSON array of every action taken, with timestamps
- **Screenshots** — Saved at each step, referenced in the log
- **Bug reports** — Structured list of issues found, with severity and reproduction steps
- **Coverage map** — Which pages/features were visited and tested

After a batch of sessions, aggregate into a summary:
- Pages visited and % coverage
- Issues found, grouped by severity
- Suggested improvements / patterns noticed

## Implementation Phases

### Phase 1: Single Explorer Agent
- Set up Playwright + Claude API loop
- Handle auth (pick email approach)
- Test on trivia game flow end-to-end
- Get logging and screenshot capture working

### Phase 2: Full Feature Coverage
- Extend agent to cover all game types (trivia, riddle guess, hunts)
- Add photo submission capability for hunts
- Test groups (create, join, play within group)
- Add viewport switching for mobile testing

### Phase 3: Multiplayer Agents
- Build coordination layer
- Run 2 agents that create and join the same game
- Test concurrent gameplay scenarios
- Test edge cases: both submit at same time, one leaves, reconnection

### Phase 4: Reporting & Automation
- Build aggregation script for session logs
- Generate summary reports
- Set up scheduled runs (daily or on-demand)
- Alerting for critical issues found

## Estimated Effort

- Phase 1: 1-2 days
- Phase 2: 1-2 days
- Phase 3: 1-2 days
- Phase 4: 1 day

## Cost Estimate

Per agent session (~100 turns, ~30 min):
- Claude API (sonnet, with screenshots): ~$1-3 per session
- Mailosaur: Free tier covers test volume
- Playwright: Free (open source)

Running 4 agents daily: ~$5-15/day
