-- ============================================================
-- CB Contabilidade Estratégica — ERP Financeiro
-- Schema para o Supabase (rode isso no SQL Editor do seu projeto)
-- ============================================================

-- Tabela única de armazenamento chave-valor.
-- Cada "chave" guarda um pedaço dos dados do sistema (lista de clientes,
-- configuração de um cliente, lançamentos de um cliente, etc.), do mesmo
-- jeito que já validamos no protótipo — só que agora persistido de
-- verdade em Postgres, com Row Level Security.
create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table kv_store enable row level security;

-- Qualquer usuário autenticado (== membro da equipe que fez login)
-- pode ler e escrever. Isso reflete o requisito original: "a equipe
-- compartilha a mesma base de clientes".
create policy "equipe le tudo"
  on kv_store for select
  using (auth.role() = 'authenticated');

create policy "equipe insere"
  on kv_store for insert
  with check (auth.role() = 'authenticated');

create policy "equipe atualiza"
  on kv_store for update
  using (auth.role() = 'authenticated');

create policy "equipe apaga"
  on kv_store for delete
  using (auth.role() = 'authenticated');

-- ============================================================
-- Próximo passo depois de rodar isso:
-- 1. Vá em Authentication > Providers e confirme que "Email" está ativado.
-- 2. Em Authentication > Users, crie o primeiro usuário da equipe manualmente
--    (ou deixe o cadastro pela própria tela de login do app, se preferir).
-- 3. Copie a Project URL e a anon public key (em Settings > API) —
--    você vai colar isso nas variáveis de ambiente do Vercel.
-- ============================================================
