import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon-32.png", "apple-touch-icon.png", "logo-mark.png"],
      manifest: {
        id: "/",
        name: "WealthOS",
        short_name: "WealthOS",
        description: "Track, analyze, plan and grow your investments. Check a trade before you make it.",
        lang: "en",
        categories: ["finance", "productivity"],
        theme_color: "#0b0d12",
        background_color: "#0b0d12",
        display: "standalone",
        start_url: "/",
        scope: "/",
        // Names this app as its own related app, which is what lets the page ask the browser
        // "is WealthOS installed on this device?" (see src/lib/install.ts).
        related_applications: [{ platform: "webapp", url: "/manifest.webmanifest" }],
        prefer_related_applications: false,
        // Offered when the installed app's icon is long-pressed or right-clicked.
        shortcuts: [
          { name: "Check a trade", url: "/lab/trade-check", icons: [{ src: "pwa-192.png", sizes: "192x192" }] },
          { name: "Market", url: "/market", icons: [{ src: "pwa-192.png", sizes: "192x192" }] },
          { name: "Transactions", url: "/transactions", icons: [{ src: "pwa-192.png", sizes: "192x192" }] },
        ],
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Only link previews fetch the share picture; the installed app never shows it.
        // config.js is the deployment's own answer, so it is always asked for fresh.
        globIgnores: ["og-image.png", "config.js"],
        // Offline, the installed app still needs to know how it was set up: fall back to the last answer.
        runtimeCaching: [{ urlPattern: /\/config\.js$/, handler: "NetworkFirst", options: { cacheName: "deployment-config", networkTimeoutSeconds: 4 } }],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Port 3000 matches Supabase's default Site URL, so email links land here.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split the big, rarely-changing libraries so app updates don't re-download them.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("echarts") || id.includes("zrender")) return "echarts";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@radix-ui") || id.includes("radix-ui") || id.includes("@floating-ui")) return "radix";
          if (id.includes("react-router") || id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "react";
          if (id.includes("@tanstack")) return "query";
        },
      },
    },
  },
});
