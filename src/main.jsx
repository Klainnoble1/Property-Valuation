import React from "react";
import { createRoot } from "react-dom/client";
import SaaSApp from "./SaaSApp.jsx";

window.storage ??= {
  async get(key) {
    const value = localStorage.getItem(key);
    return value == null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
  async delete(key) {
    localStorage.removeItem(key);
  },
  async list(prefix = "") {
    return {
      keys: Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    };
  },
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SaaSApp />
  </React.StrictMode>
);
