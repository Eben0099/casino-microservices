/** @type {import('tailwindcss').Config} */
module.exports = {
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
          dark: '#0f172a',    // Bleu nuit très profond
          card: '#1e293b',    // Couleur des cartes/panneaux
          accent: '#fbbf24',  // Or élégant pour les éléments importants
        }
      }
    },
  },
  plugins: [],
}
