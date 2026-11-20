import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: { extend: {
    colors: { ink: "#0E1B3D", sky: "#DCE8FF", post: "#E5484D", paper: "#FBFCFE", mist: "#EEF2F9" },
    fontFamily: { display: ["var(--font-display)", "system-ui"], sans: ["var(--font-body)", "system-ui"] },
  } },
  plugins: [],
} satisfies Config;
