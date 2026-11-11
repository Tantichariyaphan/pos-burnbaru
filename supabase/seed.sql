-- =====================================================================
-- Seed: หมวดหมู่และเมนูเริ่มต้น (แก้ไขได้ทั้งหมดในหน้า "สินค้า")
--
-- ราคาของเมนูเครื่องดื่มในข้อความต้นฉบับไม่ระบุชัดว่าราคาไหนเป็นของเมนูใด
-- จึง "ไม่ตั้งราคา" (NULL) — สินค้าที่ยังไม่มีราคาจะขายไม่ได้
-- และระบบจะไม่เปิดรับชำระเงิน (settings.sales_enabled = false) จนกว่าเจ้าของจะยืนยันราคา
--
-- รันซ้ำได้ (ไม่สร้างซ้ำ)
-- =====================================================================
insert into public.categories (name, emoji, sort_order) values
  ('Basque Burnt Cheesecake', '🍰', 1),
  ('Matcha & Tea', '🍵', 2)
on conflict (name) do nothing;

insert into public.products (category_id, name, emoji, price_satang, sort_order)
select c.id, v.name, v.emoji, v.price, v.sort_order
from (values
  ('Basque Burnt Cheesecake', 'Original',     '🍰', 5900, 1),
  ('Basque Burnt Cheesecake', 'Matcha',       '🍵', 7900, 2),
  ('Basque Burnt Cheesecake', 'Red Velvet',   '❤️', 6900, 3),
  ('Matcha & Tea',            'Matcha',       '🍵', null, 1),
  ('Matcha & Tea',            'Clear Matcha', '🧊', null, 2),
  ('Matcha & Tea',            'Matcha Latte', '🥛', null, 3),
  ('Matcha & Tea',            'Hojicha Latte','☕', null, 4),
  ('Matcha & Tea',            'Apple Tea',    '🍎', null, 5),
  ('Matcha & Tea',            'Peach Tea',    '🍑', null, 6)
) as v(category, name, emoji, price, sort_order)
join public.categories c on c.name = v.category
on conflict (category_id, name) do nothing;

-- สถานีผลิตเริ่มต้น (เค้ก → สถานีเค้ก, เครื่องดื่ม → สถานีเครื่องดื่ม) — แก้ได้ที่ ตั้งค่า → สถานีผลิต
insert into public.category_stations (category_id, station)
select c.id, v.station
from (values ('Basque Burnt Cheesecake', 'cake'), ('Matcha & Tea', 'drink')) as v(category, station)
join public.categories c on c.name = v.category
on conflict (category_id) do nothing;
