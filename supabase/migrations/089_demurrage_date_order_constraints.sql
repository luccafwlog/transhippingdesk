-- Renumbered from 20260609132000 (original timestamped migration: 20260609132000_demurrage_date_order_constraints.sql).
-- Prevent invalid demurrage date intervals from being persisted.
--
-- NOT VALID avoids scanning existing production rows during deploy while still
-- enforcing the constraint for new and updated rows.

ALTER TABLE public.bl_containers
  ADD CONSTRAINT bl_containers_return_after_discharge_chk
  CHECK (
    return_date IS NULL
    OR discharge_date IS NULL
    OR return_date >= discharge_date
  ) NOT VALID;

ALTER TABLE public.demurrage_invoice_items
  ADD CONSTRAINT demurrage_invoice_items_return_after_discharge_chk
  CHECK (return_date >= discharge_date) NOT VALID;

ALTER TABLE public.demurrage_invoice_items
  ADD CONSTRAINT demurrage_invoice_items_total_days_nonnegative_chk
  CHECK (total_days >= 0) NOT VALID;

