/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
      colors: {
        ink: { DEFAULT: "#1F1D3D", soft: "#5A587A", faint: "#8E8CA8" },
        brand: { DEFAULT: "#5458E8", dark: "#3E41C9", tint: "#EEEEFD" },
        violet: { DEFAULT: "#B44BD8" },
        rival: { DEFAULT: "#14B8A6", tint: "#E3F7F4" },
        line: "#E6E6F0",
        canvas: "#F7F8FC",
        good: "#16A34A", warn: "#E59A0B", bad: "#E0465B",
      },
      boxShadow: { card: "0 1px 2px rgba(31,29,61,.05), 0 8px 24px -12px rgba(31,29,61,.12)" },
    },
  },
  plugins: [],
};
