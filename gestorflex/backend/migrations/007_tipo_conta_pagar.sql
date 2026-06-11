-- 007_tipo_conta_pagar: diferencia contas de fornecedor vs despesas operacionais
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('ContasPagar') AND name='tipo')
  ALTER TABLE ContasPagar ADD tipo NVARCHAR(20) NOT NULL DEFAULT 'fornecedor';
GO
