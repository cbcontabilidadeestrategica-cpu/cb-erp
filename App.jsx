import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { storage } from "./storage";
import { supabase } from "./supabaseClient";

const PLANO_CONTAS_PADRAO = {
  RECEITAS: [
    "Receita com Vendas (Salão/Balcão)",
    "Vendas para Parceiros (iFood, Rappi, Uber etc.)",
    "Vendas com VR/VA",
    "Outras Entradas de Receitas",
  ],
  "DEDUÇÕES DE RECEITA": [
    "Cancelamentos/Devoluções", "Simples Nacional (DAS)", "Taxa Operadora de Cartão",
    "Taxa Boleto", "Taxa de Aplicativos",
  ],
  "CMO – CUSTO DE MÃO DE OBRA": [
    "Salários", "INSS/FGTS", "Pró-labore", "Encargos sobre Pró-labore",
    "Benefícios/Treinamentos", "Provisão de 13º", "Provisão de Férias + 1/3",
    "Provisão de Rescisões", "Vale Transporte/Alimentação", "Uniformes", "Mensalidades Sindicais",
  ],
  "CUSTOS VARIÁVEIS (CMV/CSP)": [
    "Fornecedores de Insumos", "Fornecedores para Revenda", "Embalagens", "DIFAL",
    "Deslocamentos/Frete", "Combustível Delivery", "Serviços de Terceiros Variáveis", "Outras Despesas Variáveis",
  ],
  "DESPESAS FIXAS": [
    "Aluguel/Despesas Prediais", "Água, Energia e Gás", "Internet e Telefonia", "Software/Licenças",
    "Seguros", "Manutenções Prediais", "Manutenção de Máquinas", "Manutenção de Veículos",
    "Materiais de Consumo", "Material de Limpeza",
  ],
  "ADMINISTRATIVO E COMERCIAL": [
    "Honorários Contábeis", "Agência de Marketing (fixo)", "Propaganda e Marketing",
    "Serviços de Terceiros Fixos", "Tarifas Bancárias", "Impostos e Taxas",
  ],
  "INVESTIMENTOS (CAPEX)": [
    "Edifícios e Instalações", "Reformas", "Máquinas e Equipamentos", "Móveis e Utensílios",
    "Veículos", "Tecnologia/Sistemas", "Consultoria Estratégica", "Marketing de Expansão", "Fundo de Reserva",
  ],
  "FINANCIAMENTOS / AMORTIZAÇÃO": [
    "Empréstimos Bancários – Amortização", "Empréstimos Bancários – Juros", "Parcelamentos Tributários",
    "Antecipação de Recebíveis (taxa)", "Financiamento de Cartões", "Empréstimos Concedidos",
  ],
  "REMUNERAÇÃO DOS SÓCIOS": ["Distribuição de Lucros (por sócio)"],
};

const CATS_SAIDA_DFC = [
  "CUSTOS VARIÁVEIS (CMV/CSP)", "CMO – CUSTO DE MÃO DE OBRA", "DESPESAS FIXAS",
  "ADMINISTRATIVO E COMERCIAL", "FINANCIAMENTOS / AMORTIZAÇÃO", "INVESTIMENTOS (CAPEX)", "REMUNERAÇÃO DOS SÓCIOS",
];

const FORMAS_PADRAO = [
  { nome: "Dinheiro", tipo: "avista" }, { nome: "Pix", tipo: "avista" },
  { nome: "Cartão de Débito", tipo: "avista" }, { nome: "Cartão de Crédito", tipo: "aprazo" },
  { nome: "Vale Refeição", tipo: "aprazo" }, { nome: "Boleto", tipo: "aprazo" },
];

const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const REGIMES = ["Simples Nacional", "Lucro Presumido", "Lucro Real"];

const fmt = (n) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function parseCsv(text) {
  const linhas = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length < 2) return [];
  const delim = linhas[0].includes(";") ? ";" : ",";
  const header = linhas[0].split(delim).map((h) => h.trim().toLowerCase());
  const idx = (nomes) => header.findIndex((h) => nomes.some((n) => h.includes(n)));
  const iData = idx(["data"]);
  const iDesc = idx(["descri", "hist", "memo"]);
  const iValor = idx(["valor", "montante"]);
  const iForma = idx(["forma", "meio"]);
  const iConta = idx(["conta"]);
  const iBanco = idx(["banco"]);
  return linhas.slice(1).map((linha) => {
    const cols = linha.split(delim).map((c) => c.trim());
    const rawData = cols[iData] || "";
    let data = "";
    if (/^\d{4}-\d{2}-\d{2}/.test(rawData)) data = rawData.slice(0, 10);
    else if (/^\d{2}\/\d{2}\/\d{4}/.test(rawData)) {
      const [d, m, y] = rawData.split("/");
      data = `${y}-${m}-${d}`;
    }
    const valorRaw = (cols[iValor] || "0").replace(/\./g, "").replace(",", ".");
    const valor = parseFloat(valorRaw) || 0;
    return {
      fitid: uid(), data, valor,
      memo: cols[iDesc] || "(sem descrição)",
      formaSugerida: iForma >= 0 ? cols[iForma] : "",
      contaSugerida: iConta >= 0 ? cols[iConta] : "",
      bancoSugerido: iBanco >= 0 ? cols[iBanco] : "",
      tipo: valor >= 0 ? "entrada" : "saida",
    };
  }).filter((t) => t.data);
}

function parseOfx(text) {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  return blocks.map((b) => {
    const seg = b.split(/<\/STMTTRN>/i)[0];
    const get = (tag) => {
      const m = seg.match(new RegExp(`<${tag}>([^<\r\n]+)`, "i"));
      return m ? m[1].trim() : "";
    };
    const rawDate = get("DTPOSTED");
    let data = "";
    if (rawDate.length >= 8) data = `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`;
    const valor = parseFloat(get("TRNAMT") || "0");
    const memo = get("MEMO") || get("NAME") || "(sem descrição)";
    const fitid = get("FITID") || uid();
    return { fitid, data, valor, memo, tipo: valor >= 0 ? "entrada" : "saida" };
  }).filter((t) => t.data);
}

const CLIENTE_EXEMPLO_LANCAMENTOS = [
  { id: uid(), data: "2026-01-05", mes: 1, descricao: "Vendas no cartão de crédito", forma: "Cartão de Crédito", conta: "Receita com Vendas (Salão/Balcão)", banco: "Banco Principal", valor: 130634.47 },
  { id: uid(), data: "2026-01-05", mes: 1, descricao: "Vendas no cartão de débito", forma: "Cartão de Débito", conta: "Receita com Vendas (Salão/Balcão)", banco: "Banco Principal", valor: 82799.56 },
  { id: uid(), data: "2026-01-05", mes: 1, descricao: "Vendas em dinheiro", forma: "Dinheiro", conta: "Receita com Vendas (Salão/Balcão)", banco: "Banco Principal", valor: 14219.30 },
  { id: uid(), data: "2026-01-05", mes: 1, descricao: "Vendas via Pix", forma: "Pix", conta: "Receita com Vendas (Salão/Balcão)", banco: "Banco Principal", valor: 41513.60 },
  { id: uid(), data: "2026-01-05", mes: 1, descricao: "Vendas com Vale Refeição", forma: "Vale Refeição", conta: "Receita com Vendas (Salão/Balcão)", banco: "Banco Principal", valor: 13477.03 },
  { id: uid(), data: "2026-01-05", mes: 1, descricao: "Vendas via apps de delivery", forma: "Pix", conta: "Vendas para Parceiros (iFood, Rappi, Uber etc.)", banco: "Banco Principal", valor: 1364.20 },
  { id: uid(), data: "2026-01-31", mes: 1, descricao: "Taxa da operadora de cartão", forma: "Cartão de Débito", conta: "Taxa Operadora de Cartão", banco: "Banco Principal", valor: 5367.48 },
  { id: uid(), data: "2026-01-31", mes: 1, descricao: "Folha de pagamento", forma: "Pix", conta: "Salários", banco: "Banco Principal", valor: 1978.50 },
  { id: uid(), data: "2026-01-31", mes: 1, descricao: "Compra de embalagens", forma: "Boleto", conta: "Embalagens", banco: "Banco Principal", valor: 495.00 },
];

const MODULOS_SIDEBAR = [
  { id: "financeiro", label: "Financeiro", disponivel: true },
  { id: "estoque", label: "Estoque", disponivel: true },
  { id: "precificacao", label: "Precificação", disponivel: false },
];

export default function App() {
  const [carregando, setCarregando] = useState(true);
  const [erroStorage, setErroStorage] = useState("");
  const [clientes, setClientes] = useState([]);
  const [clienteAtivoId, setClienteAtivoId] = useState(null);
  const [mostrarNovoCliente, setMostrarNovoCliente] = useState(false);

  const [planoContas, setPlanoContas] = useState(PLANO_CONTAS_PADRAO);
  const [formasPagamento, setFormasPagamento] = useState(FORMAS_PADRAO);
  const [bancos, setBancos] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [titulos, setTitulos] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [movEstoque, setMovEstoque] = useState([]);
  const [carregandoCliente, setCarregandoCliente] = useState(false);

  const [aba, setAba] = useState("lancamentos");
  const [moduloAtivo, setModuloAtivo] = useState("financeiro");
  const [subDemonstrativo, setSubDemonstrativo] = useState("dfc");
  const [mesFiltro, setMesFiltro] = useState(1);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ data: "2026-01-15", descricao: "", forma: "", conta: "", banco: "", valor: "" });

  const fileRef = useRef(null);
  const [ofxPreview, setOfxPreview] = useState([]);
  const [ofxErro, setOfxErro] = useState("");
  const csvFileRef = useRef(null);
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvErro, setCsvErro] = useState("");

  // ---------- carregar lista de clientes (compartilhada com a equipe) ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("clientes", true);
        const lista = res ? JSON.parse(res.value) : [];
        if (lista.length === 0) {
          const exemplo = { id: uid(), nome: "Dromedários", cnpj: "", regime: "Simples Nacional", cidade: "", obs: "" };
          await storage.set("clientes", JSON.stringify([exemplo]), true);
          await storage.set(`cliente:${exemplo.id}:config`, JSON.stringify({
            planoContas: PLANO_CONTAS_PADRAO, formasPagamento: FORMAS_PADRAO,
            bancos: [{ nome: "Banco Principal", instituicao: "Banco do Brasil", conta: "12345-6" }],
          }), true);
          await storage.set(`cliente:${exemplo.id}:lancamentos`, JSON.stringify(CLIENTE_EXEMPLO_LANCAMENTOS), true);
          setClientes([exemplo]);
          setClienteAtivoId(exemplo.id);
        } else {
          setClientes(lista);
          setClienteAtivoId(lista[0].id);
        }
      } catch (e) {
        setErroStorage("Não foi possível carregar os dados salvos. Tente recarregar.");
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  // ---------- carregar dados do cliente ativo ----------
  useEffect(() => {
    if (!clienteAtivoId) return;
    (async () => {
      setCarregandoCliente(true);
      try {
        let config = { planoContas: PLANO_CONTAS_PADRAO, formasPagamento: FORMAS_PADRAO, bancos: [] };
        try {
          const r = await storage.get(`cliente:${clienteAtivoId}:config`, true);
          if (r) config = JSON.parse(r.value);
        } catch { /* cliente novo, usa padrão */ }
        let lancs = [];
        try {
          const r2 = await storage.get(`cliente:${clienteAtivoId}:lancamentos`, true);
          if (r2) lancs = JSON.parse(r2.value);
        } catch { /* sem lançamentos ainda */ }
        let tits = [];
        try {
          const r3 = await storage.get(`cliente:${clienteAtivoId}:titulos`, true);
          if (r3) tits = JSON.parse(r3.value);
        } catch { /* sem títulos ainda */ }
        let estoqueData = { produtos: [], movimentos: [] };
        try {
          const r4 = await storage.get(`cliente:${clienteAtivoId}:estoque`, true);
          if (r4) estoqueData = JSON.parse(r4.value);
        } catch { /* sem estoque ainda */ }
        setPlanoContas(config.planoContas || PLANO_CONTAS_PADRAO);
        setFormasPagamento(config.formasPagamento || FORMAS_PADRAO);
        setBancos(config.bancos || []);
        setLancamentos(lancs);
        setTitulos(tits);
        setProdutos(estoqueData.produtos || []);
        setMovEstoque(estoqueData.movimentos || []);
        setForm((f) => ({
          ...f,
          forma: (config.formasPagamento || FORMAS_PADRAO)[0]?.nome || "",
          conta: Object.values(config.planoContas || PLANO_CONTAS_PADRAO)[0][0],
          banco: (config.bancos || [])[0]?.nome || "",
        }));
        setEditingId(null);
      } catch (e) {
        setErroStorage("Erro ao carregar dados do cliente.");
      } finally {
        setCarregandoCliente(false);
      }
    })();
  }, [clienteAtivoId]);

  const salvarConfig = useCallback(async (novoPlano, novasFormas, novosBancos) => {
    try {
      await storage.set(`cliente:${clienteAtivoId}:config`, JSON.stringify({
        planoContas: novoPlano, formasPagamento: novasFormas, bancos: novosBancos,
      }), true);
    } catch (e) { setErroStorage("Falha ao salvar configuração — tente novamente."); }
  }, [clienteAtivoId]);

  const salvarLancamentos = useCallback(async (novos) => {
    try {
      await storage.set(`cliente:${clienteAtivoId}:lancamentos`, JSON.stringify(novos), true);
    } catch (e) { setErroStorage("Falha ao salvar lançamentos — tente novamente."); }
  }, [clienteAtivoId]);

  const salvarTitulos = useCallback(async (novos) => {
    try {
      await storage.set(`cliente:${clienteAtivoId}:titulos`, JSON.stringify(novos), true);
    } catch (e) { setErroStorage("Falha ao salvar títulos — tente novamente."); }
  }, [clienteAtivoId]);

  const salvarEstoque = useCallback(async (novosProdutos, novosMovimentos) => {
    try {
      await storage.set(`cliente:${clienteAtivoId}:estoque`, JSON.stringify({
        produtos: novosProdutos, movimentos: novosMovimentos,
      }), true);
    } catch (e) { setErroStorage("Falha ao salvar estoque — tente novamente."); }
  }, [clienteAtivoId]);

  const categoriaPorConta = useMemo(() => {
    const map = {};
    Object.entries(planoContas).forEach(([cat, contas]) => contas.forEach((c) => (map[c] = cat)));
    return map;
  }, [planoContas]);
  const tipoPorForma = useMemo(() => {
    const map = {};
    formasPagamento.forEach((f) => (map[f.nome] = f.tipo));
    return map;
  }, [formasPagamento]);

  function criarCliente(nome, cnpj, regime, cidade, obs) {
    if (!nome.trim()) return;
    (async () => {
      const novo = { id: uid(), nome: nome.trim(), cnpj, regime, cidade, obs };
      const novaLista = [...clientes, novo];
      setClientes(novaLista);
      await storage.set("clientes", JSON.stringify(novaLista), true);
      await storage.set(`cliente:${novo.id}:config`, JSON.stringify({
        planoContas: PLANO_CONTAS_PADRAO, formasPagamento: FORMAS_PADRAO, bancos: [],
      }), true);
      await storage.set(`cliente:${novo.id}:lancamentos`, JSON.stringify([]), true);
      setClienteAtivoId(novo.id);
      setMostrarNovoCliente(false);
    })();
  }

  function removerCliente(id) {
    (async () => {
      const novaLista = clientes.filter((c) => c.id !== id);
      setClientes(novaLista);
      await storage.set("clientes", JSON.stringify(novaLista), true);
      if (clienteAtivoId === id) setClienteAtivoId(novaLista[0]?.id || null);
    })();
  }

  function salvarLancamento(e) {
    e.preventDefault();
    if (!form.valor || isNaN(parseFloat(form.valor))) return;
    const mes = new Date(form.data + "T00:00:00").getMonth() + 1;
    let novos;
    if (editingId) {
      novos = lancamentos.map((l) => l.id === editingId ? { ...l, ...form, mes, valor: parseFloat(form.valor) } : l);
      setEditingId(null);
    } else {
      novos = [...lancamentos, { id: uid(), ...form, mes, valor: parseFloat(form.valor) }];
    }
    setLancamentos(novos);
    salvarLancamentos(novos);
    setForm((f) => ({ ...f, descricao: "", valor: "" }));
  }
  function editarLancamento(l) {
    setEditingId(l.id);
    setForm({ data: l.data, descricao: l.descricao, forma: l.forma, conta: l.conta, banco: l.banco, valor: String(l.valor) });
    setAba("lancamentos");
  }
  function removerLancamento(id) {
    const novos = lancamentos.filter((l) => l.id !== id);
    setLancamentos(novos);
    salvarLancamentos(novos);
    if (editingId === id) setEditingId(null);
  }

  function addConta(cat, nome) {
    if (!nome.trim()) return;
    const novo = { ...planoContas, [cat]: [...planoContas[cat], nome.trim()] };
    setPlanoContas(novo);
    salvarConfig(novo, formasPagamento, bancos);
  }
  function removerConta(cat, nome) {
    const novo = { ...planoContas, [cat]: planoContas[cat].filter((c) => c !== nome) };
    setPlanoContas(novo);
    salvarConfig(novo, formasPagamento, bancos);
  }
  function addCategoria(nome) {
    if (!nome.trim() || planoContas[nome]) return;
    const novo = { ...planoContas, [nome.trim()]: [] };
    setPlanoContas(novo);
    salvarConfig(novo, formasPagamento, bancos);
  }
  function addForma(nome, tipo) {
    if (!nome.trim() || formasPagamento.some((f) => f.nome === nome.trim())) return;
    const novo = [...formasPagamento, { nome: nome.trim(), tipo }];
    setFormasPagamento(novo);
    salvarConfig(planoContas, novo, bancos);
  }
  function toggleTipoForma(nome) {
    const novo = formasPagamento.map((f) => f.nome === nome ? { ...f, tipo: f.tipo === "avista" ? "aprazo" : "avista" } : f);
    setFormasPagamento(novo);
    salvarConfig(planoContas, novo, bancos);
  }
  function removerForma(nome) {
    const novo = formasPagamento.filter((f) => f.nome !== nome);
    setFormasPagamento(novo);
    salvarConfig(planoContas, novo, bancos);
  }
  function addBanco(nome, instituicao, conta) {
    if (!nome.trim()) return;
    const novo = [...bancos, { nome: nome.trim(), instituicao, conta }];
    setBancos(novo);
    salvarConfig(planoContas, formasPagamento, novo);
  }
  function removerBanco(nome) {
    const novo = bancos.filter((b) => b.nome !== nome);
    setBancos(novo);
    salvarConfig(planoContas, formasPagamento, novo);
  }

  function handleOfxFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOfxErro("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const txs = parseOfx(String(ev.target.result));
        if (txs.length === 0) { setOfxErro("Nenhuma transação encontrada. Verifique se é um OFX válido."); setOfxPreview([]); return; }
        setOfxPreview(txs.map((t) => ({
          ...t,
          conta: t.tipo === "entrada" ? Object.values(planoContas)[0][0] : (planoContas["DESPESAS FIXAS"]?.[0] || Object.values(planoContas)[0][0]),
          forma: formasPagamento[0]?.nome || "",
          banco: bancos[0]?.nome || "",
          incluir: true,
        })));
      } catch (err) { setOfxErro("Não foi possível ler este arquivo OFX."); }
    };
    reader.readAsText(file);
  }
  function atualizarPreview(fitid, campo, valor) {
    setOfxPreview((prev) => prev.map((t) => t.fitid === fitid ? { ...t, [campo]: valor } : t));
  }
  function confirmarImportacao() {
    const novosItens = ofxPreview.filter((t) => t.incluir).map((t) => ({
      id: uid(), data: t.data, mes: new Date(t.data + "T00:00:00").getMonth() + 1,
      descricao: t.memo, forma: t.forma, conta: t.conta, banco: t.banco, valor: Math.abs(t.valor),
    }));
    const novos = [...lancamentos, ...novosItens];
    setLancamentos(novos);
    salvarLancamentos(novos);
    setOfxPreview([]);
    if (fileRef.current) fileRef.current.value = "";
    setAba("lancamentos");
  }

  function handleCsvFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvErro("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const linhas = parseCsv(String(ev.target.result));
        if (linhas.length === 0) { setCsvErro("Nenhuma linha reconhecida. Confirme que o CSV tem colunas de data e valor."); setCsvPreview([]); return; }
        setCsvPreview(linhas.map((t) => {
          const formaMatch = formasPagamento.find((f) => f.nome.toLowerCase() === (t.formaSugerida || "").toLowerCase());
          const contaMatch = categoriaPorConta[t.contaSugerida] ? t.contaSugerida : null;
          const bancoMatch = bancos.find((b) => b.nome.toLowerCase() === (t.bancoSugerido || "").toLowerCase());
          return {
            ...t,
            conta: contaMatch || (t.tipo === "entrada" ? Object.values(planoContas)[0][0] : (planoContas["DESPESAS FIXAS"]?.[0] || Object.values(planoContas)[0][0])),
            forma: formaMatch?.nome || formasPagamento[0]?.nome || "",
            banco: bancoMatch?.nome || bancos[0]?.nome || "",
            incluir: true,
          };
        }));
      } catch (err) { setCsvErro("Não foi possível ler este arquivo CSV."); }
    };
    reader.readAsText(file);
  }
  function atualizarCsvPreview(fitid, campo, valor) {
    setCsvPreview((prev) => prev.map((t) => t.fitid === fitid ? { ...t, [campo]: valor } : t));
  }
  function confirmarImportacaoCsv() {
    const novosItens = csvPreview.filter((t) => t.incluir).map((t) => ({
      id: uid(), data: t.data, mes: new Date(t.data + "T00:00:00").getMonth() + 1,
      descricao: t.memo, forma: t.forma, conta: t.conta, banco: t.banco, valor: Math.abs(t.valor),
    }));
    const novos = [...lancamentos, ...novosItens];
    setLancamentos(novos);
    salvarLancamentos(novos);
    setCsvPreview([]);
    if (csvFileRef.current) csvFileRef.current.value = "";
    setAba("lancamentos");
  }

  function statusTitulo(t) {
    if (t.pago) return "pago";
    const hoje = new Date().toISOString().slice(0, 10);
    return t.vencimento < hoje ? "vencido" : "aberto";
  }

  function criarTitulo(dados) {
    const novo = { id: uid(), pago: false, dataPagamento: null, ...dados };
    const novos = [...titulos, novo];
    setTitulos(novos);
    salvarTitulos(novos);
  }
  function removerTitulo(id) {
    const novos = titulos.filter((t) => t.id !== id);
    setTitulos(novos);
    salvarTitulos(novos);
  }
  function darBaixa(id, dataPagamento, forma, banco) {
    const titulo = titulos.find((t) => t.id === id);
    if (!titulo) return;
    const novosTitulos = titulos.map((t) => t.id === id ? { ...t, pago: true, dataPagamento } : t);
    setTitulos(novosTitulos);
    salvarTitulos(novosTitulos);
    const novoLancamento = {
      id: uid(), data: dataPagamento, mes: new Date(dataPagamento + "T00:00:00").getMonth() + 1,
      descricao: `Baixa: ${titulo.descricao}`, forma, banco, conta: titulo.conta,
      valor: titulo.valor,
    };
    const novosLanc = [...lancamentos, novoLancamento];
    setLancamentos(novosLanc);
    salvarLancamentos(novosLanc);
  }

  function criarProduto(nome, unidade) {
    if (!nome.trim()) return;
    const novo = { id: uid(), nome: nome.trim(), unidade: unidade || "un", quantidade: 0, custoMedio: 0 };
    const novos = [...produtos, novo];
    setProdutos(novos);
    salvarEstoque(novos, movEstoque);
  }
  function removerProduto(id) {
    const novos = produtos.filter((p) => p.id !== id);
    setProdutos(novos);
    salvarEstoque(novos, movEstoque);
  }
  function registrarMovimento(produtoId, tipo, quantidade, custoUnitario, data) {
    const produto = produtos.find((p) => p.id === produtoId);
    if (!produto || !quantidade || quantidade <= 0) return;
    let novaQuantidade, novoCustoMedio;
    if (tipo === "entrada") {
      const custo = custoUnitario || produto.custoMedio;
      const valorTotalAtual = produto.quantidade * produto.custoMedio;
      const valorTotalEntrada = quantidade * custo;
      novaQuantidade = produto.quantidade + quantidade;
      novoCustoMedio = novaQuantidade > 0 ? (valorTotalAtual + valorTotalEntrada) / novaQuantidade : custo;
    } else {
      novaQuantidade = Math.max(0, produto.quantidade - quantidade);
      novoCustoMedio = produto.custoMedio;
    }
    const novosProdutos = produtos.map((p) => p.id === produtoId ? { ...p, quantidade: novaQuantidade, custoMedio: novoCustoMedio } : p);
    const novoMov = { id: uid(), produtoId, produtoNome: produto.nome, tipo, quantidade, custoUnitario: tipo === "entrada" ? (custoUnitario || produto.custoMedio) : produto.custoMedio, data };
    const novosMovs = [novoMov, ...movEstoque];
    setProdutos(novosProdutos);
    setMovEstoque(novosMovs);
    salvarEstoque(novosProdutos, novosMovs);
  }

  const dfc = useMemo(() => {
    const porMes = {};
    for (let m = 1; m <= 12; m++) porMes[m] = { entradasAvista: {}, entradasAprazo: {}, saidasPorCategoria: {} };
    lancamentos.forEach((l) => {
      const cat = categoriaPorConta[l.conta];
      const bucket = porMes[l.mes];
      if (!bucket) return;
      if (cat === "RECEITAS") {
        const tipo = tipoPorForma[l.forma] || "avista";
        const alvo = tipo === "avista" ? bucket.entradasAvista : bucket.entradasAprazo;
        alvo[l.forma] = (alvo[l.forma] || 0) + l.valor;
      } else if (CATS_SAIDA_DFC.includes(cat) || cat === "DEDUÇÕES DE RECEITA") {
        bucket.saidasPorCategoria[cat] = (bucket.saidasPorCategoria[cat] || 0) + l.valor;
      }
    });
    return porMes;
  }, [lancamentos, categoriaPorConta, tipoPorForma]);

  const drg = useMemo(() => {
    const porMes = {};
    for (let m = 1; m <= 12; m++) { porMes[m] = {}; Object.keys(planoContas).forEach((cat) => (porMes[m][cat] = {})); }
    lancamentos.forEach((l) => {
      const cat = categoriaPorConta[l.conta];
      if (!porMes[l.mes] || !porMes[l.mes][cat]) return;
      porMes[l.mes][cat][l.conta] = (porMes[l.mes][cat][l.conta] || 0) + l.valor;
    });
    return porMes;
  }, [lancamentos, planoContas, categoriaPorConta]);

  const somaCat = (mesObj, cat) => Object.values(mesObj[cat] || {}).reduce((a, b) => a + b, 0);
  const mDrg = drg[mesFiltro] || {};
  const receitaBruta = somaCat(mDrg, "RECEITAS");
  const deducoes = somaCat(mDrg, "DEDUÇÕES DE RECEITA");
  const receitaLiquida = receitaBruta - deducoes;
  const cmv = somaCat(mDrg, "CUSTOS VARIÁVEIS (CMV/CSP)");
  const margemContribuicao = receitaLiquida - cmv;
  const cmo = somaCat(mDrg, "CMO – CUSTO DE MÃO DE OBRA");
  const despFixas = somaCat(mDrg, "DESPESAS FIXAS");
  const admin = somaCat(mDrg, "ADMINISTRATIVO E COMERCIAL");
  const resultadoOperacional = margemContribuicao - cmo - despFixas - admin;
  const financiamentos = somaCat(mDrg, "FINANCIAMENTOS / AMORTIZAÇÃO");
  const resultadoPeriodo = resultadoOperacional - financiamentos;

  const mDfc = dfc[mesFiltro] || { entradasAvista: {}, entradasAprazo: {}, saidasPorCategoria: {} };
  const totalAvista = Object.values(mDfc.entradasAvista).reduce((a, b) => a + b, 0);
  const totalAprazo = Object.values(mDfc.entradasAprazo).reduce((a, b) => a + b, 0);
  const totalEntradas = totalAvista + totalAprazo;
  const totalSaidas = Object.values(mDfc.saidasPorCategoria).reduce((a, b) => a + b, 0);
  const geracaoCaixa = totalEntradas - totalSaidas;

  const margemContribuicaoPct = receitaLiquida ? (margemContribuicao / receitaLiquida) * 100 : 0;
  const cmvPct = receitaLiquida ? (cmv / receitaLiquida) * 100 : 0;
  const cmoPct = receitaLiquida ? (cmo / receitaLiquida) * 100 : 0;
  const lucratividadePct = receitaLiquida ? (resultadoPeriodo / receitaLiquida) * 100 : 0;

  const custosFixosTotais = cmo + despFixas + admin + financiamentos;
  const indiceMC = receitaLiquida ? margemContribuicao / receitaLiquida : 0;
  const pontoEquilibrio = indiceMC > 0 ? custosFixosTotais / indiceMC : 0;
  const margemSegurancaPct = receitaLiquida ? ((receitaLiquida - pontoEquilibrio) / receitaLiquida) * 100 : 0;
  const acimaDoPontoEquilibrio = receitaLiquida >= pontoEquilibrio;

  const hoje = new Date().toISOString().slice(0, 10);
  const diasAtraso = (venc) => Math.floor((new Date(hoje) - new Date(venc)) / 86400000);
  const aging = useMemo(() => {
    const buckets = { "Em dia": 0, "1-30 dias": 0, "31-60 dias": 0, "61-90 dias": 0, "90+ dias": 0 };
    titulos.filter((t) => !t.pago).forEach((t) => {
      const d = diasAtraso(t.vencimento);
      if (d <= 0) buckets["Em dia"] += t.valor;
      else if (d <= 30) buckets["1-30 dias"] += t.valor;
      else if (d <= 60) buckets["31-60 dias"] += t.valor;
      else if (d <= 90) buckets["61-90 dias"] += t.valor;
      else buckets["90+ dias"] += t.valor;
    });
    return buckets;
  }, [titulos, hoje]);
  const titulosPagar = titulos.filter((t) => t.tipo === "pagar");
  const titulosReceber = titulos.filter((t) => t.tipo === "receber");
  const totalAbertoPagar = titulosPagar.filter((t) => !t.pago).reduce((a, t) => a + t.valor, 0);
  const totalAbertoReceber = titulosReceber.filter((t) => !t.pago).reduce((a, t) => a + t.valor, 0);
  const valorTotalEstoque = produtos.reduce((a, p) => a + p.quantidade * p.custoMedio, 0);

  const clienteAtivo = clientes.find((c) => c.id === clienteAtivoId);
  const ABAS_FINANCEIRO = [
    ["lancamentos", "Lançamentos"], ["contaspr", "Contas a Pagar/Receber"], ["config", "Plano de Contas & Configurações"],
    ["demonstrativos", "Demonstrativos"], ["indicadores", "Indicadores"],
  ];

  if (carregando) {
    return <div style={styles.loadingScreen}>Carregando CB Contabilidade Estratégica…</div>;
  }

  return (
    <div style={styles.app}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printArea, #printArea * { visibility: visible; }
          #printArea { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; border: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div style={styles.shell}>
        <aside style={styles.sidebar}>
          <div style={styles.brand}>
            <div style={styles.logoMark}>CB</div>
            <div>
              <div style={styles.brandName}>CB Contabilidade Estratégica</div>
              <div style={styles.brandSub}>ERP Financeiro</div>
            </div>
          </div>

          <div style={styles.clienteBox}>
            <label style={styles.toolbarLabelLight}>Cliente</label>
            <select
              value={clienteAtivoId || ""}
              onChange={(e) => setClienteAtivoId(e.target.value)}
              style={styles.clienteSelect}
            >
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <button style={styles.btnNovoCliente} onClick={() => setMostrarNovoCliente((v) => !v)}>
              {mostrarNovoCliente ? "cancelar" : "+ novo cliente"}
            </button>
            {mostrarNovoCliente && <NovoClienteForm onCriar={criarCliente} />}
            {clienteAtivo && clientes.length > 1 && (
              <button style={styles.btnRemoverCliente} onClick={() => removerCliente(clienteAtivoId)}>
                remover "{clienteAtivo.nome}"
              </button>
            )}
          </div>

          <nav style={styles.sideNav}>
            {MODULOS_SIDEBAR.map((m) => (
              <button key={m.id} disabled={!m.disponivel}
                onClick={() => m.disponivel && setModuloAtivo(m.id)}
                style={{ ...styles.sideNavBtn, ...(m.id === moduloAtivo ? styles.sideNavBtnActive : {}), ...(m.disponivel ? {} : styles.sideNavBtnDisabled) }}>
                {m.label}{!m.disponivel && <span style={styles.emBreve}>em breve</span>}
              </button>
            ))}
          </nav>

          <button style={styles.btnLogout} onClick={() => supabase.auth.signOut()}>Sair</button>
        </aside>

        <div style={styles.contentArea}>
          <header style={styles.header}>
            <h1 style={styles.pageTitle}>
              {moduloAtivo === "financeiro" ? "ERP FINANCEIRO" : "ESTOQUE"} {clienteAtivo ? `· ${clienteAtivo.nome}` : ""}
            </h1>
            <div style={styles.headerRight}>
              {moduloAtivo === "financeiro" && (
                <>
                  <label style={styles.toolbarLabel}>Mês</label>
                  <select value={mesFiltro} onChange={(e) => setMesFiltro(parseInt(e.target.value))} style={styles.select}>
                    {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                  {aba === "demonstrativos" && (
                    <span style={{ ...styles.regimeBadge, ...(subDemonstrativo === "dfc" ? styles.regimeBadgeCaixa : styles.regimeBadgeCompetencia) }}>
                      {subDemonstrativo === "dfc" ? "● REGIME DE CAIXA" : "● REGIME DE COMPETÊNCIA"}
                    </span>
                  )}
                </>
              )}
            </div>
          </header>

          {moduloAtivo === "financeiro" && (
            <div style={styles.subNav}>
              {ABAS_FINANCEIRO.map(([id, label]) => (
                <button key={id} onClick={() => setAba(id)} style={{ ...styles.subNavBtn, ...(aba === id ? styles.subNavBtnActive : {}) }}>{label}</button>
              ))}
            </div>
          )}

          <main style={styles.main}>
            {erroStorage && <div style={styles.avisoErro}>{erroStorage}</div>}
            {carregandoCliente ? (
              <div style={styles.card}>Carregando dados do cliente…</div>
            ) : moduloAtivo === "estoque" ? (
              <>
                <section style={styles.card}>
                  <h2 style={styles.cardTitle}>Novo produto</h2>
                  <NovoProduto onCriar={criarProduto} />
                </section>

                <section style={styles.card}>
                  <h2 style={styles.cardTitle}>Produtos em estoque</h2>
                  <p style={styles.note}>Valor total em estoque: <strong>{fmt(valorTotalEstoque)}</strong></p>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead><tr>
                        <th style={styles.th}>Produto</th><th style={styles.th}>Unidade</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Quantidade</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Custo Médio</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Valor Total</th><th style={styles.th}></th>
                      </tr></thead>
                      <tbody>
                        {produtos.map((p) => (
                          <tr key={p.id}>
                            <td style={styles.td}>{p.nome}</td><td style={styles.td}>{p.unidade}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{p.quantidade}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{fmt(p.custoMedio)}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{fmt(p.quantidade * p.custoMedio)}</td>
                            <td style={styles.td}><button style={styles.btnGhostDanger} onClick={() => removerProduto(p.id)}>remover</button></td>
                          </tr>
                        ))}
                        {produtos.length === 0 && <tr><td style={styles.td} colSpan={6}>Nenhum produto cadastrado.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section style={styles.card}>
                  <h2 style={styles.cardTitle}>Registrar movimento</h2>
                  <MovimentoEstoque produtos={produtos} onRegistrar={registrarMovimento} />
                </section>

                <section style={styles.card}>
                  <h2 style={styles.cardTitle}>Histórico de movimentos</h2>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead><tr>
                        <th style={styles.th}>Data</th><th style={styles.th}>Produto</th><th style={styles.th}>Tipo</th>
                        <th style={{ ...styles.th, textAlign: "right" }}>Quantidade</th><th style={{ ...styles.th, textAlign: "right" }}>Custo Unit.</th>
                      </tr></thead>
                      <tbody>
                        {movEstoque.map((m) => (
                          <tr key={m.id}>
                            <td style={styles.td}>{fmtDate(m.data)}</td><td style={styles.td}>{m.produtoNome}</td>
                            <td style={styles.td}>
                              <span style={{ ...styles.statusPill, ...(m.tipo === "entrada" ? styles.statusPillOk : styles.statusPillNeutro) }}>
                                {m.tipo === "entrada" ? "ENTRADA" : "SAÍDA"}
                              </span>
                            </td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{m.quantidade}</td>
                            <td style={{ ...styles.td, textAlign: "right" }}>{fmt(m.custoUnitario)}</td>
                          </tr>
                        ))}
                        {movEstoque.length === 0 && <tr><td style={styles.td} colSpan={5}>Nenhum movimento registrado.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            ) : (
              <>
                {aba === "lancamentos" && (
                  <>
                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>{editingId ? "Editar lançamento" : "Novo lançamento"}</h2>
                      <form onSubmit={salvarLancamento} style={styles.formGrid}>
                        <div style={styles.field}>
                          <label style={styles.label}>Data</label>
                          <input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} style={styles.input} />
                        </div>
                        <div style={{ ...styles.field, gridColumn: "span 2" }}>
                          <label style={styles.label}>Descrição</label>
                          <input type="text" placeholder="Ex.: Venda do dia, pagamento fornecedor..." value={form.descricao}
                            onChange={(e) => setForm({ ...form, descricao: e.target.value })} style={styles.input} />
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Banco</label>
                          <select value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} style={styles.input}>
                            {bancos.length === 0 && <option value="">Cadastre um banco em Configurações</option>}
                            {bancos.map((b) => <option key={b.nome} value={b.nome}>{b.nome}</option>)}
                          </select>
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Forma de recebimento/pagamento</label>
                          <select value={form.forma} onChange={(e) => setForm({ ...form, forma: e.target.value })} style={styles.input}>
                            {formasPagamento.map((f) => <option key={f.nome} value={f.nome}>{f.nome} ({f.tipo === "avista" ? "à vista" : "a prazo"})</option>)}
                          </select>
                        </div>
                        <div style={{ ...styles.field, gridColumn: "span 2" }}>
                          <label style={styles.label}>Conta (plano de contas)</label>
                          <select value={form.conta} onChange={(e) => setForm({ ...form, conta: e.target.value })} style={styles.input}>
                            {Object.entries(planoContas).map(([cat, contas]) => (
                              <optgroup key={cat} label={cat}>{contas.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
                            ))}
                          </select>
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Valor (R$)</label>
                          <input type="number" step="0.01" placeholder="0,00" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} style={styles.input} />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                          <button type="submit" style={styles.btnPrimary}>{editingId ? "Salvar" : "Lançar"}</button>
                          {editingId && (
                            <button type="button" style={styles.btnSecondary}
                              onClick={() => { setEditingId(null); setForm((f) => ({ ...f, descricao: "", valor: "" })); }}>Cancelar</button>
                          )}
                        </div>
                      </form>
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Lançamentos de {MESES[mesFiltro - 1]}</h2>
                      <div style={styles.tableWrap}>
                        <table style={styles.table}>
                          <thead><tr>
                            <th style={styles.th}>Data</th><th style={styles.th}>Descrição</th><th style={styles.th}>Banco</th>
                            <th style={styles.th}>Forma</th><th style={styles.th}>Conta</th>
                            <th style={{ ...styles.th, textAlign: "right" }}>Valor</th><th style={styles.th}></th>
                          </tr></thead>
                          <tbody>
                            {lancamentos.filter((l) => l.mes === mesFiltro).map((l) => (
                              <tr key={l.id}>
                                <td style={styles.td}>{fmtDate(l.data)}</td><td style={styles.td}>{l.descricao}</td>
                                <td style={styles.td}>{l.banco}</td><td style={styles.td}>{l.forma}</td><td style={styles.td}>{l.conta}</td>
                                <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(l.valor)}</td>
                                <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                                  <button onClick={() => editarLancamento(l)} style={styles.btnGhost}>editar</button>{" "}
                                  <button onClick={() => removerLancamento(l.id)} style={styles.btnGhostDanger}>remover</button>
                                </td>
                              </tr>
                            ))}
                            {lancamentos.filter((l) => l.mes === mesFiltro).length === 0 && (
                              <tr><td style={styles.td} colSpan={7}>Nenhum lançamento neste mês.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Importar extrato bancário (OFX)</h2>
                      <p style={styles.note}>Envie o arquivo .ofx do internet banking. Classifique cada linha antes de confirmar — nada entra sem revisão.</p>
                      <input ref={fileRef} type="file" accept=".ofx,.qfx" onChange={handleOfxFile} style={styles.fileInput} />
                      {ofxErro && <p style={styles.errorText}>{ofxErro}</p>}
                      {ofxPreview.length > 0 && (
                        <>
                          <div style={styles.tableWrap}>
                            <table style={styles.table}>
                              <thead><tr>
                                <th style={styles.th}>Incluir</th><th style={styles.th}>Data</th><th style={styles.th}>Descrição (extrato)</th>
                                <th style={{ ...styles.th, textAlign: "right" }}>Valor</th><th style={styles.th}>Banco</th><th style={styles.th}>Forma</th><th style={styles.th}>Conta</th>
                              </tr></thead>
                              <tbody>
                                {ofxPreview.map((t) => (
                                  <tr key={t.fitid}>
                                    <td style={styles.td}><input type="checkbox" checked={t.incluir} onChange={(e) => atualizarPreview(t.fitid, "incluir", e.target.checked)} /></td>
                                    <td style={styles.td}>{fmtDate(t.data)}</td><td style={styles.td}>{t.memo}</td>
                                    <td style={{ ...styles.td, textAlign: "right", color: t.tipo === "entrada" ? "#166534" : "#991B1B" }}>{fmt(t.valor)}</td>
                                    <td style={styles.td}>
                                      <select value={t.banco} onChange={(e) => atualizarPreview(t.fitid, "banco", e.target.value)} style={styles.inputSmall}>
                                        {bancos.map((b) => <option key={b.nome} value={b.nome}>{b.nome}</option>)}
                                      </select>
                                    </td>
                                    <td style={styles.td}>
                                      <select value={t.forma} onChange={(e) => atualizarPreview(t.fitid, "forma", e.target.value)} style={styles.inputSmall}>
                                        {formasPagamento.map((f) => <option key={f.nome} value={f.nome}>{f.nome}</option>)}
                                      </select>
                                    </td>
                                    <td style={styles.td}>
                                      <select value={t.conta} onChange={(e) => atualizarPreview(t.fitid, "conta", e.target.value)} style={styles.inputSmall}>
                                        {Object.entries(planoContas).map(([cat, contas]) => (
                                          <optgroup key={cat} label={cat}>{contas.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
                                        ))}
                                      </select>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ marginTop: 14 }}>
                            <button style={styles.btnPrimary} onClick={confirmarImportacao}>
                              Confirmar importação ({ofxPreview.filter((t) => t.incluir).length} lançamentos)
                            </button>
                          </div>
                        </>
                      )}
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Importar planilha (CSV)</h2>
                      <p style={styles.note}>
                        Para bancos sem OFX. Colunas reconhecidas por nome no cabeçalho: Data, Descrição, Valor,
                        Forma, Conta, Banco (nessa ordem não é obrigatória). Datas em aaaa-mm-dd ou dd/mm/aaaa.
                      </p>
                      <input ref={csvFileRef} type="file" accept=".csv" onChange={handleCsvFile} style={styles.fileInput} />
                      {csvErro && <p style={styles.errorText}>{csvErro}</p>}
                      {csvPreview.length > 0 && (
                        <>
                          <div style={styles.tableWrap}>
                            <table style={styles.table}>
                              <thead><tr>
                                <th style={styles.th}>Incluir</th><th style={styles.th}>Data</th><th style={styles.th}>Descrição</th>
                                <th style={{ ...styles.th, textAlign: "right" }}>Valor</th><th style={styles.th}>Banco</th><th style={styles.th}>Forma</th><th style={styles.th}>Conta</th>
                              </tr></thead>
                              <tbody>
                                {csvPreview.map((t) => (
                                  <tr key={t.fitid}>
                                    <td style={styles.td}><input type="checkbox" checked={t.incluir} onChange={(e) => atualizarCsvPreview(t.fitid, "incluir", e.target.checked)} /></td>
                                    <td style={styles.td}>{t.data ? fmtDate(t.data) : "—"}</td><td style={styles.td}>{t.memo}</td>
                                    <td style={{ ...styles.td, textAlign: "right", color: t.tipo === "entrada" ? "#166534" : "#991B1B" }}>{fmt(t.valor)}</td>
                                    <td style={styles.td}>
                                      <select value={t.banco} onChange={(e) => atualizarCsvPreview(t.fitid, "banco", e.target.value)} style={styles.inputSmall}>
                                        {bancos.map((b) => <option key={b.nome} value={b.nome}>{b.nome}</option>)}
                                      </select>
                                    </td>
                                    <td style={styles.td}>
                                      <select value={t.forma} onChange={(e) => atualizarCsvPreview(t.fitid, "forma", e.target.value)} style={styles.inputSmall}>
                                        {formasPagamento.map((f) => <option key={f.nome} value={f.nome}>{f.nome}</option>)}
                                      </select>
                                    </td>
                                    <td style={styles.td}>
                                      <select value={t.conta} onChange={(e) => atualizarCsvPreview(t.fitid, "conta", e.target.value)} style={styles.inputSmall}>
                                        {Object.entries(planoContas).map(([cat, contas]) => (
                                          <optgroup key={cat} label={cat}>{contas.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
                                        ))}
                                      </select>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ marginTop: 14 }}>
                            <button style={styles.btnPrimary} onClick={confirmarImportacaoCsv}>
                              Confirmar importação ({csvPreview.filter((t) => t.incluir).length} lançamentos)
                            </button>
                          </div>
                        </>
                      )}
                    </section>
                  </>
                )}

                {aba === "contaspr" && (
                  <>
                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Novo título</h2>
                      <NovoTitulo planoContas={planoContas} onCriar={criarTitulo} />
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Contas a Pagar</h2>
                      <p style={styles.note}>Em aberto: {fmt(totalAbertoPagar)}</p>
                      <ListaTitulos
                        titulos={titulosPagar} statusTitulo={statusTitulo} formasPagamento={formasPagamento}
                        bancos={bancos} onBaixa={darBaixa} onRemover={removerTitulo}
                      />
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Contas a Receber</h2>
                      <p style={styles.note}>Em aberto: {fmt(totalAbertoReceber)}</p>
                      <ListaTitulos
                        titulos={titulosReceber} statusTitulo={statusTitulo} formasPagamento={formasPagamento}
                        bancos={bancos} onBaixa={darBaixa} onRemover={removerTitulo}
                      />
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Relatório de Aging (títulos em aberto)</h2>
                      <div style={styles.kpiGrid}>
                        {Object.entries(aging).map(([faixa, valor]) => (
                          <div key={faixa} style={styles.kpiCard}>
                            <div style={styles.kpiLabel}>{faixa}</div>
                            <div style={{ ...styles.kpiValue, fontSize: 17, color: faixa === "Em dia" ? NAVY : "#B45309" }}>{fmt(valor)}</div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </>
                )}

                {aba === "config" && (
                  <>
                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Plano de Contas</h2>
                      <p style={styles.note}>Adicione ou remova contas dentro de cada categoria, ou crie uma nova categoria.</p>
                      {Object.entries(planoContas).map(([cat, contas]) => (
                        <div key={cat} style={styles.planoBloco}>
                          <div style={styles.planoCatTitle}>{cat}</div>
                          <ul style={styles.planoLista}>
                            {contas.map((c) => (
                              <li key={c} style={styles.planoItem}><span>{c}</span><button onClick={() => removerConta(cat, c)} style={styles.btnGhostDanger}>remover</button></li>
                            ))}
                          </ul>
                          <AddInline placeholder="Nova conta..." onAdd={(v) => addConta(cat, v)} />
                        </div>
                      ))}
                      <div style={{ marginTop: 18, borderTop: "1px dashed #D9D6EE", paddingTop: 14 }}>
                        <div style={styles.planoCatTitle}>Nova categoria</div>
                        <AddInline placeholder="Nome da nova categoria..." onAdd={addCategoria} />
                      </div>
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Bancos</h2>
                      <div style={styles.tableWrap}>
                        <table style={styles.table}>
                          <thead><tr><th style={styles.th}>Nome</th><th style={styles.th}>Instituição</th><th style={styles.th}>Conta</th><th style={styles.th}></th></tr></thead>
                          <tbody>
                            {bancos.map((b) => (
                              <tr key={b.nome}><td style={styles.td}>{b.nome}</td><td style={styles.td}>{b.instituicao}</td><td style={styles.td}>{b.conta}</td>
                                <td style={styles.td}><button onClick={() => removerBanco(b.nome)} style={styles.btnGhostDanger}>remover</button></td></tr>
                            ))}
                            {bancos.length === 0 && <tr><td style={styles.td} colSpan={4}>Nenhum banco cadastrado.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                      <NovoBanco onAdd={addBanco} />
                    </section>

                    <section style={styles.card}>
                      <h2 style={styles.cardTitle}>Formas de recebimento/pagamento</h2>
                      <p style={styles.note}>Clique no selo para alternar entre À Vista e A Prazo — isso define como cada forma entra no DFC.</p>
                      <div style={styles.tableWrap}>
                        <table style={styles.table}>
                          <thead><tr><th style={styles.th}>Forma</th><th style={styles.th}>Comportamento no caixa</th><th style={styles.th}></th></tr></thead>
                          <tbody>
                            {formasPagamento.map((f) => (
                              <tr key={f.nome}>
                                <td style={styles.td}>{f.nome}</td>
                                <td style={styles.td}>
                                  <button onClick={() => toggleTipoForma(f.nome)}
                                    style={{ ...styles.regimeBadge, ...(f.tipo === "avista" ? styles.regimeBadgeCaixa : styles.regimeBadgeCompetencia), cursor: "pointer", border: "none" }}>
                                    {f.tipo === "avista" ? "À VISTA" : "A PRAZO"}
                                  </button>
                                </td>
                                <td style={styles.td}><button onClick={() => removerForma(f.nome)} style={styles.btnGhostDanger}>remover</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <NovaForma onAdd={addForma} />
                    </section>
                  </>
                )}

                {aba === "demonstrativos" && (
                  <section style={styles.card} id="printArea">
                    <div style={styles.demoSwitchRow}>
                      <h2 style={styles.cardTitle}>
                        {subDemonstrativo === "dfc" ? "Demonstração de Fluxo de Caixa" : "Demonstração de Resultado Gerencial"} — {MESES[mesFiltro - 1]}
                        {clienteAtivo ? ` · ${clienteAtivo.nome}` : ""}
                      </h2>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={styles.demoSwitch}>
                          <button onClick={() => setSubDemonstrativo("dfc")} style={{ ...styles.demoSwitchBtn, ...(subDemonstrativo === "dfc" ? styles.demoSwitchBtnCaixa : {}) }}>DFC · Caixa</button>
                          <button onClick={() => setSubDemonstrativo("drg")} style={{ ...styles.demoSwitchBtn, ...(subDemonstrativo === "drg" ? styles.demoSwitchBtnCompetencia : {}) }}>DRG · Competência</button>
                        </div>
                        <button onClick={() => window.print()} style={styles.btnSecondary} className="no-print">Exportar PDF</button>
                      </div>
                    </div>

                    {subDemonstrativo === "dfc" && (
                      <table style={styles.demoTable}><tbody>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(+) Entradas à vista</td></tr>
                        {Object.entries(mDfc.entradasAvista).map(([forma, v]) => (<tr key={forma}><td style={styles.demoLineLabel}>{forma}</td><td style={styles.demoLineVal}>{fmt(v)}</td></tr>))}
                        <tr style={styles.demoSubtotal}><td>Subtotal à vista</td><td style={styles.demoLineVal}>{fmt(totalAvista)}</td></tr>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(+) Entradas a prazo</td></tr>
                        {Object.entries(mDfc.entradasAprazo).map(([forma, v]) => (<tr key={forma}><td style={styles.demoLineLabel}>{forma}</td><td style={styles.demoLineVal}>{fmt(v)}</td></tr>))}
                        <tr style={styles.demoSubtotal}><td>Subtotal a prazo</td><td style={styles.demoLineVal}>{fmt(totalAprazo)}</td></tr>
                        <tr style={styles.demoTotal}><td>(=) Total de entradas</td><td style={styles.demoLineVal}>{fmt(totalEntradas)}</td></tr>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(−) Saídas por grupo</td></tr>
                        {CATS_SAIDA_DFC.concat(["DEDUÇÕES DE RECEITA"]).map((cat) => mDfc.saidasPorCategoria[cat] ? (
                          <tr key={cat}><td style={styles.demoLineLabel}>{cat}</td><td style={styles.demoLineVal}>{fmt(mDfc.saidasPorCategoria[cat])}</td></tr>
                        ) : null)}
                        <tr style={styles.demoSubtotal}><td>Total de saídas</td><td style={styles.demoLineVal}>{fmt(totalSaidas)}</td></tr>
                        <tr style={styles.demoFinal}><td>(=) Geração de caixa do mês</td><td style={styles.demoLineVal}>{fmt(geracaoCaixa)}</td></tr>
                      </tbody></table>
                    )}

                    {subDemonstrativo === "drg" && (
                      <table style={styles.demoTable}><tbody>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(+) Receitas</td></tr>
                        {Object.entries(mDrg["RECEITAS"] || {}).map(([conta, v]) => (<tr key={conta}><td style={styles.demoLineLabel}>{conta}</td><td style={styles.demoLineVal}>{fmt(v)}</td></tr>))}
                        <tr style={styles.demoSubtotal}><td>(=) Receita Bruta</td><td style={styles.demoLineVal}>{fmt(receitaBruta)}</td></tr>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(−) Deduções da receita</td></tr>
                        {Object.entries(mDrg["DEDUÇÕES DE RECEITA"] || {}).map(([conta, v]) => (<tr key={conta}><td style={styles.demoLineLabel}>{conta}</td><td style={styles.demoLineVal}>{fmt(v)}</td></tr>))}
                        <tr style={styles.demoSubtotal}><td>(=) Receita Líquida</td><td style={styles.demoLineVal}>{fmt(receitaLiquida)}</td></tr>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(−) Custos variáveis (CMV)</td></tr>
                        {Object.entries(mDrg["CUSTOS VARIÁVEIS (CMV/CSP)"] || {}).map(([conta, v]) => (<tr key={conta}><td style={styles.demoLineLabel}>{conta}</td><td style={styles.demoLineVal}>{fmt(v)}</td></tr>))}
                        <tr style={styles.demoSubtotal}><td>(=) Margem de Contribuição</td><td style={styles.demoLineVal}>{fmt(margemContribuicao)}</td></tr>
                        <tr style={styles.demoSectionRow}><td colSpan={2}>(−) CMO, despesas fixas, administrativo</td></tr>
                        <tr><td style={styles.demoLineLabel}>CMO – Custo de Mão de Obra</td><td style={styles.demoLineVal}>{fmt(cmo)}</td></tr>
                        <tr><td style={styles.demoLineLabel}>Despesas Fixas</td><td style={styles.demoLineVal}>{fmt(despFixas)}</td></tr>
                        <tr><td style={styles.demoLineLabel}>Administrativo e Comercial</td><td style={styles.demoLineVal}>{fmt(admin)}</td></tr>
                        <tr style={styles.demoSubtotal}><td>(=) Resultado Operacional</td><td style={styles.demoLineVal}>{fmt(resultadoOperacional)}</td></tr>
                        <tr><td style={styles.demoLineLabel}>(−) Financiamentos/juros</td><td style={styles.demoLineVal}>{fmt(financiamentos)}</td></tr>
                        <tr style={styles.demoFinal}><td>(=) Resultado do período</td><td style={styles.demoLineVal}>{fmt(resultadoPeriodo)}</td></tr>
                      </tbody></table>
                    )}
                  </section>
                )}

                {aba === "indicadores" && (
                  <section style={styles.card}>
                    <h2 style={styles.cardTitle}>Indicadores Gerenciais — {MESES[mesFiltro - 1]}</h2>
                    <div style={styles.kpiGrid}>
                      <KpiCard label="Margem de Contribuição" value={`${margemContribuicaoPct.toFixed(1)}%`} />
                      <KpiCard label="CMV / Receita Líquida" value={`${cmvPct.toFixed(1)}%`} />
                      <KpiCard label="CMO / Receita Líquida" value={`${cmoPct.toFixed(1)}%`} />
                      <KpiCard label="Lucratividade" value={`${lucratividadePct.toFixed(1)}%`} highlight={lucratividadePct >= 0} />
                    </div>
                    <div style={{ ...styles.kpiGrid, marginTop: 14 }}>
                      <div style={{ ...styles.kpiCardWide, gridColumn: "span 2" }}>
                        <div style={styles.kpiLabel}>Ponto de Equilíbrio (R$)</div>
                        <div style={{ ...styles.kpiValue, color: NAVY }}>{fmt(pontoEquilibrio)}</div>
                        <div style={{ ...styles.statusPill, ...(acimaDoPontoEquilibrio ? styles.statusPillOk : styles.statusPillAlert) }}>
                          {acimaDoPontoEquilibrio ? "● Receita acima do ponto de equilíbrio" : "● Receita abaixo do ponto de equilíbrio"}
                        </div>
                      </div>
                      <div style={{ ...styles.kpiCardWide, gridColumn: "span 2" }}>
                        <div style={styles.kpiLabel}>Margem de Segurança</div>
                        <div style={{ ...styles.kpiValue, color: margemSegurancaPct >= 0 ? NAVY : "#B91C1C" }}>{margemSegurancaPct.toFixed(1)}%</div>
                        <div style={styles.note}>Quanto a receita pode cair antes de atingir o ponto de equilíbrio.</div>
                      </div>
                    </div>
                    <p style={styles.note}>Liquidez Corrente, Ciclo Financeiro e ROIC entram na Fase 2, quando houver dados de balanço.</p>
                  </section>
                )}
              </>
            )}
          </main>

          <footer style={styles.footer}>CB Contabilidade Estratégica · ERP Financeiro · dados salvos automaticamente e compartilhados com a equipe</footer>
        </div>
      </div>
    </div>
  );
}

function AddInline({ placeholder, onAdd }) {
  const [v, setV] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <input style={styles.input} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <button style={styles.btnSecondary} onClick={() => { onAdd(v); setV(""); }}>Adicionar</button>
    </div>
  );
}
function NovoBanco({ onAdd }) {
  const [nome, setNome] = useState(""); const [inst, setInst] = useState(""); const [conta, setConta] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
      <input style={styles.input} placeholder="Nome (apelido)" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input style={styles.input} placeholder="Instituição" value={inst} onChange={(e) => setInst(e.target.value)} />
      <input style={styles.input} placeholder="Conta" value={conta} onChange={(e) => setConta(e.target.value)} />
      <button style={styles.btnSecondary} onClick={() => { onAdd(nome, inst, conta); setNome(""); setInst(""); setConta(""); }}>Adicionar banco</button>
    </div>
  );
}
function NovaForma({ onAdd }) {
  const [nome, setNome] = useState(""); const [tipo, setTipo] = useState("avista");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
      <input style={styles.input} placeholder="Nova forma de pagamento" value={nome} onChange={(e) => setNome(e.target.value)} />
      <select style={styles.input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="avista">À Vista</option><option value="aprazo">A Prazo</option>
      </select>
      <button style={styles.btnSecondary} onClick={() => { onAdd(nome, tipo); setNome(""); }}>Adicionar</button>
    </div>
  );
}
function NovoProduto({ onCriar }) {
  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState("un");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input style={styles.input} placeholder="Nome do produto" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input style={styles.input} placeholder="Unidade (un, kg, cx...)" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
      <button style={styles.btnPrimary} onClick={() => { onCriar(nome, unidade); setNome(""); }}>Cadastrar produto</button>
    </div>
  );
}

function MovimentoEstoque({ produtos, onRegistrar }) {
  const [produtoId, setProdutoId] = useState(produtos[0]?.id || "");
  const [tipo, setTipo] = useState("entrada");
  const [quantidade, setQuantidade] = useState("");
  const [custoUnitario, setCustoUnitario] = useState("");
  const [data, setData] = useState("2026-01-15");
  useEffect(() => { if (!produtoId && produtos[0]) setProdutoId(produtos[0].id); }, [produtos, produtoId]);
  if (produtos.length === 0) return <p style={styles.note}>Cadastre um produto antes de registrar movimentos.</p>;
  return (
    <div style={styles.formGrid}>
      <div style={styles.field}>
        <label style={styles.label}>Produto</label>
        <select style={styles.input} value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
          {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Tipo</label>
        <select style={styles.input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="entrada">Entrada</option><option value="saida">Saída</option>
        </select>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Data</label>
        <input type="date" style={styles.input} value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Quantidade</label>
        <input type="number" step="0.01" style={styles.input} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
      </div>
      {tipo === "entrada" && (
        <div style={styles.field}>
          <label style={styles.label}>Custo unitário (R$)</label>
          <input type="number" step="0.01" style={styles.input} value={custoUnitario} onChange={(e) => setCustoUnitario(e.target.value)} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <button style={styles.btnPrimary} onClick={() => {
          onRegistrar(produtoId, tipo, parseFloat(quantidade), parseFloat(custoUnitario) || 0, data);
          setQuantidade(""); setCustoUnitario("");
        }}>Registrar</button>
      </div>
    </div>
  );
}

function NovoTitulo({ planoContas, onCriar }) {
  const [tipo, setTipo] = useState("pagar");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("2026-02-10");
  const [conta, setConta] = useState(Object.values(planoContas)[0][0]);
  return (
    <div style={styles.formGrid}>
      <div style={styles.field}>
        <label style={styles.label}>Tipo</label>
        <select style={styles.input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="pagar">A Pagar</option><option value="receber">A Receber</option>
        </select>
      </div>
      <div style={{ ...styles.field, gridColumn: "span 2" }}>
        <label style={styles.label}>Descrição</label>
        <input style={styles.input} placeholder="Ex.: Fornecedor X, Cliente Y..." value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Vencimento</label>
        <input type="date" style={styles.input} value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </div>
      <div style={{ ...styles.field, gridColumn: "span 2" }}>
        <label style={styles.label}>Conta (plano de contas)</label>
        <select style={styles.input} value={conta} onChange={(e) => setConta(e.target.value)}>
          {Object.entries(planoContas).map(([cat, contas]) => (
            <optgroup key={cat} label={cat}>{contas.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
          ))}
        </select>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Valor (R$)</label>
        <input type="number" step="0.01" style={styles.input} placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <button style={styles.btnPrimary} onClick={() => {
          if (!valor || !descricao.trim()) return;
          onCriar({ tipo, descricao, valor: parseFloat(valor), vencimento, conta });
          setDescricao(""); setValor("");
        }}>Adicionar título</button>
      </div>
    </div>
  );
}

function ListaTitulos({ titulos, statusTitulo, formasPagamento, bancos, onBaixa, onRemover }) {
  const [baixaAbertaId, setBaixaAbertaId] = useState(null);
  const [dataPagamento, setDataPagamento] = useState("2026-01-20");
  const [forma, setForma] = useState(formasPagamento[0]?.nome || "");
  const [banco, setBanco] = useState(bancos[0]?.nome || "");
  const badgeEstilo = { pago: styles.statusPillOk, aberto: styles.statusPillNeutro, vencido: styles.statusPillAlert };
  const rotulo = { pago: "PAGO", aberto: "ABERTO", vencido: "VENCIDO" };
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead><tr>
          <th style={styles.th}>Descrição</th><th style={styles.th}>Conta</th><th style={styles.th}>Vencimento</th>
          <th style={{ ...styles.th, textAlign: "right" }}>Valor</th><th style={styles.th}>Status</th><th style={styles.th}></th>
        </tr></thead>
        <tbody>
          {titulos.map((t) => {
            const status = statusTitulo(t);
            return (
              <React.Fragment key={t.id}>
                <tr>
                  <td style={styles.td}>{t.descricao}</td>
                  <td style={styles.td}>{t.conta}</td>
                  <td style={styles.td}>{fmtDate(t.vencimento)}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>{fmt(t.valor)}</td>
                  <td style={styles.td}><span style={{ ...styles.statusPill, ...badgeEstilo[status] }}>{rotulo[status]}</span></td>
                  <td style={{ ...styles.td, whiteSpace: "nowrap" }}>
                    {!t.pago && (
                      <button style={styles.btnGhost} onClick={() => setBaixaAbertaId(baixaAbertaId === t.id ? null : t.id)}>dar baixa</button>
                    )}{" "}
                    <button style={styles.btnGhostDanger} onClick={() => onRemover(t.id)}>remover</button>
                  </td>
                </tr>
                {baixaAbertaId === t.id && (
                  <tr>
                    <td style={styles.td} colSpan={6}>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                        <div style={styles.field}>
                          <label style={styles.label}>Data do pagamento</label>
                          <input type="date" style={styles.input} value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Forma</label>
                          <select style={styles.input} value={forma} onChange={(e) => setForma(e.target.value)}>
                            {formasPagamento.map((f) => <option key={f.nome} value={f.nome}>{f.nome}</option>)}
                          </select>
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Banco</label>
                          <select style={styles.input} value={banco} onChange={(e) => setBanco(e.target.value)}>
                            {bancos.map((b) => <option key={b.nome} value={b.nome}>{b.nome}</option>)}
                          </select>
                        </div>
                        <button style={styles.btnPrimary} onClick={() => { onBaixa(t.id, dataPagamento, forma, banco); setBaixaAbertaId(null); }}>
                          Confirmar baixa (gera lançamento)
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {titulos.length === 0 && <tr><td style={styles.td} colSpan={6}>Nenhum título cadastrado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function NovoClienteForm({ onCriar }) {
  const [nome, setNome] = useState(""); const [cnpj, setCnpj] = useState("");
  const [regime, setRegime] = useState(REGIMES[0]); const [cidade, setCidade] = useState(""); const [obs, setObs] = useState("");
  return (
    <div style={styles.novoClienteBox}>
      <input style={styles.inputDark} placeholder="Nome do cliente" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input style={styles.inputDark} placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
      <select style={styles.inputDark} value={regime} onChange={(e) => setRegime(e.target.value)}>
        {REGIMES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <input style={styles.inputDark} placeholder="Cidade/UF" value={cidade} onChange={(e) => setCidade(e.target.value)} />
      <button style={styles.btnCriarCliente} onClick={() => onCriar(nome, cnpj, regime, cidade, obs)}>Criar cliente</button>
    </div>
  );
}
function KpiCard({ label, value, highlight }) {
  return (
    <div style={styles.kpiCard}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: highlight === false ? "#B91C1C" : "#050A30" }}>{value}</div>
    </div>
  );
}

const GOLD = "#C9974B", GOLD_LIGHT = "#DDB06B", NAVY = "#0B1B3F", CAIXA_BLUE = "#1D4ED8", COMPET_AMBER = "#B45309";

const styles = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#F7F6FB", minHeight: "100vh", color: NAVY },
  loadingScreen: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: NAVY, color: "#fff", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 15 },
  shell: { display: "flex", minHeight: "100vh" },
  sidebar: { width: 240, background: NAVY, padding: "18px 14px", display: "flex", flexDirection: "column", gap: 18, flexShrink: 0 },
  brand: { display: "flex", alignItems: "center", gap: 10, padding: "0 4px" },
  logoMark: { width: 36, height: 36, borderRadius: 9, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_LIGHT})`, color: NAVY, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 },
  brandName: { color: "#fff", fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 },
  brandSub: { color: "#9AA3C4", fontSize: 11 },
  clienteBox: { background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 },
  toolbarLabelLight: { fontSize: 10.5, color: "#9AA3C4", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 },
  clienteSelect: { padding: "7px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", fontSize: 12.5, background: "rgba(255,255,255,0.06)", color: "#fff" },
  btnNovoCliente: { background: "transparent", border: "none", color: GOLD_LIGHT, fontSize: 11.5, cursor: "pointer", textAlign: "left", padding: 0 },
  btnRemoverCliente: { background: "transparent", border: "none", color: "#E88484", fontSize: 11, cursor: "pointer", textAlign: "left", padding: 0 },
  novoClienteBox: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  inputDark: { padding: "7px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", fontSize: 12, background: "rgba(255,255,255,0.06)", color: "#fff" },
  btnCriarCliente: { background: GOLD, color: NAVY, border: "none", padding: "7px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" },
  sideNav: { display: "flex", flexDirection: "column", gap: 4 },
  sideNavBtn: { textAlign: "left", background: "transparent", border: "none", color: "#D9D6EE", padding: "10px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 500, display: "flex", flexDirection: "column", gap: 2 },
  sideNavBtnActive: { background: GOLD_LIGHT, color: NAVY, fontWeight: 700 },
  sideNavBtnDisabled: { color: "#5B5678", cursor: "not-allowed" },
  emBreve: { fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.4, color: "#7A7594" },
  btnLogout: { marginTop: "auto", background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#D9D6EE", padding: "9px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer" },
  contentArea: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 28px 0 28px", flexWrap: "wrap", gap: 10 },
  pageTitle: { fontSize: 19, fontWeight: 800, letterSpacing: 0.3, margin: 0, color: NAVY },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  toolbarLabel: { fontSize: 13, color: "#5B5678", fontWeight: 500 },
  select: { padding: "6px 10px", borderRadius: 6, border: "1px solid #D9D6EE", fontSize: 13, color: NAVY, background: "#fff" },
  regimeBadge: { fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, letterSpacing: 0.3 },
  regimeBadgeCaixa: { background: "#DBEAFE", color: CAIXA_BLUE },
  regimeBadgeCompetencia: { background: "#FEF3C7", color: COMPET_AMBER },
  subNav: { display: "flex", gap: 6, flexWrap: "wrap", padding: "16px 28px 0 28px" },
  subNavBtn: { background: "#fff", border: "1px solid #E7E4F2", color: "#5B5678", padding: "8px 14px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", fontWeight: 500 },
  subNavBtnActive: { background: GOLD, borderColor: GOLD, color: NAVY, fontWeight: 700 },
  main: { padding: "20px 28px 28px 28px", display: "flex", flexDirection: "column", gap: 20 },
  avisoErro: { background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B", padding: "10px 14px", borderRadius: 8, fontSize: 13 },
  card: { background: "#fff", borderRadius: 12, padding: 22, border: "1px solid #E7E4F2", boxShadow: "0 1px 3px rgba(11,27,63,0.04)" },
  cardTitle: { margin: "0 0 12px 0", fontSize: 16, fontWeight: 700, color: NAVY },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12, color: "#5B5678", fontWeight: 500 },
  input: { padding: "9px 10px", borderRadius: 7, border: "1px solid #D9D6EE", fontSize: 13, color: NAVY, background: "#FBFAFE" },
  inputSmall: { padding: "5px 6px", borderRadius: 6, border: "1px solid #D9D6EE", fontSize: 12, color: NAVY, background: "#FBFAFE", maxWidth: 190 },
  fileInput: { fontSize: 13, marginBottom: 8 },
  btnPrimary: { background: GOLD, color: NAVY, border: "none", padding: "10px 18px", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  btnSecondary: { background: "#FBF6EC", color: GOLD, border: "1px solid #E7DAC1", padding: "9px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnGhost: { background: "transparent", border: "none", color: GOLD, fontSize: 12, cursor: "pointer", textDecoration: "underline" },
  btnGhostDanger: { background: "transparent", border: "none", color: "#9B2C2C", fontSize: 12, cursor: "pointer", textDecoration: "underline" },
  errorText: { color: "#9B2C2C", fontSize: 13 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #E7E4F2", color: "#5B5678", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.3 },
  td: { padding: "9px 10px", borderBottom: "1px solid #F0EEF8" },
  planoBloco: { marginBottom: 18 },
  planoCatTitle: { color: GOLD, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 },
  planoLista: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  planoItem: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "#FBFAFE", borderRadius: 6, fontSize: 13 },
  demoSwitchRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 6 },
  demoSwitch: { display: "flex", gap: 4, background: "#FBF6EC", borderRadius: 8, padding: 3 },
  demoSwitchBtn: { border: "none", background: "transparent", color: "#5B5678", fontSize: 12.5, fontWeight: 600, padding: "7px 14px", borderRadius: 6, cursor: "pointer" },
  demoSwitchBtnCaixa: { background: CAIXA_BLUE, color: "#fff" },
  demoSwitchBtnCompetencia: { background: COMPET_AMBER, color: "#fff" },
  demoTable: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  demoSectionRow: { color: GOLD, fontWeight: 700, fontSize: 12.5, textTransform: "uppercase", letterSpacing: 0.3, paddingTop: 14 },
  demoLineLabel: { padding: "5px 10px 5px 20px", color: "#3A3660" },
  demoLineVal: { padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: NAVY },
  demoSubtotal: { fontWeight: 700, borderTop: "1px solid #E7E4F2", borderBottom: "1px solid #E7E4F2", background: "#FAF9FD" },
  demoTotal: { fontWeight: 700, background: "#FBF6EC", color: GOLD },
  demoFinal: { fontWeight: 800, fontSize: 15, background: NAVY, color: "#fff" },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  kpiCard: { background: "#FBFAFE", border: "1px solid #E7E4F2", borderRadius: 10, padding: "16px 14px" },
  kpiCardWide: { background: "#FBFAFE", border: "1px solid #E7E4F2", borderRadius: 10, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 6 },
  statusPill: { fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20, display: "inline-block", width: "fit-content" },
  statusPillOk: { background: "#DCFCE7", color: "#166534" },
  statusPillAlert: { background: "#FEE2E2", color: "#991B1B" },
  statusPillNeutro: { background: "#E0E7FF", color: "#3730A3" },
  kpiLabel: { fontSize: 12, color: "#5B5678", marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: 800 },
  note: { fontSize: 12.5, color: "#7A7594", marginTop: 4, marginBottom: 12, lineHeight: 1.5 },
  footer: { textAlign: "center", padding: "16px 10px", fontSize: 11.5, color: "#9B96B8" },
};
