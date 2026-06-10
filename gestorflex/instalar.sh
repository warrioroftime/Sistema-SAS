#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Instalador do GestorFlex para Linux (máquina zerada)
# Instala o Docker (se faltar), sobe banco + API + site e prepara
# o banco automaticamente.
#   Uso:  chmod +x instalar.sh && ./instalar.sh
# ──────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

echo "================================================"
echo "   Instalador GestorFlex  (Linux / Docker)"
echo "================================================"

# ── sudo (se não for root) ────────────────────────────────────
if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
  echo "⚠ Sem 'sudo' e sem ser root: a instalação do Docker pode falhar."
fi

# ── garante curl ──────────────────────────────────────────────
ensure_curl() {
  command -v curl >/dev/null 2>&1 && return 0
  echo "▶ Instalando curl..."
  if   command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -y && $SUDO apt-get install -y curl
  elif command -v dnf     >/dev/null 2>&1; then $SUDO dnf install -y curl
  elif command -v yum     >/dev/null 2>&1; then $SUDO yum install -y curl
  elif command -v pacman  >/dev/null 2>&1; then $SUDO pacman -Sy --noconfirm curl
  elif command -v zypper  >/dev/null 2>&1; then $SUDO zypper install -y curl
  elif command -v apk     >/dev/null 2>&1; then $SUDO apk add --no-cache curl
  fi
}

# ── instala o Docker ──────────────────────────────────────────
install_docker() {
  echo "▶ Docker não encontrado. Instalando..."
  # 1) script oficial (cobre Ubuntu/Debian/Fedora/CentOS/RHEL/SLES...)
  if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh 2>/dev/null; then
    if $SUDO sh /tmp/get-docker.sh; then return 0; fi
  fi
  # 2) fallback por gerenciador de pacotes (ex.: Arch, Alpine)
  if   command -v pacman >/dev/null 2>&1; then $SUDO pacman -Sy --noconfirm docker docker-compose && return 0
  elif command -v apk    >/dev/null 2>&1; then $SUDO apk add --no-cache docker docker-cli-compose && return 0
  elif command -v zypper >/dev/null 2>&1; then $SUDO zypper install -y docker docker-compose && return 0
  fi
  return 1
}

# ── inicia o serviço do Docker ────────────────────────────────
start_docker() {
  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl enable --now docker 2>/dev/null || true
  elif command -v rc-service >/dev/null 2>&1; then
    $SUDO rc-service docker start 2>/dev/null || true
  elif command -v service >/dev/null 2>&1; then
    $SUDO service docker start 2>/dev/null || true
  fi
}

ensure_curl

if ! command -v docker >/dev/null 2>&1; then
  if ! install_docker; then
    echo "❌ Não consegui instalar o Docker automaticamente."
    echo "   Instale manualmente: https://docs.docker.com/engine/install/"
    exit 1
  fi
  # permite usar docker sem sudo nas próximas vezes
  [ -n "$SUDO" ] && $SUDO usermod -aG docker "$USER" 2>/dev/null || true
  echo "✅ Docker instalado."
fi

start_docker

# ── descobre como chamar o docker (com ou sem sudo) ───────────
if docker info >/dev/null 2>&1; then
  DOCKER="docker"
elif [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
else
  # dá um tempo para o daemon subir e tenta de novo
  sleep 5
  if docker info >/dev/null 2>&1; then DOCKER="docker"
  elif [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"
  else
    echo "❌ O serviço do Docker não está acessível. Inicie-o e rode novamente."
    exit 1
  fi
fi

# ── descobre o comando do Compose ─────────────────────────────
if $DOCKER compose version >/dev/null 2>&1; then
  COMPOSE="$DOCKER compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="${SUDO:+$SUDO }docker-compose"
else
  echo "❌ Docker Compose não encontrado."
  exit 1
fi

# ── build + subir tudo ────────────────────────────────────────
echo ""
echo "▶ Construindo e iniciando os containers (banco, API e site)..."
$COMPOSE up -d --build

# ── aguarda a API responder (o backend prepara o banco) ───────
echo ""
echo "⏳ Preparando o banco e iniciando os serviços (pode levar ~1-2 min na 1ª vez)..."
ready=0
for i in $(seq 1 80); do
  if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 3
done

echo ""
if [ "$ready" = "1" ]; then
  echo "✅ GestorFlex no ar!"
  echo "   ────────────────────────────────────────"
  echo "   🌐 Site:  http://localhost:5500"
  echo "   🔌 API:   http://localhost:3001"
  echo "   👤 Login: admin@gestorflex.com / admin123"
  echo "   ────────────────────────────────────────"
  echo "   Para parar:  ./parar.sh"
  [ -n "$SUDO" ] && echo "   (Dica: se instalou o Docker agora, saia e entre na sessão para usar sem sudo.)"
else
  echo "⚠ Containers iniciados, mas a API ainda não respondeu."
  echo "   Acompanhe os logs:  $COMPOSE logs -f backend"
fi
