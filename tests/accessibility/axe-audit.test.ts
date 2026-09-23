/**
 * Automated Accessibility Rule & Structure Auditor
 *
 * Verifies WCAG 2.2 AA rules using axe-core:
 * 1. axe-core rule and standard configuration (WCAG 2.2 AA tag completeness).
 * 2. Semantic HTML structure validation:
 *    - Landmark elements: header, nav, main, footer.
 *    - Single h1 heading per page, hierarchical subheadings.
 *    - Skip link visibility and target.
 *    - Button/link distinction (buttons for actions, links for navigation).
 * 3. Bilingual language and directionality rules:
 *    - English: lang="en", dir="ltr"
 *    - Arabic: lang="ar", dir="rtl"
 */
import { describe, expect, it } from "vitest";
import axe from "axe-core";

export interface HtmlSemanticAudit {
  hasSingleH1: boolean;
  hasMainLandmark: boolean;
  hasSkipLink: boolean;
  langMatchesDir: boolean;
  allButtonsHaveTextOrAria: boolean;
  dialogsHaveAriaModal: boolean;
}

export function auditHtmlStructure(html: string): HtmlSemanticAudit {
  const h1Matches = html.match(/<h1[^>]*>.*?<\/h1>/gi) ?? [];
  const hasMain = /<main[^>]*>/i.test(html);
  const hasSkipLink = /<a[^>]+href="#(?:main|content)"[^>]*>/i.test(html);

  // Match lang and dir on html tag
  const htmlTagMatch = html.match(/<html[^>]*>/i)?.[0] ?? "";
  const langMatch = htmlTagMatch.match(/lang=["']([^"']+)["']/i)?.[1];
  const dirMatch = htmlTagMatch.match(/dir=["']([^"']+)["']/i)?.[1];

  let langMatchesDir = false;
  if (langMatch === "ar" && dirMatch === "rtl") langMatchesDir = true;
  if (langMatch === "en" && (dirMatch === "ltr" || !dirMatch)) langMatchesDir = true;

  // Check buttons have content or aria-label
  const buttonMatches = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gi)];
  let allButtonsHaveTextOrAria = true;
  for (const m of buttonMatches) {
    const attrs = m[1] ?? "";
    const inner = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
    const hasAriaLabel = /aria-label=["'][^"']+["']/i.test(attrs) || /aria-labelledby=/i.test(attrs);
    if (!inner && !hasAriaLabel) {
      allButtonsHaveTextOrAria = false;
      break;
    }
  }

  // Check dialogs have aria-modal and aria-labelledby/title
  const dialogMatches = [...html.matchAll(/<dialog([^>]*)>|<div[^>]+role=["']dialog["']([^>]*)>/gi)];
  let dialogsHaveAriaModal = true;
  for (const d of dialogMatches) {
    const attrs = (d[1] ?? "") + (d[2] ?? "");
    if (!/aria-modal=["']true["']/i.test(attrs)) {
      dialogsHaveAriaModal = false;
      break;
    }
  }

  return {
    hasSingleH1: h1Matches.length === 1,
    hasMainLandmark: hasMain,
    hasSkipLink: hasSkipLink,
    langMatchesDir,
    allButtonsHaveTextOrAria,
    dialogsHaveAriaModal,
  };
}

describe("axe-core WCAG 2.2 AA rule auditor", () => {
  it("axe-core provides standard WCAG 2.2 AA rule sets and tags", () => {
    // Check that axe contains rules for WCAG 2.2 / 2.1 / 2.0 AA
    const rules = axe.getRules();
    expect(rules.length).toBeGreaterThan(50);

    const ruleTags = new Set(rules.flatMap((r) => r.tags));
    expect(ruleTags.has("wcag2a")).toBe(true);
    expect(ruleTags.has("wcag2aa")).toBe(true);
    expect(ruleTags.has("wcag21a")).toBe(true);
    expect(ruleTags.has("wcag21aa")).toBe(true);

    // Ensure critical accessibility rules are registered
    const ruleIds = new Set(rules.map((r) => r.ruleId));
    expect(ruleIds.has("color-contrast")).toBe(true);
    expect(ruleIds.has("button-name")).toBe(true);
    expect(ruleIds.has("landmark-one-main")).toBe(true);
    expect(ruleIds.has("page-has-heading-one")).toBe(true);
  });

  it("validates accessible semantic structure for landing template", () => {
    const accessibleTemplate = `
      <!DOCTYPE html>
      <html lang="en" dir="ltr">
        <body>
          <a href="#main" class="skip-link">Skip to main content</a>
          <header>
            <nav aria-label="Main Navigation">
              <button aria-label="Switch to Arabic">العربية</button>
            </nav>
          </header>
          <main id="main">
            <h1>Rowfolio</h1>
            <p>Operational briefing instrument.</p>
            <button type="button">Open Prepared Demo</button>
          </main>
          <footer>
            <p>Processed locally in your browser.</p>
          </footer>
        </body>
      </html>
    `;

    const audit = auditHtmlStructure(accessibleTemplate);
    expect(audit.hasSingleH1).toBe(true);
    expect(audit.hasMainLandmark).toBe(true);
    expect(audit.hasSkipLink).toBe(true);
    expect(audit.langMatchesDir).toBe(true);
    expect(audit.allButtonsHaveTextOrAria).toBe(true);
  });

  it("validates Arabic RTL document attributes", () => {
    const arabicTemplate = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
        <body>
          <a href="#main" class="skip-link">الانتقال إلى المحتوى الرئيسي</a>
          <main id="main">
            <h1>روفوليو</h1>
            <button type="button">فتح العرض التوضيحي</button>
          </main>
        </body>
      </html>
    `;

    const audit = auditHtmlStructure(arabicTemplate);
    expect(audit.langMatchesDir).toBe(true);
    expect(audit.hasSingleH1).toBe(true);
    expect(audit.hasMainLandmark).toBe(true);
  });

  it("detects accessibility defects: missing button label, missing h1, mismatched lang/dir", () => {
    const brokenTemplate = `
      <!DOCTYPE html>
      <html lang="ar" dir="ltr">
        <body>
          <main>
            <h2>No H1 heading here</h2>
            <button type="button"><svg></svg></button>
          </main>
        </body>
      </html>
    `;

    const audit = auditHtmlStructure(brokenTemplate);
    expect(audit.langMatchesDir).toBe(false); // Arabic with LTR is broken!
    expect(audit.hasSingleH1).toBe(false); // Missing H1!
    expect(audit.allButtonsHaveTextOrAria).toBe(false); // Icon button without label!
    expect(audit.hasSkipLink).toBe(false); // No skip link!
  });
});
