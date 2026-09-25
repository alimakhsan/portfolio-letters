import { defineConfig } from 'vite'

// Served under ahmadalim.com/quran. `base` rebases the bundled JS/CSS and the
// HTML src/href attributes; the build output goes to the repo-root `quran/`
// folder (this app lives at apps/quran/ inside the portfolio repo), which
// Netlify publishes as-is.
export default defineConfig({
  base: '/quran/',
  build: {
    outDir: '../../quran',
    emptyOutDir: true,
  },
})
