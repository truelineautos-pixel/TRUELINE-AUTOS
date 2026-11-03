/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        soft: '0 18px 40px rgba(15, 23, 42, 0.32)',
      },
      colors: {
        showroom: {
          950: '#020817',
          900: '#0f172a',
          800: '#162033',
          accent: '#f59e0b',
          glow: '#60a5fa',
        },
      },
    },
  },
  plugins: [],
};
