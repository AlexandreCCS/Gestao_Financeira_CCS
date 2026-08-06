/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:   { 950:'#0b0f1a', 900:'#101728', 800:'#15203a', 700:'#1c2a4a' },
        prim:  { 500:'#10b981', 600:'#059669', 400:'#34d399' }, // verde finance
        acc:   { 500:'#f59e0b', 600:'#d97706' }                  // ambar para destaques
      }
    }
  },
  plugins: []
};
