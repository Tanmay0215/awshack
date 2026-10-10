import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { ink: '#16201a', moss: '#2f4a38', paper: '#efeadd', sheet: '#f8f5ec', rust: '#b4491f', lime: '#c6e03a' },
      fontFamily: {
        display: ['"Arial Narrow"', 'Impact', 'Haettenschweiler', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
