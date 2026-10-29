import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import { StoreProvider } from "./lib/store";
import NewAnalysis from "./pages/NewAnalysis";
import Dashboard from "./pages/Dashboard";
import Competitors from "./pages/Competitors";
import ContentStudio from "./pages/ContentStudio";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<NewAnalysis />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="competitors" element={<Competitors />} />
            <Route path="studio" element={<ContentStudio />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </React.StrictMode>,
);
