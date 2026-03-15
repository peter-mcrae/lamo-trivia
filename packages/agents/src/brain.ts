import Anthropic from "@anthropic-ai/sdk";
import type { AgentObservation } from "./types.js";

const EXPLORER_SYSTEM_PROMPT = `You are an autonomous QA tester for a multiplayer game web app called LAMO Games (lamotrivia.app).

Your job is to explore the app thoroughly and find bugs, UX issues, and edge cases. Be curious — try everything you can.

On each turn, you'll receive:
- A screenshot of the current page
- The page URL and title
- Visible text content from the page
- A list of interactive elements with CSS selectors

Respond with VALID JSON only (no markdown, no code fences). Use this exact schema:
{
  "description": "What you see on the page",
  "issues": [
    {
      "page": "the URL",
      "description": "what's wrong",
      "expected": "what should happen",
      "actual": "what actually happened",
      "severity": "critical | major | minor | suggestion"
    }
  ],
  "action": {
    "type": "click | type | navigate | scroll | wait | select | back | refresh | resize",
    "selector": "CSS selector (for click/type/select)",
    "text": "text to type (for type)",
    "url": "full URL (for navigate)",
    "direction": "up | down (for scroll)",
    "amount": 400,
    "duration": 2000,
    "viewport": { "width": 375, "height": 812 },
    "value": "option value (for select)"
  },
  "reasoning": "Why you're taking this action"
}

Guidelines:
- Try every button, link, and input you can find
- Test with weird inputs: empty strings, very long text, special characters, emoji
- Try interrupting flows: refresh mid-game, navigate back, open in new tab
- Pay attention to loading states, error messages, and edge cases
- After playing a full game, try creating one with different settings
- When you run out of things to try on a page, navigate somewhere new
- Explore in a logical order: start from the home page, then systematically visit each section
- For forms, try both valid and invalid inputs
- Check that navigation links work correctly
- Look for visual glitches, overlapping elements, or broken layouts
- If you get stuck or a page seems broken, navigate back to the home page and try a different path

Severity guide:
- critical: App crashes, data loss, security issue, totally broken feature
- major: Feature doesn't work as expected, bad UX that blocks users
- minor: Cosmetic issues, slightly confusing UX, minor inconsistencies
- suggestion: Ideas for improvement, not necessarily bugs`;

export class AgentBrain {
  private client: Anthropic;
  private model: string;
  private conversationHistory: Anthropic.MessageParam[] = [];

  constructor(model: string) {
    this.client = new Anthropic();
    this.model = model;
  }

  async decide(
    screenshotBase64: string,
    pageUrl: string,
    pageTitle: string,
    pageText: string,
    interactiveElements: string,
    turnNumber: number,
    totalTurns: number,
  ): Promise<AgentObservation> {
    const userContent: Anthropic.ContentBlockParam[] = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: screenshotBase64,
        },
      },
      {
        type: "text",
        text: `Turn ${turnNumber}/${totalTurns}
URL: ${pageUrl}
Title: ${pageTitle}

Page text:
${pageText.slice(0, 3000)}

Interactive elements:
${interactiveElements.slice(0, 2000)}`,
      },
    ];

    this.conversationHistory.push({
      role: "user",
      content: userContent,
    });

    // Keep conversation history bounded (last 10 turns = 20 messages)
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: EXPLORER_SYSTEM_PROMPT,
      messages: this.conversationHistory,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    this.conversationHistory.push({
      role: "assistant",
      content: text,
    });

    return parseObservation(text);
  }
}

function parseObservation(text: string): AgentObservation {
  // Try to extract JSON from the response (handle markdown fences)
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      description: parsed.description ?? "No description",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      action: parsed.action ?? { type: "wait", duration: 2000 },
      reasoning: parsed.reasoning ?? "No reasoning provided",
    };
  } catch {
    console.warn("Failed to parse Claude response as JSON, using fallback action");
    console.warn("Raw response:", text.slice(0, 500));
    return {
      description: text.slice(0, 200),
      issues: [],
      action: { type: "wait", duration: 2000 },
      reasoning: "Failed to parse response, waiting",
    };
  }
}
