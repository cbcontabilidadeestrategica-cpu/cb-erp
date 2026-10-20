import React, { useState } from "react";
import { supabase } from "./supabaseClient";

const NAVY = "#0B1B3F", GOLD = "#C9974B", GOLD_LIGHT = "#DDB06B";

export default function Login() {
  const [modo, setModo] = useState("entrar"); // "entrar" | "cadastrar"
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setMensagem("");
    setCarregando(true);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password: senha });
        if (error) throw error;
        setMensagem("Conta criada. Verifique seu e-mail para confirmar o acesso (se a confirmação estiver ativada no Supabase), ou já tente entrar.");
      }
    } catch (err) {
      setMensagem(err.message || "Não foi possível autenticar. Confira e-mail e senha.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logoMark}>CB</div>
        <h1 style={styles.title}>CB Contabilidade Estratégica</h1>
        <p style={styles.subtitle}>CB HUB — acesso da equipe</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="email" required placeholder="E-mail" value={email}
            onChange={(e) => setEmail(e.target.value)} style={styles.input}
          />
          <input
            type="password" required placeholder="Senha" value={senha}
            onChange={(e) => setSenha(e.target.value)} style={styles.input}
          />
          <button type="submit" disabled={carregando} style={styles.btn}>
            {carregando ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        {mensagem && <p style={styles.mensagem}>{mensagem}</p>}

        <button
          style={styles.linkBtn}
          onClick={() => { setModo(modo === "entrar" ? "cadastrar" : "entrar"); setMensagem(""); }}
        >
          {modo === "entrar" ? "Ainda não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: NAVY, fontFamily: "'Inter', system-ui, sans-serif", padding: 20,
  },
  card: {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 16, padding: "36px 32px", width: 360, textAlign: "center",
  },
  logoMark: {
    width: 48, height: 48, borderRadius: 12, margin: "0 auto 16px",
    background: `linear-gradient(135deg, ${GOLD}, ${GOLD_LIGHT})`, color: NAVY,
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16,
  },
  title: { color: "#fff", fontSize: 17, fontWeight: 700, margin: "0 0 4px 0" },
  subtitle: { color: "#9AA3C4", fontSize: 12.5, margin: "0 0 24px 0" },
  form: { display: "flex", flexDirection: "column", gap: 10 },
  input: {
    padding: "11px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14,
  },
  btn: {
    marginTop: 4, background: GOLD, color: NAVY, border: "none", padding: "11px 12px",
    borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
  },
  mensagem: { color: "#DDB06B", fontSize: 12.5, marginTop: 14, lineHeight: 1.4 },
  linkBtn: { marginTop: 18, background: "transparent", border: "none", color: "#9AA3C4", fontSize: 12.5, cursor: "pointer", textDecoration: "underline" },
};
