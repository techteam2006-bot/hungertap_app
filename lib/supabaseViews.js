/**
 * HungerTap read models (views). Names start with `z_` so they sort last in the dashboard.
 * Underlying table RLS still applies (security_invoker).
 */
export const VIEWS = {
  /** Kitchen CDS totals by item */
  CDS_AGGREGATED_ITEMS: 'z_cds_aggregated_items',
  /** Active menu items + category fields */
  MENU_FOR_CANTEEN: 'z_menu_for_canteen',
  /** Open kitchen order lines */
  KITCHEN_QUEUE: 'z_kitchen_queue',
  /** Live + archived + failed order headers */
  STUDENT_ORDER_FEED: 'z_student_order_feed',
  /** Latest payment per order (service_role only) */
  ORDER_PAYMENT_SUMMARY: 'z_order_payment_summary',
  /** Delivered revenue by token_date */
  CANTEEN_DAY_SALES: 'z_canteen_day_sales',
  /** Scheduled refunds due (service_role only) */
  REFUNDS_DUE: 'z_refunds_due',
  /** Active canteens + accepting_app_orders */
  ACTIVE_OPEN_CANTEENS: 'z_active_open_canteens',
  /** Unread notifications */
  USER_INBOX: 'z_user_inbox',
};
