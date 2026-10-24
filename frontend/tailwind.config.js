/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: { liquid: "28px" },
      backdropSaturate: { liquid: "210%" },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        pearl: {
          50: "#FAFBFD",
          100: "#F7F9FF",
          200: "#EEF2FA",
          300: "#E3E9F5",
          400: "#D3DDF0",
        },
        ice: {
          50: "#F5FAFF",
          100: "#EDF8FF",
          200: "#DDF3FF",
          300: "#CDEFFF",
          400: "#A8DFFF",
        },
        lavender: {
          50: "#F7F6FF",
          100: "#F0EEFF",
          200: "#E4E0FF",
          300: "#D9D2FF",
          400: "#B8ACFF",
        },
        aurora: {
          300: "#B8C7FF",
          400: "#9BB0FF",
          500: "#7C94FF",
          600: "#5E77F8",
          700: "#445BE5",
        },
        ink: {
          950: "#0D1728",
          900: "#15233D",
          800: "#223354",
          700: "#36486B",
          600: "#4A5873",
          500: "#6B7C99",
          400: "#91A0B8",
          300: "#B5C1D4",
        },
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(124, 148, 255, 0.12), 0 2px 8px 0 rgba(21, 35, 61, 0.05)",
        "glass-elevated": "0 20px 50px -10px rgba(124, 148, 255, 0.18), 0 8px 24px -4px rgba(21, 35, 61, 0.08)",
        "glass-sm": "0 2px 12px 0 rgba(124, 148, 255, 0.08)",
        "aurora-glow": "0 0 25px 2px rgba(124, 148, 255, 0.35)",
        "cyan-glow": "0 0 25px 2px rgba(56, 189, 248, 0.3)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
