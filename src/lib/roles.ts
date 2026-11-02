export type Role = "owner" | "manager" | "cashier";

export const ROLE_LABEL: Record<Role, string> = { owner: "เจ้าของร้าน", manager: "ผู้จัดการ", cashier: "แคชเชียร์" };

export type Permission =
  | "pos" | "cash" | "customers" | "help"
  | "orders.refund" | "cash.reverse"
  | "reports" | "products" | "inventory"
  | "employees" | "settings";

const MATRIX: Record<Permission, Role[]> = {
  pos: ["owner", "manager", "cashier"],
  cash: ["owner", "manager", "cashier"],
  customers: ["owner", "manager", "cashier"],
  help: ["owner", "manager", "cashier"],
  "orders.refund": ["owner", "manager"],
  "cash.reverse": ["owner", "manager"],
  reports: ["owner", "manager"],
  products: ["owner", "manager"],
  inventory: ["owner", "manager"],
  employees: ["owner"],
  settings: ["owner"],
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  return !!role && MATRIX[perm].includes(role);
}

export interface NavItem { href: string; label: string; labelEn: string; icon: string; perm: Permission }

export const NAV: NavItem[] = [
  { href: "/pos", label: "ขายสินค้า", labelEn: "POS", icon: "pos", perm: "pos" },
  { href: "/reports", label: "รายงาน", labelEn: "Reports", icon: "chart", perm: "reports" },
  { href: "/products", label: "สินค้า", labelEn: "Products", icon: "tag", perm: "products" },
  { href: "/inventory", label: "สต็อก", labelEn: "Inventory", icon: "box", perm: "inventory" },
  { href: "/employees", label: "พนักงาน", labelEn: "Employees", icon: "users", perm: "employees" },
  { href: "/customers", label: "ลูกค้า", labelEn: "Customers", icon: "heart", perm: "customers" },
  { href: "/cash", label: "เงินเข้า-ออก", labelEn: "Cash & Expenses", icon: "wallet", perm: "cash" },
  { href: "/settings", label: "ตั้งค่า", labelEn: "Settings", icon: "gear", perm: "settings" },
  { href: "/help", label: "ช่วยเหลือ", labelEn: "Help", icon: "help", perm: "help" },
];
