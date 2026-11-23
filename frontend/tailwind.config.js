/**
 * PdfModdy — red/white theme (the classic PDF palette).
 * Light single-theme. Colors are plain hex (one place to tweak).
 */

/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{html,js,svelte,ts}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: '#D32F2F', // PDF red
                    dark: '#B71C1C',
                    light: '#EF5350'
                },
                canvas: '#F4F4F5', // app background behind pages
                surface: '#FFFFFF', // panels / page sheets
                ink: '#1A1A1A', // primary text
                'ink-muted': '#6B7280', // secondary text
                hairline: '#E5E5E5' // borders / dividers
            },
            fontFamily: {
                sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
                cursive: ['"Segoe Script"', '"Brush Script MT"', 'cursive']
            }
        }
    },
    plugins: []
};
