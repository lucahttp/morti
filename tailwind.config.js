/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'brand-dark': '#0b0f19',
                'brand-card': '#101623',
                'brand-blue': '#0077bb',
                'brand-teal': '#009988',
                'brand-green': '#33e38a',
                'brand-orange': '#ee7733',
                'brand-purple': '#cc33d9',
                'brand-pink': '#ee3377',
            },
            fontFamily: {
                'sans': ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
                'mono': ['"Fira Code"', 'monospace'],
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }
        },
    },
    plugins: [],
}
