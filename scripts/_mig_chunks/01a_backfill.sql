-- Migration: 01_refund_gateway_name.sql
-- Backfill refund gateway_name from payments; stamp gateway_name on refund creation paths.

-- 1. Backfill live refunds
UPDATE public.refunds
SET gateway_name = lower(trim(p.gateway_name))
FROM public.payments p
WHERE refunds.payment_id = p.id
  AND (refunds.gateway_name IS NULL OR trim(refunds.gateway_name) = '')
  AND p.gateway_name IS NOT NULL;

-- 2. Backfill archieved_refunds if table/columns exist
DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'archieved_refunds'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'archieved_refunds' AND column_name = 'gateway_name'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'archieved_refunds' AND column_name = 'payment_id'
  ) THEN
    UPDATE public.archieved_refunds ar
    SET gateway_name = lower(trim(p.gateway_name))
    FROM public.payments p
    WHERE ar.payment_id = p.id
      AND (ar.gateway_name IS NULL OR trim(ar.gateway_name) = '')
      AND p.gateway_name IS NOT NULL;
  END IF;
END $body$;

