# GestorFlex no Linux

Funciona em **máquina zerada**: o instalador instala o Docker se faltar.
Não precisa instalar Node, SQL Server nem ODBC — tudo roda em containers.

## 🚀 Instalação automática (recomendado)

Na pasta `gestorflex/`:

```bash
chmod +x instalar.sh parar.sh
./instalar.sh
```

O instalador:
1. **Instala o Docker** automaticamente se não houver (pode pedir a senha do `sudo`)
2. Inicia o serviço do Docker
3. Sobe **banco + API + site** em containers (`docker compose up -d --build`)
4. Cria o banco e aplica `schema.sql` + todas as `migrations/` automaticamente
5. Espera ficar no ar e mostra os endereços

> Distros cobertas: Ubuntu, Debian, Fedora, CentOS/RHEL, openSUSE, Arch e Alpine.
> Se o Docker for instalado na hora, talvez precise **sair e entrar na sessão**
> (logout/login) para usá-lo sem `sudo` nas próximas vezes.

Ao terminar:

```
🌐 Site:  http://localhost:5500
🔌 API:   http://localhost:3001
👤 Login: admin@gestorflex.com / admin123
```

> Acessando de outra máquina? Troque `localhost` pelo IP do servidor
> (ex.: `http://192.168.0.10:5500`). A API é detectada automaticamente pelo
> mesmo host. Garanta que as portas **5500** e **3001** estejam liberadas.

### Comandos úteis
```bash
./parar.sh                       # para tudo (mantém os dados)
docker compose logs -f backend   # ver logs da API
docker compose up -d --build     # reconstruir após mudanças no código
docker compose down -v           # apagar TUDO, inclusive o banco
```

> Em ARM (ex.: Apple Silicon), edite o `docker-compose.yml` e troque a imagem do
> `db` por `mcr.microsoft.com/azure-sql-edge:latest`.

---

## 🔧 Instalação manual (sem conteinerizar a aplicação)

Se preferir rodar só o **banco** em Docker e a aplicação direto no host (precisa de Node 18+):

```bash
cd gestorflex
docker compose up -d db               # só o banco
cd backend
cp .env.example .env                  # já vem pronto p/ o Docker
npm install
npm run setup:db                      # cria banco + schema + migrations
npm start                             # API na 3001
# em outro terminal:
cd ../frontend && node serve.js       # site na 5500
```

---

### Observações
- O driver `tedious` (JS puro) é usado no Linux — **sem ODBC**.
- No **Windows** nada muda: sem `DB_DRIVER`, usa `msnodesqlv8` + `.\SQLEXPRESS`.
- Os dados do banco ficam num **volume Docker** (`gestorflex-data`) e persistem
  entre reinícios. Só são apagados com `docker compose down -v`.
- Em produção, troque `JWT_SECRET` e restrinja `CORS_ORIGIN` no `docker-compose.yml`.
