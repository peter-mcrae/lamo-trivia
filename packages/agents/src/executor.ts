import type { Page } from "playwright";
import type { AgentAction } from "./types.js";

/**
 * Executes a single agent action in the browser.
 * Returns a description of what happened.
 */
export async function executeAction(page: Page, action: AgentAction): Promise<string> {
  switch (action.type) {
    case "click": {
      if (!action.selector) throw new Error("click action requires a selector");
      await page.waitForSelector(action.selector, { timeout: 5000 });
      await page.click(action.selector, { timeout: 5000 });
      return `Clicked ${action.selector}`;
    }

    case "type": {
      if (!action.selector) throw new Error("type action requires a selector");
      if (action.text === undefined) throw new Error("type action requires text");
      await page.waitForSelector(action.selector, { timeout: 5000 });
      // Clear existing text first, then type
      await page.fill(action.selector, "");
      await page.type(action.selector, action.text, { delay: 50 });
      return `Typed "${action.text}" into ${action.selector}`;
    }

    case "navigate": {
      if (!action.url) throw new Error("navigate action requires a url");
      await page.goto(action.url, { waitUntil: "networkidle", timeout: 15000 });
      return `Navigated to ${action.url}`;
    }

    case "scroll": {
      const direction = action.direction ?? "down";
      const amount = action.amount ?? 400;
      const delta = direction === "down" ? amount : -amount;
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(500);
      return `Scrolled ${direction} by ${amount}px`;
    }

    case "wait": {
      const duration = action.duration ?? 2000;
      await page.waitForTimeout(duration);
      return `Waited ${duration}ms`;
    }

    case "select": {
      if (!action.selector) throw new Error("select action requires a selector");
      if (!action.value) throw new Error("select action requires a value");
      await page.selectOption(action.selector, action.value);
      return `Selected "${action.value}" in ${action.selector}`;
    }

    case "back": {
      await page.goBack({ waitUntil: "networkidle", timeout: 10000 });
      return "Went back";
    }

    case "refresh": {
      await page.reload({ waitUntil: "networkidle", timeout: 10000 });
      return "Refreshed page";
    }

    case "resize": {
      if (!action.viewport) throw new Error("resize action requires viewport dimensions");
      await page.setViewportSize(action.viewport);
      await page.waitForTimeout(500);
      return `Resized viewport to ${action.viewport.width}x${action.viewport.height}`;
    }

    case "keyboard": {
      if (!action.key) throw new Error("keyboard action requires a key");
      await page.keyboard.press(action.key);
      return `Pressed key: ${action.key}`;
    }

    case "upload": {
      if (!action.selector) throw new Error("upload action requires a selector");
      if (!action.filePath) throw new Error("upload action requires a filePath");
      const fileInput = page.locator(action.selector);
      await fileInput.setInputFiles(action.filePath);
      return `Uploaded file ${action.filePath} to ${action.selector}`;
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/**
 * Extracts visible text content from the page for context.
 */
export async function getPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Get meaningful text, skip hidden elements and scripts
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const el = node.parentElement;
          if (!el) return NodeFilter.FILTER_REJECT;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") {
            return NodeFilter.FILTER_REJECT;
          }
          const tag = el.tagName.toLowerCase();
          if (["script", "style", "noscript"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          const text = node.textContent?.trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const texts: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) texts.push(text);
    }
    return texts.join("\n").slice(0, 4000);
  });
}

/**
 * Gets all interactive elements on the page with their selectors.
 */
export async function getInteractiveElements(page: Page): Promise<string> {
  return page.evaluate(() => {
    const elements: string[] = [];
    const selectors = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[onclick]",
      "[tabindex]",
    ];

    for (const selector of selectors) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        if (style.display === "none" || style.visibility === "hidden") continue;

        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const text = htmlEl.innerText?.trim().slice(0, 50) || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const href = el.getAttribute("href") || "";
        const id = el.id ? `#${el.id}` : "";
        const classes = el.className && typeof el.className === "string"
          ? `.${el.className.split(" ").filter(Boolean).slice(0, 2).join(".")}`
          : "";

        // Build a useful CSS selector
        let cssSelector = tag;
        if (id) cssSelector = id;
        else if (ariaLabel) cssSelector = `${tag}[aria-label="${ariaLabel}"]`;
        else if (type) cssSelector = `${tag}[type="${type}"]`;
        else if (placeholder) cssSelector = `${tag}[placeholder="${placeholder}"]`;
        else if (classes) cssSelector = `${tag}${classes}`;

        const label = text || placeholder || ariaLabel || href || type;
        elements.push(`  ${cssSelector} → "${label}"`);
      }
    }

    return elements.slice(0, 50).join("\n");
  });
}
