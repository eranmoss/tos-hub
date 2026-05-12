/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#0D3B6E',
        accent: '#1A56A0',
        teal: '#0E7490',
        success: '#065F46',
        warning: '#92400E',
        danger: '#991B1B',
        'page-bg': '#F9FAFB',
        'card-bg': '#FFFFFF',
        'agent-bg': '#F8FAFC',
        'text-primary': '#111827',
        'text-secondary': '#6B7280',
        'border-default': '#E5E7EB',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '8px',
        btn: '6px',
        bubble: '20px',
      },
    },
  },
  plugins: [],
};
