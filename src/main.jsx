import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Login from "./Login.jsx";
import { supabase } from "./supabaseClient.js";

function Root() {
  // undefined = ainda carregando a sessão inicial
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    // Verifica sessão atual ao montar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
    });

    // Observa mudanças de autenticação (login / logout)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Aguarda resolução da sessão antes de renderizar
  if (session === undefined) return null;

  return session ? <App /> : <Login />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
