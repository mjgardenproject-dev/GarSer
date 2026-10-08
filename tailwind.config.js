import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Aparición solo con opacidad. `animate-in` de tailwindcss-animate anima también un
      // `transform`, y mientras dura, los paneles `fixed` de dentro (el pie del asistente) se
      // colocan respecto al contenedor y no a la pantalla.
      keyframes: {
        reveal: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        reveal: 'reveal 300ms ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
