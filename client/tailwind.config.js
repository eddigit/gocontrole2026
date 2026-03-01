/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        online: '#22c55e',
        'likely-online': '#84cc16',
        uncertain: '#eab308',
        'likely-offline': '#f97316',
        offline: '#ef4444',
      },
    },
  },
  plugins: [],
};
