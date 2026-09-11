import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
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
          primary: '#234ee8',
          blue: '#234ee8',
          'blue-dark': '#163bc2',
          lime: '#dbe8ff',
          'lime-light': '#edf3ff',
          dark: '#102342',
          gray: '#344b67',
          'gray-muted': '#52657e',
          'gray-light': '#52657e',
          border: '#d8e2ee',
          bg: '#edf3fb',
          'bg-hero': '#f5f8fc',
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
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(35, 78, 232, 0.4)' },
          '50%': { boxShadow: '0 0 0 12px rgba(35, 78, 232, 0)' },
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
