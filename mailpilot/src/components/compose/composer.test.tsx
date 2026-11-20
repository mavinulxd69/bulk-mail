import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("@/app/dashboard/compose/actions", () => ({ generateDraft: vi.fn(), previewCompose: vi.fn(), saveCampaignDraft: vi.fn(), saveTemplate: vi.fn(), sendTest: vi.fn() }));
import { Composer } from "@/components/compose/composer";
const base = { campaignId: null, templateId: null, templateName: "", name: "", senderId: "", audience: "all", isMarketing: false, subject: "Hi {{nme}}", html: "", text: "Hello [[date]]" };
const props = { initial: base, senders: [{ id: "s1", label: "me@x.dev · Gmail" }], lists: [{ id: "l1", name: "Flight", count: 3 }], variables: ["name", "email", "boarding_code"], aiEnabled: true, aiDailyLimit: 20, mockMode: false };
// Server-renders the composer (server actions mocked) to catch hook/render errors and check the live validation messages.
describe("Composer SSR", () => {
  it("renders live validation, variable chips and AI form", () => {
    const h = renderToString(<Composer {...props} />).replace(/<!-- -->/g, ""); // React inserts comment nodes between text fragments
    expect(h).toContain("{{boarding_code}}");
    expect(h).toContain("{{unsubscribe_url}}");
    expect(h).toContain("No contact has {{nme}}");            // unknown variable warned live
    expect(h).toContain("Replace the placeholder [[date]]");   // unresolved marker blocks
    expect(h).toContain("Write a draft");
    expect(h).toContain("Flight (3)");
  });
  it("shows honest setup state when AI is off, and blocks a deleted-list draft", () => {
    const h = renderToString(<Composer {...props} aiEnabled={false} initial={{ ...base, audience: "missing" }} mockMode />);
    expect(h).toContain("AI drafting isn&#x27;t configured");
    expect(h).toContain("The list for this draft was deleted");
    expect(h).toContain("mock provider is on");
  });
  it("asks for an unsubscribe link on marketing mail", () => {
    const h = renderToString(<Composer {...props} initial={{ ...base, isMarketing: true, subject: "s", html: "<p>hi</p>", text: "" }} />);
    expect(h).toContain("Marketing emails need an unsubscribe link");
  });
});
