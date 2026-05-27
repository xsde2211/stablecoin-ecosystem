// Design tokens — single source of truth for colors, spacing, fonts.
// Import this in any app that uses the design system.

export const colors = {
  teal: {
    50:  '#e6f3ef',
    100: '#b3ddd3',
    500: '#1a9070',
    600: '#0d6e54',
    700: '#095c45',
  },
  amber: {
    50:  '#fef3dc',
    500: '#d97706',
    600: '#9a6200',
  },
  gray: {
    50:  '#f7f6f3',
    100: '#f0efe9',
    200: '#e5e3dc',
    400: '#9e9c96',
    600: '#6b6961',
    900: '#1a1916',
  },
  red: {
    50:  '#fdecea',
    500: '#e53e3e',
    600: '#c0392b',
  },
} as const;

export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
} as const;

export const fontSizes = {
  xs:   '11px',
  sm:   '12px',
  base: '14px',
  md:   '15px',
  lg:   '16px',
  xl:   '18px',
  '2xl':'22px',
  '3xl':'28px',
  '4xl':'36px',
} as const;

export const borderRadius = {
  sm:   '6px',
  md:   '10px',
  lg:   '14px',
  full: '9999px',
} as const;