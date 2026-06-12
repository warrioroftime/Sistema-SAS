# migrate-sqlserver-to-pg.ps1
# Migrates data from SQL Server Express to PostgreSQL

$SQLSERVER  = "localhost\SQLEXPRESS"
$SQLDB      = "GestorFlex"
$PGHOST     = "localhost"
$PGPORT     = "5432"
$PGDB       = "gestorflex"
$PGUSER     = "postgres"
$env:PGPASSWORD = "Server123!"
$PSQL = "C:\Program Files\PostgreSQL\17\bin\psql.exe"

function Exec-PG($sql) {
    $sql | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB -c $sql 2>&1
}

function Run-PG($sql) {
    $sql | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
}

function Sq($val) {
    if ($null -eq $val -or $val.ToString().Trim() -eq 'NULL') { return 'NULL' }
    $s = $val.ToString().Replace("'", "''")
    return "'$s'"
}

function Num($val) {
    if ($null -eq $val -or $val.ToString().Trim() -eq '' -or $val.ToString().Trim() -eq 'NULL') { return 'NULL' }
    return $val.ToString().Trim()
}

function Bool($val) {
    $v = $val.ToString().Trim()
    if ($v -eq '1' -or $v -eq 'true' -or $v -eq 'True') { return 'TRUE' }
    if ($v -eq '0' -or $v -eq 'false' -or $v -eq 'False') { return 'FALSE' }
    return 'NULL'
}

function Ts($val) {
    $v = $val.ToString().Trim()
    if ($v -eq '' -or $v -eq 'NULL') { return 'NULL' }
    return "'$v'"
}

function Get-SS($sql) {
    $output = sqlcmd -S $SQLSERVER -E -d $SQLDB -W -s "|" -h -1 -Q $sql 2>&1
    $rows = @()
    foreach ($line in $output) {
        $l = $line.ToString().Trim()
        if ($l -eq '' -or $l -match '^\(' -or $l -match '^---') { continue }
        $rows += $l
    }
    return $rows
}

Write-Host "=== Migracao SQL Server -> PostgreSQL ===" -ForegroundColor Cyan
Write-Host ""

# ─── GRUPOS (Categorias) ───
Write-Host "Migrando Categorias/Grupos..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, nome, descricao, criado_em FROM Categorias"
$inserts = @("TRUNCATE grupos CASCADE;", "ALTER SEQUENCE grupos_id_seq RESTART WITH 1;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 3) { continue }
    $id=$f[0].Trim(); $emp=$f[1].Trim(); $nome=Sq $f[2]; $desc=Sq $f[3]; $crt=Ts $f[4]
    $inserts += "INSERT INTO grupos (id,empresa_id,nome,descricao,criado_em) VALUES ($id,$emp,$nome,$desc,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('grupos_id_seq', COALESCE((SELECT MAX(id) FROM grupos),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Categorias: $($rows.Count) registros" -ForegroundColor Green

# ─── PRODUTOS ───
Write-Host "Migrando Produtos..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, codigo, descricao, codigo_barras, preco_custo, preco_venda, estoque, estoque_minimo, unidade, status, criado_em, atualizado_em, controla_estoque, foto FROM Produtos"
$inserts = @("TRUNCATE produtos CASCADE;", "ALTER SEQUENCE produtos_id_seq RESTART WITH 1;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 10) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $cod=Sq $f[2]; $desc=Sq $f[3]; $barras=Sq $f[4]
    $custo=Num $f[5]; $venda=Num $f[6]; $est=Num $f[7]; $estMin=Num $f[8]
    $uni=Sq $f[9]; $status=Sq $f[10]; $crt=Ts $f[11]; $upd=Ts $f[12]
    $controla=Bool $f[13]; $foto=Sq $f[14]
    $inserts += "INSERT INTO produtos (id,empresa_id,codigo,descricao,codigo_barras,preco_custo,preco_venda,estoque,estoque_minimo,unidade,status,criado_em,atualizado_em,controla_estoque,foto) VALUES ($id,$emp,$cod,$desc,$barras,$custo,$venda,$est,$estMin,$uni,$status,COALESCE($crt,NOW()),COALESCE($upd,NOW()),$controla,$foto);"
}
$inserts += "SELECT setval('produtos_id_seq', COALESCE((SELECT MAX(id) FROM produtos),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Produtos: $($rows.Count) registros" -ForegroundColor Green

# ─── CLIENTES ───
Write-Host "Migrando Clientes..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, nome, nome_fantasia, documento, telefone, email, cep, endereco, numero, bairro, cidade, estado, ativo, criado_em, atualizado_em FROM Clientes"
$inserts = @("TRUNCATE clientes CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 5) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $nome=Sq $f[2]; $fantasia=Sq $f[3]; $doc=Sq $f[4]
    $tel=Sq $f[5]; $email=Sq $f[6]; $cep=Sq $f[7]; $end=Sq $f[8]; $num=Sq $f[9]
    $bairro=Sq $f[10]; $cid=Sq $f[11]; $est=Sq $f[12]; $ativo=Bool $f[13]
    $crt=Ts $f[14]; $upd=Ts $f[15]
    $inserts += "INSERT INTO clientes (id,empresa_id,nome,nome_fantasia,documento,telefone,email,cep,endereco,numero,bairro,cidade,estado,ativo,criado_em,atualizado_em) VALUES ($id,$emp,$nome,$fantasia,$doc,$tel,$email,$cep,$end,$num,$bairro,$cid,$est,$ativo,COALESCE($crt,NOW()),COALESCE($upd,NOW()));"
}
$inserts += "SELECT setval('clientes_id_seq', COALESCE((SELECT MAX(id) FROM clientes),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Clientes: $($rows.Count) registros" -ForegroundColor Green

# ─── FORNECEDORES ───
Write-Host "Migrando Fornecedores..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, nome, documento, telefone, email, endereco, ativo, criado_em FROM Fornecedores"
$inserts = @("TRUNCATE fornecedores CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 4) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $nome=Sq $f[2]; $doc=Sq $f[3]; $tel=Sq $f[4]
    $email=Sq $f[5]; $end=Sq $f[6]; $ativo=Bool $f[7]; $crt=Ts $f[8]
    $inserts += "INSERT INTO fornecedores (id,empresa_id,nome,documento,telefone,email,endereco,ativo,criado_em) VALUES ($id,$emp,$nome,$doc,$tel,$email,$end,$ativo,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('fornecedores_id_seq', COALESCE((SELECT MAX(id) FROM fornecedores),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Fornecedores: $($rows.Count) registros" -ForegroundColor Green

# ─── CAIXA ───
Write-Host "Migrando Caixa..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, usuario_id, status, valor_abertura, valor_fechamento, aberto_em, fechado_em, criado_em FROM Caixa"
$inserts = @("TRUNCATE caixa CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 4) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $uid=Num $f[2]; $status=Sq $f[3]
    $vabert=Num $f[4]; $vfech=Num $f[5]; $abert=Ts $f[6]; $fech=Ts $f[7]; $crt=Ts $f[8]
    $inserts += "INSERT INTO caixa (id,empresa_id,usuario_id,status,valor_abertura,valor_fechamento,aberto_em,fechado_em,criado_em) VALUES ($id,$emp,$uid,$status,COALESCE($vabert,0),COALESCE($vfech,0),$abert,$fech,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('caixa_id_seq', COALESCE((SELECT MAX(id) FROM caixa),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Caixa: $($rows.Count) registros" -ForegroundColor Green

# ─── VENDAS ───
Write-Host "Migrando Vendas..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, cliente_id, forma_pagamento_id, subtotal, desconto, total, observacao, usuario_id, status, status_cobranca, data_vencimento, data_recebimento, caixa_id, criado_em FROM Vendas"
$inserts = @("TRUNCATE vendas CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 10) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $cid=Num $f[2]; $fpid=Num $f[3]
    $sub=Num $f[4]; $desc=Num $f[5]; $tot=Num $f[6]; $obs=Sq $f[7]
    $uid=Num $f[8]; $status=Sq $f[9]; $stcob=Sq $f[10]; $dvenc=Ts $f[11]
    $drec=Ts $f[12]; $cxid=Num $f[13]; $crt=Ts $f[14]
    $inserts += "INSERT INTO vendas (id,empresa_id,cliente_id,forma_pagamento_id,subtotal,desconto,total,observacao,usuario_id,status,status_cobranca,data_vencimento,data_recebimento,caixa_id,criado_em) VALUES ($id,$emp,$cid,$fpid,COALESCE($sub,0),COALESCE($desc,0),COALESCE($tot,0),$obs,$uid,$status,$stcob,$dvenc,$drec,$cxid,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('vendas_id_seq', COALESCE((SELECT MAX(id) FROM vendas),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Vendas: $($rows.Count) registros" -ForegroundColor Green

# ─── ITENS VENDA ───
Write-Host "Migrando ItensVenda..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, venda_id, produto_id, quantidade, preco_unit, subtotal FROM ItensVenda"
$inserts = @("TRUNCATE itensvenda CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 5) { continue }
    $id=Num $f[0]; $vid=Num $f[1]; $pid=Num $f[2]; $qty=Num $f[3]; $pu=Num $f[4]; $sub=Num $f[5]
    $inserts += "INSERT INTO itensvenda (id,venda_id,produto_id,quantidade,preco_unit,subtotal) VALUES ($id,$vid,$pid,$qty,$pu,$sub);"
}
$inserts += "SELECT setval('itensvenda_id_seq', COALESCE((SELECT MAX(id) FROM itensvenda),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  ItensVenda: $($rows.Count) registros" -ForegroundColor Green

# ─── VENDA PAGAMENTOS ───
Write-Host "Migrando VendaPagamentos..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, venda_id, forma_pagamento_id, forma, valor FROM VendaPagamentos"
$inserts = @("TRUNCATE vendapagamentos CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 5) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $vid=Num $f[2]; $fpid=Num $f[3]; $forma=Sq $f[4]; $val=Num $f[5]
    $inserts += "INSERT INTO vendapagamentos (id,empresa_id,venda_id,forma_pagamento_id,forma,valor) VALUES ($id,$emp,$vid,$fpid,$forma,$val);"
}
$inserts += "SELECT setval('vendapagamentos_id_seq', COALESCE((SELECT MAX(id) FROM vendapagamentos),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  VendaPagamentos: $($rows.Count) registros" -ForegroundColor Green

# ─── MOVIMENTACOES ESTOQUE ───
Write-Host "Migrando MovimentacoesEstoque..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, produto_id, tipo, quantidade, saldo_anterior, saldo_atual, origem, usuario_id, criado_em FROM MovimentacoesEstoque"
$inserts = @("TRUNCATE movimentacoesestoque CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 8) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $pid=Num $f[2]; $tipo=Sq $f[3]; $qty=Num $f[4]
    $sant=Num $f[5]; $sat=Num $f[6]; $orig=Sq $f[7]; $uid=Num $f[8]; $crt=Ts $f[9]
    $inserts += "INSERT INTO movimentacoesestoque (id,empresa_id,produto_id,tipo,quantidade,saldo_anterior,saldo_atual,origem,usuario_id,criado_em) VALUES ($id,$emp,$pid,$tipo,$qty,$sant,$sat,$orig,$uid,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('movimentacoesestoque_id_seq', COALESCE((SELECT MAX(id) FROM movimentacoesestoque),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  MovimentacoesEstoque: $($rows.Count) registros" -ForegroundColor Green

# ─── DEVOLUCOES ───
Write-Host "Migrando Devolucoes..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, venda_id, tipo, valor, motivo, usuario_id, criado_em FROM Devolucoes"
$inserts = @("TRUNCATE devolucoes CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 6) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $vid=Num $f[2]; $tipo=Sq $f[3]; $val=Num $f[4]
    $mot=Sq $f[5]; $uid=Num $f[6]; $crt=Ts $f[7]
    $inserts += "INSERT INTO devolucoes (id,empresa_id,venda_id,tipo,valor,motivo,usuario_id,criado_em) VALUES ($id,$emp,$vid,$tipo,$val,$mot,$uid,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('devolucoes_id_seq', COALESCE((SELECT MAX(id) FROM devolucoes),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Devolucoes: $($rows.Count) registros" -ForegroundColor Green

# ─── ITENS DEVOLUCAO ───
Write-Host "Migrando ItensDevolucao..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, devolucao_id, produto_id, quantidade, preco_unit, subtotal FROM ItensDevolucao"
$inserts = @("TRUNCATE itensdevolucao CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 5) { continue }
    $id=Num $f[0]; $did=Num $f[1]; $pid=Num $f[2]; $qty=Num $f[3]; $pu=Num $f[4]; $sub=Num $f[5]
    $inserts += "INSERT INTO itensdevolucao (id,devolucao_id,produto_id,quantidade,preco_unit,subtotal) VALUES ($id,$did,$pid,$qty,$pu,$sub);"
}
$inserts += "SELECT setval('itensdevolucao_id_seq', COALESCE((SELECT MAX(id) FROM itensdevolucao),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  ItensDevolucao: $($rows.Count) registros" -ForegroundColor Green

# ─── CONTAS RECEBER ───
Write-Host "Migrando ContasReceber..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, venda_id, cliente_id, numero_documento, parcela_num, parcelas_total, valor, data_emissao, data_vencimento, status, observacao, criado_por, criado_em FROM ContasReceber"
$inserts = @("TRUNCATE contasreceber CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 10) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $vid=Num $f[2]; $cid=Num $f[3]; $ndoc=Sq $f[4]
    $pn=Num $f[5]; $pt=Num $f[6]; $val=Num $f[7]; $dem=Ts $f[8]; $dvenc=Ts $f[9]
    $status=Sq $f[10]; $obs=Sq $f[11]; $cpor=Num $f[12]; $crt=Ts $f[13]
    $inserts += "INSERT INTO contasreceber (id,empresa_id,venda_id,cliente_id,numero_documento,parcela_num,parcelas_total,valor,data_emissao,data_vencimento,status,observacao,criado_por,criado_em) VALUES ($id,$emp,$vid,$cid,$ndoc,$pn,$pt,$val,$dem,$dvenc,$status,$obs,$cpor,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('contasreceber_id_seq', COALESCE((SELECT MAX(id) FROM contasreceber),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  ContasReceber: $($rows.Count) registros" -ForegroundColor Green

# ─── RECEBIMENTOS CONTAS ───
Write-Host "Migrando RecebimentosContas..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, conta_id, valor_principal, juros, multa, desconto, acrescimo, valor_recebido, forma_pagamento, data_recebimento, usuario_id, caixa_id, observacao, estornado, criado_em FROM RecebimentosContas"
$inserts = @("TRUNCATE recebimentoscontas CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 10) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $cid=Num $f[2]; $vp=Num $f[3]; $jur=Num $f[4]
    $mul=Num $f[5]; $desc=Num $f[6]; $acr=Num $f[7]; $vr=Num $f[8]; $fp=Sq $f[9]
    $drec=Ts $f[10]; $uid=Num $f[11]; $cxid=Num $f[12]; $obs=Sq $f[13]
    $est=Bool $f[14]; $crt=Ts $f[15]
    $inserts += "INSERT INTO recebimentoscontas (id,empresa_id,conta_id,valor_principal,juros,multa,desconto,acrescimo,valor_recebido,forma_pagamento,data_recebimento,usuario_id,caixa_id,observacao,estornado,criado_em) VALUES ($id,$emp,$cid,COALESCE($vp,0),COALESCE($jur,0),COALESCE($mul,0),COALESCE($desc,0),COALESCE($acr,0),COALESCE($vr,0),$fp,COALESCE($drec,NOW()),$uid,$cxid,$obs,$est,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('recebimentoscontas_id_seq', COALESCE((SELECT MAX(id) FROM recebimentoscontas),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  RecebimentosContas: $($rows.Count) registros" -ForegroundColor Green

# ─── CONTAS PAGAR ───
Write-Host "Migrando ContasPagar..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, fornecedor_id, fornecedor, categoria, descricao, valor, data_emissao, data_vencimento, status, observacao, criado_por, criado_em FROM ContasPagar"
$inserts = @("TRUNCATE contaspagar CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 10) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $fid=Num $f[2]; $forn=Sq $f[3]; $cat=Sq $f[4]
    $desc=Sq $f[5]; $val=Num $f[6]; $dem=Ts $f[7]; $dvenc=Ts $f[8]
    $status=Sq $f[9]; $obs=Sq $f[10]; $cpor=Num $f[11]; $crt=Ts $f[12]
    $inserts += "INSERT INTO contaspagar (id,empresa_id,fornecedor_id,fornecedor,categoria,descricao,valor,data_emissao,data_vencimento,status,observacao,criado_por,criado_em) VALUES ($id,$emp,$fid,$forn,$cat,$desc,$val,$dem,$dvenc,$status,$obs,$cpor,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('contaspagar_id_seq', COALESCE((SELECT MAX(id) FROM contaspagar),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  ContasPagar: $($rows.Count) registros" -ForegroundColor Green

# ─── PAGAMENTOS CONTAS PAGAR ───
Write-Host "Migrando PagamentosContasPagar..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, conta_id, valor_pago, forma_pagamento, data_pagamento, usuario_id, caixa_id, observacao, estornado, criado_em FROM PagamentosContasPagar"
$inserts = @("TRUNCATE pagamentoscontaspagar CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 8) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $cid=Num $f[2]; $vp=Num $f[3]; $fp=Sq $f[4]
    $dpag=Ts $f[5]; $uid=Num $f[6]; $cxid=Num $f[7]; $obs=Sq $f[8]
    $est=Bool $f[9]; $crt=Ts $f[10]
    $inserts += "INSERT INTO pagamentoscontaspagar (id,empresa_id,conta_id,valor_pago,forma_pagamento,data_pagamento,usuario_id,caixa_id,observacao,estornado,criado_em) VALUES ($id,$emp,$cid,COALESCE($vp,0),$fp,COALESCE($dpag,NOW()),$uid,$cxid,$obs,$est,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('pagamentoscontaspagar_id_seq', COALESCE((SELECT MAX(id) FROM pagamentoscontaspagar),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  PagamentosContasPagar: $($rows.Count) registros" -ForegroundColor Green

# ─── COMPRAS ───
Write-Host "Migrando Compras..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, fornecedor_id, numero_nf, valor_total, data_compra, status, observacao, usuario_id, criado_em FROM Compras"
$inserts = @("TRUNCATE compras CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 8) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $fid=Num $f[2]; $nnf=Sq $f[3]; $vt=Num $f[4]
    $dc=Ts $f[5]; $status=Sq $f[6]; $obs=Sq $f[7]; $uid=Num $f[8]; $crt=Ts $f[9]
    $inserts += "INSERT INTO compras (id,empresa_id,fornecedor_id,numero_nf,valor_total,data_compra,status,observacao,usuario_id,criado_em) VALUES ($id,$emp,$fid,$nnf,COALESCE($vt,0),$dc,$status,$obs,$uid,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('compras_id_seq', COALESCE((SELECT MAX(id) FROM compras),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  Compras: $($rows.Count) registros" -ForegroundColor Green

# ─── ITENS COMPRA ───
Write-Host "Migrando ItensCompra..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, compra_id, produto_id, quantidade, custo_unit, subtotal FROM ItensCompra"
$inserts = @("TRUNCATE itenscompra CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 5) { continue }
    $id=Num $f[0]; $cid=Num $f[1]; $pid=Num $f[2]; $qty=Num $f[3]; $cu=Num $f[4]; $sub=Num $f[5]
    $inserts += "INSERT INTO itenscompra (id,compra_id,produto_id,quantidade,custo_unit,subtotal) VALUES ($id,$cid,$pid,$qty,$cu,$sub);"
}
$inserts += "SELECT setval('itenscompra_id_seq', COALESCE((SELECT MAX(id) FROM itenscompra),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  ItensCompra: $($rows.Count) registros" -ForegroundColor Green

# ─── MOVIMENTACOES CAIXA ───
Write-Host "Migrando MovimentacoesCaixa..." -ForegroundColor Yellow
$rows = Get-SS "SELECT id, empresa_id, caixa_id, tipo, valor, descricao, forma_pagamento, usuario_id, criado_em FROM MovimentacoesCaixa"
$inserts = @("TRUNCATE movimentacoescaixa CASCADE;")
foreach ($row in $rows) {
    $f = $row -split '\|'
    if ($f.Count -lt 7) { continue }
    $id=Num $f[0]; $emp=Num $f[1]; $cxid=Num $f[2]; $tipo=Sq $f[3]; $val=Num $f[4]
    $desc=Sq $f[5]; $fp=Sq $f[6]; $uid=Num $f[7]; $crt=Ts $f[8]
    $inserts += "INSERT INTO movimentacoescaixa (id,empresa_id,caixa_id,tipo,valor,descricao,forma_pagamento,usuario_id,criado_em) VALUES ($id,$emp,$cxid,$tipo,$val,$desc,$fp,$uid,COALESCE($crt,NOW()));"
}
$inserts += "SELECT setval('movimentacoescaixa_id_seq', COALESCE((SELECT MAX(id) FROM movimentacoescaixa),1));"
$inserts -join "`n" | & $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB 2>&1
Write-Host "  MovimentacoesCaixa: $($rows.Count) registros" -ForegroundColor Green

Write-Host ""
Write-Host "=== Verificacao final ===" -ForegroundColor Cyan
$env:PGPASSWORD = "Server123!"
& $PSQL -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDB -c @"
SELECT 'produtos' AS tab, COUNT(*) FROM produtos
UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
UNION ALL SELECT 'vendas', COUNT(*) FROM vendas
UNION ALL SELECT 'itensvenda', COUNT(*) FROM itensvenda
UNION ALL SELECT 'contasreceber', COUNT(*) FROM contasreceber
UNION ALL SELECT 'contaspagar', COUNT(*) FROM contaspagar
UNION ALL SELECT 'movimentacoesestoque', COUNT(*) FROM movimentacoesestoque
ORDER BY tab;
"@

Write-Host ""
Write-Host "Migracao concluida!" -ForegroundColor Green
