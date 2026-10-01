import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Offline app-shell cache (see public/sw.js) - lets the Client open the real
// app even when the Main Server is unreachable at launch, as long as this
// device has loaded the app at least once before. Never touches /api/*.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.info('[BalajiFeeHub] Offline app-shell cache: active'))
      .catch((e) => console.warn('[BalajiFeeHub] Offline app-shell cache: registration failed', e));
  });
} else {
  // Chromium only exposes Service Worker on a "secure context" - localhost/
  // 127.0.0.1 or https. A plain http://<LAN IP> origin (the normal case for
  // a real Client PC talking to the Main Server) does NOT qualify, so this
  // branch is expected to fire there - logged so it's visible in diagnostics
  // instead of silently doing nothing.
  console.warn('[BalajiFeeHub] Offline app-shell cache: NOT available on this origin (not a secure context).');
}
