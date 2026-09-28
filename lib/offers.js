import { supabase } from './supabase';

const OFFER_ERRORS = {
  offer_invalid: 'This offer code is not valid.',
  offer_expired: 'This offer has expired.',
  offer_min_order: 'Add more food items to use this offer. Beverages do not count.',
  offer_already_used: 'You have already used this offer.',
  offer_in_flight: 'This offer is held on an unpaid order. Finish that payment, or try again in a few minutes.',
  offer_limit_reached: 'This offer is no longer available.',
  offer_makes_total_invalid: 'This offer cannot be applied to the current cart.',
  unauthorized: 'Please sign in again.',
};

export function formatOfferSavings(offer) {
  if (!offer) return '';
  const kind = String(offer.kind || '').toLowerCase();
  const value = Number(offer.value);
  if (kind === 'percent' && Number.isFinite(value)) {
    return `${value}% off food`;
  }
  if (kind === 'flat' && Number.isFinite(value)) {
    return `₹${value} off`;
  }
  if (offer.discount_amount != null && Number(offer.discount_amount) > 0) {
    return `−₹${Number(offer.discount_amount)}`;
  }
  return offer.title || '';
}

export function offerErrorMessage(code) {
  const key = String(code || '').trim();
  return OFFER_ERRORS[key] || 'Could not apply this offer.';
}

export async function fetchActiveOffers() {
  const { data, error } = await supabase.rpc('list_active_offers_for_user');
  if (error) {
    return { ok: false, offers: [], error: error.message || 'Could not load offers.' };
  }
  if (data && data.ok === false) {
    return { ok: false, offers: [], error: offerErrorMessage(data.error) };
  }
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  return { ok: true, offers, error: '' };
}

export async function previewOfferDiscount({ code, items, isTakeaway }) {
  const offerCode = String(code || '').trim().toUpperCase();
  if (!offerCode) {
    return { ok: false, error: 'Enter a coupon code.' };
  }
  const { data, error } = await supabase.rpc('preview_offer_discount', {
    p_offer_code: offerCode,
    p_items: items,
    p_is_takeaway: !!isTakeaway,
  });
  if (error) {
    return { ok: false, error: error.message || 'Could not apply this offer.' };
  }
  if (!data || data.ok !== true) {
    return { ok: false, error: offerErrorMessage(data?.error) };
  }
  return { ok: true, ...data };
}
