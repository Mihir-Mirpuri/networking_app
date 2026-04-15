import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary palette - purple/violet for brand & navigation
        primary: {
          50: '#f0edff',
          100: '#e0dbff',
          200: '#c4b5fe',
          300: '#a78bfa',
          400: '#8b5cf6',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4c1d95',
          900: '#3b0f7a',
          950: '#1e0a3e',
        },
        // Accent colors — driven by CSS custom properties for subscription theming
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          tint: 'var(--accent-tint)',
          border: 'var(--accent-border)',
          text: 'var(--accent-text)',
          badge: 'var(--accent-badge-bg)',
        },
        // Dark theme surface palette - neutral gray
        surface: {
          50: '#111111',   // Main background
          100: '#1a1a1a',  // Card backgrounds
          200: '#252525',  // Borders
          300: '#303030',  // Elevated surfaces
          400: '#b0b0b0',  // Muted text
          500: '#d0d0d0',  // Medium text
          600: '#e8e8e8',  // Secondary text
          700: '#f0f0f0',  // Body text
          800: '#ffffff',  // Strong text
          900: '#ffffff',  // Headings
        },
      },
      boxShadow: {
        'soft': '0 0 1px rgba(0,0,0,0.3), 0 0 20px -5px rgba(0,0,0,0.15)',
        'soft-lg': '0 0 1px rgba(0,0,0,0.4), 0 0 30px -5px rgba(0,0,0,0.2)',
        'soft-xl': '0 0 1px rgba(0,0,0,0.5), 0 0 40px -5px rgba(0,0,0,0.25)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.2)',
        'glow': '0 0 20px -5px rgba(0, 0, 0, 0.4)',
        'glow-lg': '0 0 40px -10px rgba(0, 0, 0, 0.5)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-subtle': 'linear-gradient(135deg, var(--tw-gradient-stops))',
        'shimmer': 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-in-up': 'fade-in-up 0.3s ease-out both',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'slide-panel-in': 'slide-panel-in 0.3s cubic-bezier(0.32, 0.72, 0, 1) both',
        'scale-in': 'scale-in 0.2s ease-out',
        'shimmer': 'shimmer 2s infinite',
        'pulse-soft': 'pulse-soft 2s infinite',
        'bounce-dot': 'bounce-dot 1.4s ease-in-out infinite',
        'ripple': 'ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite',
        'bookmark-pop': 'bookmark-pop 0.35s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-panel-in': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'scale(0.4)', opacity: '0.3' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        'ripple': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        'bookmark-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.35)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      transitionTimingFunction: {
        'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};

export default config;
