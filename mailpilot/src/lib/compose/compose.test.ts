import { describe, expect, it } from "vitest";
import { findUnsupportedFacts, marketingIssues } from "./checks";
import { finalizeMessage, htmlToText, textToHtml } from "./html";
import { renderTemplate } from "@/lib/personalize/engine";

describe("htmlToText", () => {
  it("keeps paragraphs, lists and links readable", () => {
    const t = htmlToText('<p>Hello {{name}},</p><ul><li>One</li><li>Two &amp; three</li></ul><p>See <a href="https://x.dev/a">the page</a><br>Bye</p><style>p{}</style>');
    expect(t).toBe("Hello {{name}},\n\n- One\n- Two & three\n\nSee the page (https://x.dev/a)\nBye");
  });
  it("drops scripts and doesn't double-print mailto or same-text links", () => {
    expect(htmlToText('<script>alert(1)</script><a href="mailto:a@b.dev">a@b.dev</a>')).toBe("a@b.dev");
  });
});

describe("textToHtml", () => {
  it("escapes everything: model output can't inject markup", () => {
    const h = textToHtml('Hi {{name}}\n\n<script>alert(1)</script> <img src=x onerror=y> **bold**');
    expect(h).not.toContain("<script");
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<strong>bold</strong>");
    expect(h).toContain("{{name}}");
  });
  it("builds paragraphs and bullet lists", () => {
    const h = textToHtml("Intro\nsecond line\n\n- a\n- b");
    expect(h).toContain("<p");
    expect(h).toContain("Intro<br>second line");
    expect(h.match(/<li>/g)).toHaveLength(2);
  });
  it("round-trips through the personalization engine", () => {
    const r = renderTemplate({ subject: "s", html: textToHtml("Hello {{name}}"), text: "Hello {{name}}" }, { name: "<b>Al</b>" });
    expect(r.ok && r.html).toContain("Hello &lt;b&gt;Al&lt;/b&gt;");
  });
});

describe("finalizeMessage", () => {
  it("adds a plain-text part when only HTML was written", () => {
    const r = renderTemplate({ subject: "Hi {{name}}", html: "<p>Hello {{name}}</p>" }, { name: "Alex" });
    expect(r.ok && finalizeMessage(r)).toMatchObject({ subject: "Hi Alex", text: "Hello Alex" });
  });
});

describe("marketingIssues", () => {
  const withLink = { subject: "s", html: '<a href="{{unsubscribe_url}}">x</a>', text: "Unsub: {{ unsubscribe_url }}" };
  it("passes when every body part has the unsubscribe variable", () => expect(marketingIssues(withLink, true)).toEqual([]));
  it("flags the part that lacks it", () => {
    expect(marketingIssues({ ...withLink, text: "no link" }, true)[0]?.message).toContain("plain-text");
    expect(marketingIssues({ subject: "s", html: "<p>hi</p>" }, true)[0]?.message).toContain("HTML");
  });
  it("is silent for non-marketing mail and empty drafts", () => {
    expect(marketingIssues({ subject: "s", html: "<p>hi</p>" }, false)).toEqual([]);
    expect(marketingIssues({ subject: "s" }, true)).toEqual([]);
  });
});

describe("findUnsupportedFacts", () => {
  const brief = "Write a boarding confirmation. Include the recipient name and boarding code.";
  it("flags specifics the brief never gave", () => {
    const f = findUnsupportedFacts(brief, "Hello {{name}}, your boarding code is BD101 and you depart on Monday at 14:30. Visit https://x.dev/now or mail help@x.dev.");
    expect(f).toEqual(expect.arrayContaining(["BD101", "Monday", "14:30", "https://x.dev/now", "help@x.dev"]));
  });
  it("accepts facts that came from the brief, and ignores placeholders and markers", () => {
    expect(findUnsupportedFacts("Flight BD-1 departs 14:30 on Monday", "Flight BD-1 leaves at 14:30 on Monday. Code {{boarding_code}} [[gate 12]]")).toEqual([]);
  });
  it("finds nothing in clean prose", () => expect(findUnsupportedFacts(brief, "Hello {{name}}, your boarding code is {{boarding_code}}. Thank you.")).toEqual([]));
});
