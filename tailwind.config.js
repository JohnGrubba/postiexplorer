/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        void: "#070b14",
        panel: "#0d1424",
        panel2: "#111a2e",
        edge: "rgba(148,163,184,0.14)",
        neon: "#22d3ee",
        violet2: "#8b5cf6",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(34,211,238,0.25)",
        card: "0 8px 32px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
