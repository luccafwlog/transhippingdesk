-- Observação operacional por linha de serviço do Embarque de Vazios.
ALTER TABLE public.vazios_export_service_lines
  ADD COLUMN IF NOT EXISTS observation TEXT;
