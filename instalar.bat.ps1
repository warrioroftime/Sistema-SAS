# =============================================================
#  GestorFlex — Instalador para Windows
#  Execute com: powershell -ExecutionPolicy Bypass -File instalar.ps1
# =============================================================

$ErrorActionPreference = 'Stop'
Set-ExecutionPolicy Bypass -Scope Process -Force

# ── Cores / helpers ──────────────────────────────────────────
function Write-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║        GestorFlex — Instalador               ║" -ForegroundColor Cyan
    Write-Host "  ║        Sistema de Gestão Empresarial         ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($n, $msg) {
    Write-Host ""
    Write-Host "  [$n] $msg" -ForegroundColor Yellow
    Write-Host "  $('─' * 52)" -ForegroundColor DarkGray
}

function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green  }
function Write-WARN($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-ERR($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red    }
function Write-INFO($msg) { Write-Host "       $msg" -ForegroundColor Gray   }

function Pause-AndExit($code) {
    Write-Host ""
    Write-Host "  Pressione ENTER para sair..." -ForegroundColor DarkGray
    Read-Host | Out-Null
    exit $code
}

function Ask($prompt, $default) {
    $resp = Read-Host "       $prompt [$default]"
    if ([string]::IsNullOrWhiteSpace($resp)) { return $default }
    return $resp.Trim()
}

function Ask-Password($prompt) {
    $resp = Read-Host "       $prompt" -AsSecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($resp)
    )
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Wait-Service($serviceName, $timeoutSec) {
    Write-INFO "Aguardando serviço '$serviceName' iniciar..."
    $elapsed = 0
    while ($elapsed -lt $timeoutSec) {
        try {
            $svc = Get-Service -Name $serviceName -ErrorAction Stop
            if ($svc.Status -eq "Running") { return $true }
        } catch {}
        Start-Sleep -Seconds 3
        $elapsed += 3
        Write-Host "." -NoNewline -ForegroundColor DarkGray
    }
    Write-Host ""
    return $false
}

# ── Detecta instância SQL Server instalada ────────────────────
function Get-SqlInstance {
    # Procura serviços SQL Server ativos
    $services = Get-Service | Where-Object { $_.Name -match '^MSSQL\$' -or $_.Name -eq 'MSSQLSERVER' }
    foreach ($svc in $services) {
        if ($svc.Name -eq 'MSSQLSERVER') { return '.' }
        $inst = $svc.Name -replace '^MSSQL\$', ''
        return ".\$inst"
    }
    return $null
}

# ── Habilita modo misto (SA) via registro ─────────────────────
function Enable-MixedMode($instanceSuffix) {
    # instanceSuffix: "SQLEXPRESS" ou vazio para default
    $regRoot = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server"
    $key = Get-ChildItem $regRoot -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match "MSSQL\d+\.$instanceSuffix" } |
           Select-Object -First 1
    if (-not $key) {
        # Tenta sem versão
        $key = Get-ChildItem $regRoot -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -match "MSSQL\d+" } |
               Select-Object -First 1
    }
    if ($key) {
        $mssqlPath = Join-Path $key.PSPath "MSSQLServer"
        if (Test-Path $mssqlPath) {
            Set-ItemProperty -Path $mssqlPath -Name "LoginMode" -Value 2 -ErrorAction SilentlyContinue
            return $true
        }
    }
    return $false
}

# ── Habilita TCP/IP via registro ──────────────────────────────
function Enable-TcpIp($instanceSuffix) {
    $regRoot = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server"
    $key = Get-ChildItem $regRoot -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match "MSSQL\d+\.$instanceSuffix" } |
           Select-Object -First 1
    if ($key) {
        $tcpPath = Join-Path $key.PSPath "MSSQLServer\SuperSocketNetLib\Tcp"
        if (Test-Path $tcpPath) {
            Set-ItemProperty -Path $tcpPath -Name "Enabled" -Value 1 -ErrorAction SilentlyContinue
            return $true
        }
    }
    return $false
}

# ══════════════════════════════════════════════════════════════
Write-Header

Write-Host "  Este instalador irá:" -ForegroundColor White
Write-Host "    • Verificar / instalar Node.js" -ForegroundColor Gray
Write-Host "    • Verificar / instalar SQL Server 2022 Express" -ForegroundColor Gray
Write-Host "    • Copiar os arquivos do sistema" -ForegroundColor Gray
Write-Host "    • Instalar dependências (npm install)" -ForegroundColor Gray
Write-Host "    • Criar o banco de dados GestorFlex" -ForegroundColor Gray
Write-Host "    • Criar atalhos na Área de Trabalho" -ForegroundColor Gray
Write-Host ""

# Verifica admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if (-not $isAdmin) {
    Write-WARN "Execute como Administrador para melhor compatibilidade."
    Write-INFO "(Botão direito no arquivo → Executar como Administrador)"
    $cont = Read-Host "       Continuar mesmo assim? (S/N)"
    if ($cont -notmatch '^[Ss]') { exit 0 }
}

$confirm = Read-Host "  Deseja continuar? (S/N)"
if ($confirm -notmatch '^[Ss]') { exit 0 }

# ── PASSO 1 — Diretório de instalação ────────────────────────
Write-Step 1 "Diretório de instalação"

$defaultDir = "C:\GestorFlex"
$installDir = Ask "Diretório de instalação" $defaultDir

if (Test-Path $installDir) {
    Write-WARN "O diretório '$installDir' já existe."
    $over = Read-Host "       Sobrescrever? (S/N)"
    if ($over -notmatch '^[Ss]') { Write-ERR "Instalação cancelada."; Pause-AndExit 1 }
}

# ── PASSO 2 — Node.js ─────────────────────────────────────────
Write-Step 2 "Verificando Node.js"

$nodeOk = $false
try {
    $nodeVer = & node --version 2>$null
    if ($nodeVer -match 'v(\d+)' -and [int]$Matches[1] -ge 18) {
        Write-OK "Node.js $nodeVer encontrado."
        $nodeOk = $true
    } else {
        Write-WARN "Node.js $nodeVer desatualizado (mínimo v18)."
    }
} catch {}

if (-not $nodeOk) {
    Write-INFO "Instalando Node.js LTS via winget..."
    try {
        & winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        Refresh-Path
        $nodeVer = & node --version 2>$null
        Write-OK "Node.js $nodeVer instalado."
    } catch {
        Write-ERR "Falha ao instalar Node.js automaticamente."
        Write-INFO "Instale manualmente em https://nodejs.org e re-execute este instalador."
        Pause-AndExit 1
    }
}

# ── PASSO 3 — SQL Server ──────────────────────────────────────
Write-Step 3 "Verificando SQL Server"

$sqlInstance = Get-SqlInstance
$sqlInstalled = $sqlInstance -ne $null

if ($sqlInstalled) {
    Write-OK "SQL Server encontrado: $sqlInstance"
} else {
    Write-WARN "SQL Server não encontrado. Iniciando instalação automática..."
    Write-INFO "Isso pode levar 5-15 minutos dependendo da sua internet."
    Write-Host ""

    # Pede senha para o SA antes de instalar
    Write-INFO "Defina uma senha para o usuário administrador (SA) do SQL Server:"
    do {
        $saPwd = Ask-Password "Senha do SA (mínimo 8 caracteres, letras e números)"
        if ($saPwd.Length -lt 8) { Write-WARN "Senha muito curta. Tente novamente." }
    } while ($saPwd.Length -lt 8)

    Write-INFO "Baixando SQL Server 2022 Express (~300 MB)..."

    $sqlTempDir = "$env:TEMP\GFSQLInstall"
    New-Item -ItemType Directory -Force -Path $sqlTempDir | Out-Null

    # Download do instalador web do SQL Server 2022 Express
    $webInstallerUrl = "https://go.microsoft.com/fwlink/p/?linkid=2216019&clcid=0x416"
    $webInstallerPath = "$sqlTempDir\SQL2022-SSEI-Expr.exe"

    try {
        Write-INFO "Baixando instalador web..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $webInstallerUrl -OutFile $webInstallerPath -UseBasicParsing
        Write-OK "Download concluído."
    } catch {
        Write-ERR "Falha ao baixar o instalador do SQL Server: $_"
        Write-INFO "Verifique sua conexão com a internet e tente novamente."
        Pause-AndExit 1
    }

    Write-INFO "Baixando pacote completo do SQL Server Express..."
    try {
        # Usa o web installer para baixar o pacote completo
        $process = Start-Process -FilePath $webInstallerPath `
            -ArgumentList "/DOWNLOAD /QUIET /NOPROMPT /DOWNLOADPATH:`"$sqlTempDir`"" `
            -Wait -PassThru -NoNewWindow
        Write-OK "Pacote baixado em $sqlTempDir"
    } catch {
        Write-ERR "Falha ao baixar pacote completo: $_"
        Pause-AndExit 1
    }

    # Encontra o instalador baixado
    $sqlExe = Get-ChildItem $sqlTempDir -Filter "SQLEXPR*.exe" | Select-Object -First 1
    if (-not $sqlExe) {
        $sqlExe = Get-ChildItem $sqlTempDir -Filter "*.exe" | Where-Object { $_.Name -ne "SQL2022-SSEI-Expr.exe" } | Select-Object -First 1
    }

    if (-not $sqlExe) {
        Write-ERR "Instalador do SQL Server não encontrado em $sqlTempDir"
        Pause-AndExit 1
    }

    Write-INFO "Instalando SQL Server 2022 Express silenciosamente..."
    Write-INFO "(Aguarde, isso pode levar alguns minutos...)"

    $sqlArgs = @(
        "/Q",
        "/IACCEPTSQLSERVERLICENSETERMS",
        "/ACTION=Install",
        "/FEATURES=SQLEngine",
        "/INSTANCENAME=SQLEXPRESS",
        "/SECURITYMODE=SQL",
        "/SAPWD=`"$saPwd`"",
        "/TCPENABLED=1",
        "/SQLSYSADMINACCOUNTS=`"BUILTIN\Administrators`"",
        "/NPENABLED=1",
        "/HIDECONSOLE"
    )

    try {
        $proc = Start-Process -FilePath $sqlExe.FullName -ArgumentList $sqlArgs -Wait -PassThru -NoNewWindow
        if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
            Write-ERR "Instalação retornou código $($proc.ExitCode)."
            Write-INFO "Verifique os logs em C:\Program Files\Microsoft SQL Server\160\Setup Bootstrap\Log"
            Pause-AndExit 1
        }
        Write-OK "SQL Server 2022 Express instalado."
    } catch {
        Write-ERR "Erro na instalação do SQL Server: $_"
        Pause-AndExit 1
    }

    # Limpa temporários
    Remove-Item $sqlTempDir -Recurse -Force -ErrorAction SilentlyContinue

    # Aguarda serviço iniciar
    $started = Wait-Service "MSSQL`$SQLEXPRESS" 90
    if (-not $started) { Write-WARN "Serviço demorou a iniciar. Continuando mesmo assim..." }

    $sqlInstance = ".\SQLEXPRESS"
    $dbUser      = "sa"
    $dbPassword  = $saPwd
    Write-OK "SQL Server pronto em $sqlInstance"

    # Reinicia o serviço para garantir que o modo misto está ativo
    try {
        Restart-Service -Name "MSSQL`$SQLEXPRESS" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 5
    } catch {}
}

# ── PASSO 4 — Credenciais do banco ───────────────────────────
Write-Step 4 "Configuração do banco de dados"

if (-not $dbUser) {
    Write-INFO "Instância detectada: $sqlInstance"
    Write-Host ""
    $dbServer   = Ask "Servidor SQL Server" $sqlInstance
    $dbName     = Ask "Nome do banco"       "GestorFlex"
    $dbUser     = Ask "Usuário SQL"         "sa"
    $dbPassword = Ask-Password "Senha do SA"
} else {
    $dbServer = $sqlInstance
    $dbName   = "GestorFlex"
    Write-INFO "Usando: $dbServer | Banco: $dbName | Usuário: $dbUser"
}

# Instala sqlcmd se não estiver disponível
$sqlcmdOk = $false
try { & sqlcmd -? 2>$null | Out-Null; $sqlcmdOk = $true } catch {}
if (-not $sqlcmdOk) {
    Write-INFO "Instalando utilitário sqlcmd..."
    try {
        & winget install --id Microsoft.SqlServer.CommandLineUtilities --silent --accept-package-agreements --accept-source-agreements
        Refresh-Path
        Write-OK "sqlcmd instalado."
    } catch {
        Write-WARN "Não foi possível instalar sqlcmd via winget. Tentando continuar..."
    }
}

# Testa conexão
Write-INFO "Testando conexão com o SQL Server..."
$maxRetries = 5
$connected  = $false
for ($i = 1; $i -le $maxRetries; $i++) {
    try {
        $testOut = & sqlcmd -S $dbServer -U $dbUser -P $dbPassword -Q "SELECT 1" -b 2>&1
        if ($LASTEXITCODE -eq 0) { $connected = $true; break }
    } catch {}
    if ($i -lt $maxRetries) {
        Write-INFO "Tentativa $i/$maxRetries falhou. Aguardando 5s..."
        Start-Sleep -Seconds 5
    }
}

if (-not $connected) {
    Write-WARN "Não foi possível conectar ao SQL Server."
    Write-INFO "Verifique se o serviço está rodando e as credenciais estão corretas."
    $cont = Read-Host "       Continuar mesmo assim? (S/N)"
    if ($cont -notmatch '^[Ss]') { Pause-AndExit 1 }
} else {
    Write-OK "Conexão estabelecida com sucesso."
}

# ── PASSO 5 — Copiar arquivos ─────────────────────────────────
Write-Step 5 "Copiando arquivos do sistema"

$sourceDir = $PSScriptRoot
Write-INFO "Origem : $sourceDir"
Write-INFO "Destino: $installDir"

New-Item -ItemType Directory -Force -Path "$installDir\gestorflex\backend\src\routes"    | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\gestorflex\backend\src\middleware" | Out-Null
New-Item -ItemType Directory -Force -Path "$installDir\gestorflex\frontend"               | Out-Null

# Copia backend (sem node_modules e .env)
$backendSrc = "$sourceDir\gestorflex\backend"
$backendDst = "$installDir\gestorflex\backend"

Get-ChildItem $backendSrc -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.Name -ne '.env' -and
    $_.Name -ne '__serve.js'
} | ForEach-Object {
    $rel    = $_.FullName.Substring($backendSrc.Length + 1)
    $dst    = Join-Path $backendDst $rel
    $dstDir = Split-Path $dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    Copy-Item $_.FullName -Destination $dst -Force
}

Copy-Item "$sourceDir\gestorflex\frontend\index.html" -Destination "$installDir\gestorflex\frontend\index.html" -Force
Write-OK "Arquivos copiados."

# ── PASSO 6 — npm install ─────────────────────────────────────
Write-Step 6 "Instalando dependências do backend (npm install)"
Write-INFO "Isso pode levar alguns minutos..."

Push-Location "$installDir\gestorflex\backend"
try {
    & npm install 2>&1 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { throw "npm install retornou erro." }
    Write-OK "Dependências instaladas."
} catch {
    Write-ERR "Erro no npm install: $_"
    Pop-Location
    Pause-AndExit 1
}
Pop-Location

# ── PASSO 7 — Criar banco e executar schema ───────────────────
Write-Step 7 "Criando banco de dados e tabelas"

$createDb = "IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'$dbName') CREATE DATABASE [$dbName];"
& sqlcmd -S $dbServer -U $dbUser -P $dbPassword -Q $createDb -b 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-OK "Banco '$dbName' verificado/criado."
} else {
    Write-ERR "Não foi possível criar o banco de dados."
    Pause-AndExit 1
}

$schemaFile = "$installDir\gestorflex\backend\schema.sql"
Write-INFO "Executando schema.sql..."
& sqlcmd -S $dbServer -U $dbUser -P $dbPassword -d $dbName -i $schemaFile -b 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-WARN "Aviso no schema (pode ser normal se tabelas já existirem)."
} else {
    Write-OK "Schema executado com sucesso."
}

# ── PASSO 8 — Criar .env ──────────────────────────────────────
Write-Step 8 "Gerando arquivo de configuração (.env)"

$jwtSecret = -join ((65..90)+(97..122)+(48..57) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

$envContent = @"
# GestorFlex - Configuração gerada pelo instalador
PORT=3001
NODE_ENV=production

DB_SERVER=$dbServer
DB_PORT=
DB_NAME=$dbName
DB_USER=$dbUser
DB_PASSWORD=$dbPassword
DB_ENCRYPT=false
DB_TRUST_CERT=true

JWT_SECRET=$jwtSecret
JWT_EXPIRES_IN=8h

CORS_ORIGIN=http://localhost:5500
"@

Set-Content -Path "$installDir\gestorflex\backend\.env" -Value $envContent -Encoding UTF8
Write-OK ".env criado."

# ── PASSO 9 — Servidor frontend ───────────────────────────────
Write-Step 9 "Criando servidor do frontend"

$serveJs = @'
const http = require('http');
const fs   = require('fs');
const path = require('path');
const dir  = __dirname;
const mime = {
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
  '.svg':'image/svg+xml','.ico':'image/x-icon',
  '.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'
};
http.createServer((req, res) => {
  const p = path.join(dir, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(5500, () => console.log('Frontend: http://localhost:5500'));
'@

Set-Content -Path "$installDir\gestorflex\frontend\serve.js" -Value $serveJs -Encoding UTF8
Write-OK "Servidor frontend criado."

# ── PASSO 10 — Scripts iniciar / parar ───────────────────────
Write-Step 10 "Criando scripts de iniciar e parar"

$iniciarBat = @"
@echo off
title GestorFlex
echo.
echo   Iniciando GestorFlex...
echo.
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
start "GestorFlex Backend"  /min cmd /c "cd /d ""%ROOT%\gestorflex\backend""  && node src/app.js"
timeout /t 4 /nobreak > nul
start "GestorFlex Frontend" /min cmd /c "cd /d ""%ROOT%\gestorflex\frontend"" && node serve.js"
timeout /t 3 /nobreak > nul
start http://localhost:5500
echo   [OK] Sistema iniciado em http://localhost:5500
echo.
pause
"@

$pararBat = @"
@echo off
echo   Encerrando GestorFlex...
taskkill /FI "WINDOWTITLE eq GestorFlex Backend*"  /F /T > nul 2>&1
taskkill /FI "WINDOWTITLE eq GestorFlex Frontend*" /F /T > nul 2>&1
echo   [OK] Servidores encerrados.
timeout /t 2 /nobreak > nul
"@

Set-Content -Path "$installDir\iniciar.bat" -Value $iniciarBat -Encoding Default
Set-Content -Path "$installDir\parar.bat"   -Value $pararBat   -Encoding Default
Write-OK "iniciar.bat e parar.bat criados."

# ── PASSO 11 — Atalhos na Área de Trabalho ────────────────────
Write-Step 11 "Criando atalhos na Área de Trabalho"

$desktop = [Environment]::GetFolderPath("Desktop")
$wsh     = New-Object -ComObject WScript.Shell

$lnk = $wsh.CreateShortcut("$desktop\GestorFlex - Iniciar.lnk")
$lnk.TargetPath       = "$installDir\iniciar.bat"
$lnk.WorkingDirectory = $installDir
$lnk.Description      = "Iniciar o sistema GestorFlex"
$lnk.Save()

$lnk2 = $wsh.CreateShortcut("$desktop\GestorFlex - Parar.lnk")
$lnk2.TargetPath       = "$installDir\parar.bat"
$lnk2.WorkingDirectory = $installDir
$lnk2.Description      = "Parar os servidores GestorFlex"
$lnk2.Save()

Write-OK "Atalhos criados na Área de Trabalho."

# ── Conclusão ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║     Instalação concluída com sucesso!        ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Instalado em : $installDir"      -ForegroundColor White
Write-Host "  Frontend     : http://localhost:5500" -ForegroundColor Cyan
Write-Host "  Backend      : http://localhost:3001" -ForegroundColor Cyan
Write-Host "  Banco        : $dbServer / $dbName"  -ForegroundColor Cyan
Write-Host ""
Write-Host "  Use o atalho 'GestorFlex - Iniciar' na Área de Trabalho para abrir o sistema." -ForegroundColor Gray
Write-Host ""

$iniciar = Read-Host "  Deseja iniciar o sistema agora? (S/N)"
if ($iniciar -match '^[Ss]') {
    Start-Process "$installDir\iniciar.bat"
}

Pause-AndExit 0
