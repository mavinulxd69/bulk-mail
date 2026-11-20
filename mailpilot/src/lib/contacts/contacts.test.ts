import { describe, expect, it } from "vitest";
import { parseCsv, CsvError } from "./csv";
import { isValidEmail, parseAddressList } from "./emails";
import { parseContactInput } from "./parse";
import { validateRecords } from "./validate";

describe("parseCsv", () => {
  it("parses the spec example", () => {
    const { rows } = parseCsv("email,name,boarding_code\nalex@gmail.com,Alex,BD101\njohn@gmail.com,John,BD102\n");
    expect(rows.map((r) => r.cells)).toEqual([["email", "name", "boarding_code"], ["alex@gmail.com", "Alex", "BD101"], ["john@gmail.com", "John", "BD102"]]);
  });
  it("handles quotes, escaped quotes, embedded newlines and CRLF", () => {
    const { rows } = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z');
    expect(rows[1]!.cells).toEqual(["x, y", 'say "hi"']);
    expect(rows[2]!.cells).toEqual(["line1\nline2", "z"]);
    expect(rows[2]!.line).toBe(3);
  });
  it("strips a BOM, skips blank lines and detects semicolons and tabs", () => {
    expect(parseCsv("\uFEFFemail;name\n\na@b.co;A\n").rows.map((r) => r.cells)).toEqual([["email", "name"], ["a@b.co", "A"]]);
    expect(parseCsv("email\tname\na@b.co\tA").delimiter).toBe("\t");
  });
  it("rejects an unterminated quote and junk after a closing quote", () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(CsvError);
    expect(() => parseCsv('a,b\n"x"y,1')).toThrow(CsvError);
  });
  it("enforces the row cap", () => {
    expect(() => parseCsv("a\n1\n2\n3", { maxRows: 2 })).toThrow(/more than 2 rows/);
  });
});

describe("isValidEmail", () => {
  it.each(["alex@gmail.com", "a.b+tag@sub.example.co.uk", "X@Example.COM"])("accepts %s", (e) => expect(isValidEmail(e)).toBe(true));
  it.each(["", "plain", "a@b", "a@@b.com", "a b@c.com", "a@b.c", ".a@b.com", "a..b@c.com", "a@-b.com", "a@b.123", "a@b.com\nBcc: x@y.com", "a@b.com\u0000"])("rejects %j", (e) => expect(isValidEmail(e)).toBe(false));
});

describe("parseAddressList", () => {
  it("splits on newlines, commas, semicolons and spaces, and reads Name <addr>", () => {
    const r = parseAddressList('a@x.com, b@x.com;c@x.com d@x.com\n"Jane Doe" <jane@x.com>');
    expect(r.map((x) => x.email)).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "jane@x.com"]);
    expect(r.find((x) => x.email === "jane@x.com")).toMatchObject({ name: "Jane Doe", line: 2 });
    expect(r).toHaveLength(5);
  });
});

describe("parseContactInput", () => {
  it("treats text with an email header as CSV and puts extra columns in fields", () => {
    const o = parseContactInput("Email, Name ,Boarding Code,Company\nalex@gmail.com,Alex,BD101,\n");
    expect(o.ok && o.kind).toBe("csv");
    if (o.ok) { expect(o.fieldColumns).toEqual(["boarding_code", "company"]); expect(o.records[0]).toMatchObject({ email: "alex@gmail.com", name: "Alex", fields: { boarding_code: "BD101" } }); }
  });
  it("treats header-less text as an address list", () => {
    const o = parseContactInput("a@x.com\nb@x.com");
    expect(o.ok && o.kind).toBe("list");
  });
  it.each([
    ["name,boarding_code\nAlex,BD1", /email/i],
    ["email,name,Name\na@x.com,A,B", /two columns/i],
    ["email,unsubscribe_url\na@x.com,http://evil", /reserved/i],
    ["email,1st thing\na@x.com,1", /variable name/i],
    ["email,name", /no rows/i],
  ])("rejects bad CSV %j", (csv, msg) => {
    const o = parseContactInput(csv);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.error).toMatch(msg);
  });
  it("flags rows with more cells than headers", () => {
    const o = parseContactInput("email,name\na@x.com,A,extra");
    expect(o.ok && o.records[0]?.malformed).toBe(true);
  });
});

describe("validateRecords", () => {
  const rec = (email: string, extra: Partial<{ name: string; fields: Record<string, string>; line: number }> = {}) => ({ line: extra.line ?? 2, email, name: extra.name ?? "", fields: extra.fields ?? {}, consentSource: "" });
  it("separates valid rows from invalid, duplicate and missing-required rows", () => {
    const { valid, issues } = validateRecords([
      rec("Alex@Gmail.com", { fields: { boarding_code: "BD1" }, line: 2 }),
      rec("alex@gmail.com", { fields: { boarding_code: "BD9" }, line: 3 }),
      rec("not-an-email", { line: 4 }),
      rec("john@gmail.com", { line: 5 }),
    ], { required: ["boarding_code"] });
    expect(valid.map((v) => v.email)).toEqual(["alex@gmail.com"]);
    expect(issues.map((i) => [i.line, i.code])).toEqual([[3, "duplicate_in_file"], [4, "invalid_email"], [5, "missing_required"]]);
  });
  it("lets a later valid row through when an earlier duplicate was rejected for another reason", () => {
    const { valid } = validateRecords([rec("a@x.com", { line: 2 }), rec("a@x.com", { line: 3, fields: { code: "1" } })], { required: ["code"] });
    expect(valid).toHaveLength(1);
    expect(valid[0]!.line).toBe(3);
  });
  it("can require the name column", () => {
    expect(validateRecords([rec("a@x.com")], { required: ["name"] }).issues[0]?.code).toBe("missing_required");
  });
  it("rejects oversize values", () => {
    expect(validateRecords([rec("a@x.com", { name: "x".repeat(201) })], { required: [] }).issues[0]?.code).toBe("value_too_long");
  });
});

import { contactVariables, formatFieldLines, parseFieldLines } from "./fields";
describe("fields", () => {
  it("parses key: value and key=value lines and normalises keys", () => {
    expect(parseFieldLines("Boarding Code: BD101\ncompany = Acme\n\n")).toEqual({ ok: true, fields: { boarding_code: "BD101", company: "Acme" } });
  });
  it("drops blank values, rejects reserved and invalid keys", () => {
    expect(parseFieldLines("company:")).toEqual({ ok: true, fields: {} });
    expect(parseFieldLines("email: x")).toMatchObject({ ok: false });
    expect(parseFieldLines("unsubscribe_url: http://evil")).toMatchObject({ ok: false });
    expect(parseFieldLines("1bad: x")).toMatchObject({ ok: false });
    expect(parseFieldLines("no separator")).toMatchObject({ ok: false });
  });
  it("round-trips through formatFieldLines", () => {
    const f = { boarding_code: "BD101", company: "Acme" };
    expect(parseFieldLines(formatFieldLines(f))).toEqual({ ok: true, fields: f });
  });
  it("contactVariables: columns override custom fields; non-string values are ignored", () => {
    expect(contactVariables({ email: "a@x.com", name: null, fields: { name: "spoof", email: "evil@x.com", code: "1", n: 5 } })).toEqual({ email: "a@x.com", code: "1" });
  });
});
