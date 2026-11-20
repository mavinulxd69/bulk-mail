"use client";
import { useState } from "react";
const rows = [{ name: "Alex", code: "BD101" }, { name: "John", code: "BD102" }, { name: "David", code: "BD103" }];
export function PersonalizeDemo() {
  const [i, setI] = useState(0);
  const r = rows[i]!;
  return (
    <div className="rounded-2xl p-2 airmail shadow-xl">
      <div className="rounded-xl bg-white p-6 text-ink">
        <div role="tablist" aria-label="Recipient" className="mb-5 flex gap-2">
          {rows.map((x, n) => (
            <button key={x.code} role="tab" aria-selected={n === i} onClick={() => setI(n)}
              className={`rounded-full px-3 py-1 text-sm ${n === i ? "bg-ink text-white" : "bg-mist hover:bg-sky"}`}>{x.name}</button>
          ))}
        </div>
        <p className="text-xs text-ink/60">To: {r.name.toLowerCase()}@example.com (only this recipient)</p>
        <p className="mt-1 font-display text-lg font-semibold">Your Boarding Confirmation - {r.name}</p>
        <div className="mt-4 space-y-2 text-sm leading-relaxed">
          <p>Hello {r.name},</p><p>Your boarding details are ready.</p>
          <p>Your boarding code is: <b className="rounded bg-sky px-1.5 py-0.5">{r.code}</b></p><p>Thank you.</p>
        </div>
      </div>
    </div>
  );
}
