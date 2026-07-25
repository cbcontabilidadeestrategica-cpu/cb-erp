# CB Contabilidade Estratégica — ERP Financeiro

Projeto React (Vite) com Supabase (banco Postgres + autenticação real) e deploy no Vercel.

## Passo 1 — Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com), crie uma conta (tem plano gratuito) e clique em **New Project**.
2. Escolha um nome, senha do banco e região. Aguarde a criação (leva ~2 min).
3. No menu lateral, vá em **SQL Editor** → **New query**, cole o conteúdo do arquivo
   `supabase_schema.sql` (está na raiz deste projeto) e clique em **Run**.
4. Vá em **Authentication → Providers** e confirme que o provedor **Email** está habilitado
   (vem habilitado por padrão).
   - Opcional: em **Authentication → Settings**, você pode desativar "Confirm email" se
     quiser que a equipe consiga entrar assim que criar a conta, sem clicar em link de e-mail.
5. Vá em **Settings → API** e copie dois valores:
   - **Project URL**
   - **anon public key**

## Passo 2 — Configurar as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto (copie de `.env.example`) e cole os valores do Supabase:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-public-key-aqui
```

## Passo 3 — Testar localmente (opcional, mas recomendado)

Precisa do [Node.js](https://nodejs.org) instalado.

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal (geralmente `http://localhost:5173`).
Crie sua conta pela própria tela de login do app.

## Passo 4 — Subir para o Vercel

**Opção A — via GitHub (recomendado):**
1. Suba esta pasta para um repositório novo no GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe esse repositório.
3. O Vercel detecta automaticamente que é um projeto Vite — não precisa mexer em nada
   nas configurações de build.
4. Antes de clicar em "Deploy", adicione as **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (os mesmos valores do seu `.env`)
5. Clique em **Deploy**. Em ~1 minuto o link estará no ar.

**Opção B — via linha de comando:**
```bash
npm install -g vercel
vercel login
vercel
```
Quando perguntado, informe as mesmas variáveis de ambiente (ou configure depois em
Project Settings → Environment Variables no painel do Vercel, e rode `vercel --prod` de novo).

## Passo 5 — Criar os usuários da equipe

Cada pessoa da equipe pode criar a própria conta pela tela de login ("Ainda não tem conta?
Criar uma"). Todos que fizerem login válido enxergam e editam a mesma base de clientes —
é assim que o requisito "equipe compartilha a mesma base" foi implementado.

Se preferir controlar quem entra, crie os usuários manualmente em
**Supabase → Authentication → Users → Add user**, em vez de deixar o cadastro aberto.

## Como os dados são guardados

Por simplicidade e para minimizar risco de bugs na conversão, os dados continuam no mesmo
formato validado no protótipo (JSON por cliente), só que agora guardados numa tabela real do
Postgres (`kv_store`) protegida por Row Level Security — só usuários autenticados leem/escrevem.
Isso significa: multi-cliente, multi-usuário, dados compartilhados pela equipe, tudo com login
de verdade e protegido por Row Level Security. Não é o modelo relacional "ideal" de um ERP
maduro (tabelas separadas por entidade, foreign keys, índices), mas é uma base real e pronta
para produção **interna**. Se este sistema virar produto cobrado no futuro, vale revisitar o
schema com um desenvolvedor.

## Estrutura do projeto

```
├── supabase_schema.sql   # rode isso no SQL Editor do Supabase
├── src/
│   ├── main.jsx          # entrada da aplicação + verificação de login
│   ├── Login.jsx         # tela de login/cadastro
│   ├── App.jsx           # o ERP inteiro (lançamentos, DFC/DRG, estoque, etc.)
│   ├── storage.js        # camada que fala com o Supabase (Postgres)
│   └── supabaseClient.js # conexão com o Supabase
├── .env.example
└── package.json
```
