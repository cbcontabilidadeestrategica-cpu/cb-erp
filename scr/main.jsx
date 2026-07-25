import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { supabase } from "./supabaseClient";
import App from "./App";
import Login from "./Login";

function Root() {
  const [sessao, setSessao] = useState(undefined); // undefined = carregando, null = deslogado

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessao(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (sessao === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B1B3F", color: "#fff", fontFamily: "sans-serif" }}>
        Carregando…
      </div>
    );
  }

  return sessao ? <App /> : <Login />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
