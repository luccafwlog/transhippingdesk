-- Guard container identity at the storage boundary.
-- BL import is parser-driven, but container_number is a physical identifier and
-- must never store clauses, freight text, or other non-container values.

UPDATE public.bl_containers
SET container_number = UPPER(regexp_replace(container_number, '\s+', '', 'g'))
WHERE container_number IS DISTINCT FROM UPPER(regexp_replace(container_number, '\s+', '', 'g'));

DELETE FROM public.bl_containers AS bc
WHERE bc.container_number !~ '^[A-Z]{4}[0-9]{7}$'
  AND NOT EXISTS (SELECT 1 FROM public.vehicles AS v WHERE v.container_id = bc.id)
  AND NOT EXISTS (SELECT 1 FROM public.charge_calculations AS cc WHERE cc.container_id = bc.id)
  AND NOT EXISTS (SELECT 1 FROM public.demurrage_invoice_items AS di WHERE di.container_id = bc.id);

ALTER TABLE public.bl_containers
  DROP CONSTRAINT IF EXISTS bl_containers_container_number_iso;

ALTER TABLE public.bl_containers
  ADD CONSTRAINT bl_containers_container_number_iso
  CHECK (container_number ~ '^[A-Z]{4}[0-9]{7}$') NOT VALID;

UPDATE public.baplie_containers
SET container_number = UPPER(regexp_replace(container_number, '\s+', '', 'g'))
WHERE container_number IS DISTINCT FROM UPPER(regexp_replace(container_number, '\s+', '', 'g'));

DELETE FROM public.baplie_containers
WHERE container_number !~ '^[A-Z]{4}[0-9]{7}$';

ALTER TABLE public.baplie_containers
  DROP CONSTRAINT IF EXISTS baplie_containers_container_number_iso;

ALTER TABLE public.baplie_containers
  ADD CONSTRAINT baplie_containers_container_number_iso
  CHECK (container_number ~ '^[A-Z]{4}[0-9]{7}$') NOT VALID;
