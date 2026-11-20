import { describe, expect, it } from "vitest";
import { ProviderError, requireProviderMessageId } from "./types";

describe("requireProviderMessageId", () => {
  it("accepts a non-empty provider message ID", () => {
    expect(requireProviderMessageId({ id: "msg_123" }, "Resend")).toBe("msg_123");
  });

  it.each([null, {}, { id: "" }, { id: 123 }])("treats a missing or invalid ID as an unknown outcome (%o)", (response) => {
    let error: unknown;
    try {
      requireProviderMessageId(response, "Gmail");
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "unknown" });
  });
});
