-- ============================================================================
-- Fix: Drop unique constraint on (offer_id, user_id) for redeemed offers
-- 
-- Root Cause:
-- offer_redemptions_redeemed_user_uidx was defined as UNIQUE (offer_id, user_id)
-- WHERE status = 'redeemed'. This prevented repeat redemptions of offers that have
-- per_user_limit IS NULL (such as SAVE5) or per_user_limit > 1.
-- When a returning user placed a second order using SAVE5, apply_payment_success
-- crashed with PostgreSQL error 23505 (unique_violation) when updating order status,
-- causing Edge Functions to receive HTTP 409 and leaving paid orders stuck in
-- pending_payment.
-- ============================================================================

-- 1. Drop the incorrect partial unique index
DROP INDEX IF EXISTS public.offer_redemptions_redeemed_user_uidx;

-- 2. Create a standard (non-unique) performance index for limit counting queries
CREATE INDEX IF NOT EXISTS offer_redemptions_redeemed_user_idx
  ON public.offer_redemptions (offer_id, user_id)
  WHERE status = 'redeemed';

-- 3. Update sync trigger function to remove the redundant NOT EXISTS check
--    that assumed at most 1 redeemed row per user.
CREATE OR REPLACE FUNCTION public.sync_offer_redemption_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status = 'pending_payment'
     AND NEW.status IN ('preparing', 'partially_ready', 'ready') THEN
    UPDATE public.offer_redemptions
    SET status = 'redeemed', redeemed_at = now()
    WHERE order_id = NEW.id AND status = 'reserved';
  ELSIF OLD.status = 'payment_failed'
     AND NEW.status IN ('preparing', 'partially_ready', 'ready') THEN
    UPDATE public.offer_redemptions r
    SET status = 'redeemed', redeemed_at = coalesce(r.redeemed_at, now()), released_at = NULL
    WHERE r.order_id = NEW.id AND r.status IN ('reserved', 'released');
  ELSIF OLD.status = 'pending_payment' AND NEW.status = 'payment_failed' THEN
    UPDATE public.offer_redemptions
    SET status = 'released', released_at = now()
    WHERE order_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
