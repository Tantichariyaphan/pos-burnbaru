/** select string ที่ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ (อ่านภายใต้ RLS) */
export const ORDER_SELECT =
  "id,order_no,business_date,subtotal_satang,discount_name,discount_satang,total_satang,payment_status,prep_status,created_at,prepared_at,employee_id," +
  "order_items(id,product_name,category_name,unit_price_satang,addons,addon_unit_satang,quantity,line_total_satang)," +
  "payments(method,amount_satang,received_satang,change_satang,reference)";

export function satangToInput(s: number): string {
  return s % 100 === 0 ? String(s / 100) : (s / 100).toFixed(2);
}
