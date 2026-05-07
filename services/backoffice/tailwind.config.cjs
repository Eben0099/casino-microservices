/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        title: ['Raleway', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        casino: {
          dark: '#0f172a',
          card: '#1e293b',
          accent: '#fbbf24',
        }
      }
    },
  },
  plugins: [],
}
