import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getHost } from "./host";
import "./styles/app.css";

const root = createRoot(document.getElementById("root")!);
const host = getHost();

root.render(
  <StrictMode>
    {host ? (
      <App host={host} />
    ) : (
      <main className="welcome">
        <div className="welcome-card">
          <h1>LIKHA</h1>
          <p>This interface needs the LIKHA desktop host. Start it with npm run ide.</p>
        </div>
      </main>
    )}
  </StrictMode>
);
