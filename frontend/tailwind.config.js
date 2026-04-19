/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        ink: '#0B0B0C',
        muted: '#555555',
        page: '#FFFFFF',
        soft: '#FAFAFA',
        line: 'rgba(0,0,0,0.08)',
        ember: '#FF6F00',
        flame: '#FF8A00',
        glow: '#FFB74D',
        sunrise: '#FFF3E0',
        nvidia: '#76B900',
      },
      backgroundImage: {
        'molten': 'linear-gradient(135deg, #FF6F00 0%, #FF8A00 100%)',
        'molten-soft': 'linear-gradient(135deg, rgba(255,111,0,0.08) 0%, rgba(255,138,0,0.04) 100%)',
      },
    },
  },
  plugins: [],
};
