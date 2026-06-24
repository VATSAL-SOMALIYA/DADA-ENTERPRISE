/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/views/**/*.ejs"],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: 'var(--primary)',
        'primary-fg': 'var(--primary-foreground)',
        secondary: 'var(--secondary)',
        muted: 'var(--muted)',
        'muted-fg': 'var(--muted-foreground)',
        accent: 'var(--accent)',
        input: 'var(--input-background)',
        border: 'var(--border)'
      },
      borderRadius: {
        DEFAULT: 'var(--radius)'
      }
    },
  },
  plugins: [],
}
