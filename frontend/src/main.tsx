import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { InstallProvider } from "./components/InstallApp";
import { TooltipProvider } from "./components/ui";
import "./index.css";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider, useTheme } from "./lib/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Client errors won't fix themselves; only retry network and server failures.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

function Toasts() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      offset={{ bottom: 20, right: 20 }}
      mobileOffset={{ bottom: 76 }}
      toastOptions={{
        style: {
          background: "var(--surface-2)",
          border: "1px solid var(--line-strong)",
          color: "var(--ink)",
          borderRadius: 12,
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          boxShadow: "var(--shadow-pop)",
        },
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={250} skipDelayDuration={150}>
          <BrowserRouter>
            <AuthProvider>
              <InstallProvider>
                <App />
              </InstallProvider>
            </AuthProvider>
          </BrowserRouter>
          <Toasts />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
