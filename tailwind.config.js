/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./static/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        'op-read': {
          DEFAULT: '#0284c7',
          light: '#38bdf8',
          dark: '#0369a1',
          bg: 'rgba(56, 189, 248, 0.12)',
          border: 'rgba(56, 189, 248, 0.35)',
        },
        'op-write': {
          DEFAULT: '#d97706',
          light: '#f59e0b',
          dark: '#b45309',
          bg: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.35)',
        },
        'op-commit': {
          DEFAULT: '#059669',
          light: '#10b981',
          dark: '#047857',
          bg: 'rgba(16, 185, 129, 0.12)',
          border: 'rgba(16, 185, 129, 0.35)',
        },
        'op-rollback': {
          DEFAULT: '#e11d48',
          light: '#f43f5e',
          dark: '#be123c',
          bg: 'rgba(244, 63, 94, 0.12)',
          border: 'rgba(244, 63, 94, 0.35)',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
