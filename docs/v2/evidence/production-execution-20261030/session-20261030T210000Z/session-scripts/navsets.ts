import { adminNavFor } from 'D:/dev/afldbV2/src/app/admin/nav-model.ts';
const flat = (v: any) => adminNavFor(v).flatMap((g: any) => g.links.map((l: any) => l.href));
const a = flat({ role: 'admin', canManageAdmins: false });
const s = flat({ role: 'super_admin', canManageAdmins: true });
console.log(JSON.stringify({ admin: a, superOnly: s.filter((h: string) => !a.includes(h)) }));

