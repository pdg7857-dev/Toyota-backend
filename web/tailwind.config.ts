import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand-bias palette — Toyota red and Lexus charcoal anchor the
        // featured-brand visual treatment.
        toyota: { DEFAULT: "#EB0A1E", dark: "#A30713" },
        lexus:  { DEFAULT: "#1A1A1A", accent: "#B69A6F" },
        ink:    { 900: "#0f1116", 800: "#1a1d24", 700: "#262a33" },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
