/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:      '#14120F',
        panel:    '#1E1B16',
        panel2:   '#26221B',
        hairline: '#3A342A',
        gold:     '#C9A24B',
        goldDim:  '#8A7238',
        silver:   '#B8C0C8',
        silverDim:'#7C8590',
        saffron:  '#E08D3C',
        live:     '#6FCF97',
        down:     '#E0685C',
        ivory:    '#F2EDE4',
        muted:    '#9C948A',
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        body:    ['"Inter"', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(242,237,228,0.04) inset, 0 12px 30px -12px rgba(0,0,0,0.55)',
      },
      keyframes: {
        pulseLive: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        flashUpdate: {
          '0%':   { backgroundColor: 'rgba(201,162,75,0.18)' },
          '100%': { backgroundColor: 'rgba(201,162,75,0)' },
        },
      },
      animation: {
        pulseLive: 'pulseLive 1.8s ease-in-out infinite',
        flashUpdate: 'flashUpdate 900ms ease-out',
      },
    },
  },
  plugins: [],
};
