import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#08090e",
        foreground: "#e6e7ec",
        muted: "rgba(230, 231, 236, 0.6)",
        border: "rgba(255, 255, 255, 0.08)",
        accent: {
          DEFAULT: "#6366f1",
          foreground: "#ffffff",
        },
        success: "#22c55e",
        warning: "#f59e0b",
        card: {
          DEFAULT: "rgba(255, 255, 255, 0.03)",
          foreground: "#e6e7ec",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      maxWidth: {
        content: "1200px",
      },
    },
  },
  plugins: [],
};

export default config;
