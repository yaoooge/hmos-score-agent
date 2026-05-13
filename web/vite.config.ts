import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "/dashboard/",
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/dashboard": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
