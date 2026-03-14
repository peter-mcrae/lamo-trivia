import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      colors: {
        lamo: {
          primary: '#0071e3',
          blue: '#0071e3',
          'blue-dark': '#0056b3',
          lime: '#a8e000',
          'lime-light': '#c5f030',
          dark: '#1d1d1f',
          gray: '#424245',
          'gray-muted': '#86868b',
          'gray-light': '#6e6e73',
          border: '#d2d2d7',
          bg: '#f5f5f7',
          'bg-hero': '#fbfbfd',
          white: '#ffffff',
        },
      },
      borderRadius: {
        pill: '980px',
      },
      keyframes: {
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-lime': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(168, 224, 0, 0.4)' },
          '50%': { boxShadow: '0 0 0 12px rgba(168, 224, 0, 0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.6s ease-out',
        'pulse-lime': 'pulse-lime 2s ease-in-out infinite',
        shake: 'shake 0.5s ease-in-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
