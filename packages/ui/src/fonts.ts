/**
 * Approved web-font acquisition: IBM Plex faces via @fontsource packages
 * (upstream IBM Plex, OFL-1.1) resolved by the bundler — no font binaries are
 * copied from the planning package or the OS, and no font is fetched from a
 * remote CDN at runtime.
 *
 * Subset-scoped imports keep the payload to what the product renders:
 *   IBM Plex Sans        — Latin UI text, weights 400/500/600
 *   IBM Plex Sans Arabic — Arabic UI text, weights 400/500/600
 *   IBM Plex Mono        — Latin source IDs / formulas only, weights 400/500/600
 *
 * `font-display: swap` (fontsource default) shows a metric-compatible fallback
 * while woff2 loads; files are emitted as local hashed build assets.
 *
 * The app entry imports this once: `import "@rowfolio/ui/fonts";`
 */
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
