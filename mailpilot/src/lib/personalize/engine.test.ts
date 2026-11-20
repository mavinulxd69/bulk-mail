import { describe, expect, it } from "vitest";
import { analyzeAudience, escapeHtml, hasUnsafeUrl, renderTemplate, tokenize, validateTemplate } from "./engine";

const spec = {
  subject: "Your Boarding Confirmation - {{name}}",
  html: "<p>Hello {{name}},</p><p>Your boarding code is: <b>{{boarding_code}}</b></p>",
  text: "Hello {{name}},\n\nYour boarding code is: {{boarding_code}}\n\nThank you.",
};
const alex = { email: "alex@gmail.com", name: "Alex", boarding_code: "BD101" };

describe("renderTemplate", () => {
  it("renders the spec example uniquely per recipient", () => {
    const a = renderTemplate(spec, alex), j = renderTemplate(spec, { ...alex, name: "John", boarding_code: "BD102" });
    expect(a).toMatchObject({ ok: true, subject: "Your Boarding Confirmation - Alex" });
    expect(a.ok && a.text).toContain("BD101");
    expect(j.ok && j.html).toContain("BD102");
    expect(j.ok && j.html).not.toContain("BD101");
  });
  it("accepts {{ spaced }} and mixed-case placeholders", () => {
    expect(renderTemplate({ subject: "Hi {{ Name }}", text: "x" }, alex)).toMatchObject({ ok: true, subject: "Hi Alex" });
  });
  it("never partially renders: a missing or blank variable fails the whole message", () => {
    for (const data of [{ ...alex, boarding_code: undefined }, { ...alex, boarding_code: "   " }, { ...alex, boarding_code: null }]) {
      const r = renderTemplate(spec, data);
      expect(r).toMatchObject({ ok: false, reason: "missing_variables", missing: ["boarding_code"] });
      expect(r).not.toHaveProperty("html");
    }
  });
  it("escapes HTML in values for the HTML part only", () => {
    const r = renderTemplate({ subject: "Hi {{name}}", html: "<p>{{name}}</p>", text: "{{name}}" }, { name: `<script>alert("x")</script> & 'q'` });
    expect(r.ok && r.html).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>");
    expect(r.ok && r.text).toBe(`<script>alert("x")</script> & 'q'`);
  });
  it("collapses line breaks in subject values (header injection)", () => {
    const r = renderTemplate({ subject: "Hi {{name}}", text: "x" }, { name: "Eve\r\nBcc: victim@example.com" });
    expect(r.ok && r.subject).toBe("Hi Eve Bcc: victim@example.com");
    expect(r.ok && /[\r\n]/.test(r.subject)).toBe(false);
  });
  it("blocks javascript:/data: URLs injected through values", () => {
    const t = { subject: "s", html: '<a href="{{link}}">go</a>' };
    expect(renderTemplate(t, { link: "javascript:alert(1)" })).toMatchObject({ ok: false, reason: "unsafe_content" });
    expect(renderTemplate(t, { link: " JaVa\tScRiPt:alert(1)" })).toMatchObject({ ok: false, reason: "unsafe_content" });
    expect(renderTemplate(t, { link: "https://example.com/a?b=1&c=2" })).toMatchObject({ ok: true });
  });
  it("does not leak prototype properties as variables", () => {
    expect(renderTemplate({ subject: "{{constructor}}", text: "x" }, {})).toMatchObject({ ok: false, missing: ["constructor"] });
    expect(renderTemplate({ subject: "{{__proto__}}", text: "x" }, {})).toMatchObject({ ok: false });
  });
  it("system variables win over contact data and cannot be spoofed", () => {
    const t = { subject: "s", text: "Unsub: {{unsubscribe_url}}" };
    expect(renderTemplate(t, { unsubscribe_url: "http://evil" }, { unsubscribe_url: "https://app/u/abc" })).toMatchObject({ ok: true, text: "Unsub: https://app/u/abc" });
  });
  it("rejects broken templates instead of sending them as-is", () => {
    for (const subject of ["Hi {{name", "Hi {{}}", "Hi {{ first name }}", "Hi {{name|upper}}", "Hi {{ {{name}} }}"]) {
      expect(renderTemplate({ subject, text: "x" }, alex)).toMatchObject({ ok: false, reason: "template_invalid" });
    }
  });
  it("requires a subject and a body, and a subject that is not empty after rendering", () => {
    expect(validateTemplate({ subject: " ", text: "x" }).errors).toHaveLength(1);
    expect(validateTemplate({ subject: "s" }).errors[0]?.part).toBe("template");
    expect(validateTemplate({ subject: "s\nBcc: x", text: "x" }).errors[0]?.message).toMatch(/line breaks/);
  });
  it("is deterministic and does not mutate its input", () => {
    const data = Object.freeze({ ...alex });
    expect(renderTemplate(spec, data)).toEqual(renderTemplate(spec, data));
  });
});

describe("tokenize / helpers", () => {
  it("round-trips literal text around placeholders", () => {
    expect(tokenize("a {{b}} c").tokens).toEqual([{ type: "text", value: "a " }, { type: "var", name: "b" }, { type: "text", value: " c" }]);
  });
  it("escapeHtml covers the five special characters", () => expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;"));
  it("hasUnsafeUrl ignores safe schemes and plain text", () => {
    expect(hasUnsafeUrl('<a href="https://x.com">a</a><img src="cid:logo">')).toBe(false);
    expect(hasUnsafeUrl("<img src='data:text/html;base64,AAA'>")).toBe(true);
  });
});

describe("analyzeAudience", () => {
  const people = [
    { id: "1", data: alex },
    { id: "2", data: { email: "john@gmail.com", name: "John", boarding_code: "BD102" } },
    { id: "3", data: { email: "david@gmail.com", name: "David" } },
  ];
  it("counts ready vs blocked and names the missing variable per recipient", () => {
    const r = analyzeAudience(spec, people);
    expect(r).toMatchObject({ total: 3, ready: 2, blocked: 1, missingByVariable: { name: 0, boarding_code: 1 }, unknownVariables: [] });
    expect(r.blockedRecipients).toEqual([{ id: "3", missing: ["boarding_code"] }]);
  });
  it("flags a variable no recipient has and suggests the closest field", () => {
    const r = analyzeAudience({ subject: "{{name}}", text: "{{boarding_cod}}" }, people.slice(0, 2));
    expect(r.unknownVariables).toEqual(["boarding_cod"]);
    expect(r.suggestions).toEqual({ boarding_cod: "boarding_code" });
  });
  it("blocks everyone when the template is invalid, and ignores system variables", () => {
    expect(analyzeAudience({ subject: "{{", text: "x" }, people).ready).toBe(0);
    expect(analyzeAudience({ subject: "s", text: "{{unsubscribe_url}}" }, people)).toMatchObject({ ready: 3, blocked: 0 });
  });
  it("handles an empty audience", () => expect(analyzeAudience(spec, [])).toMatchObject({ total: 0, ready: 0, unknownVariables: [] }));
});

describe("unresolved [[markers]]", () => {
  it("fails validation and rendering, so a half-written draft can't be sent", () => {
    const tpl = { subject: "Hi {{name}}", text: "Your flight leaves at [[departure time]]." };
    expect(validateTemplate(tpl).errors).toEqual([expect.objectContaining({ part: "text", code: "marker" })]);
    expect(renderTemplate(tpl, { name: "Alex" })).toMatchObject({ ok: false, reason: "template_invalid" });
  });
  it("ignores single brackets and normal text", () => {
    expect(validateTemplate({ subject: "Hi", text: "See [1] and [note]." }).errors).toEqual([]);
  });
});
