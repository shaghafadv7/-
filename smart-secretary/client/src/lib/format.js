export const fmtN = (v) => Number(v || 0).toLocaleString('en-US');
export const fmtD = (d) => { if (!d) return '—'; try { return new Date(d.length <= 10 ? d + 'T00:00:00' : d.replace(' ', 'T')).toLocaleDateString('en-GB'); } catch { return d; } };
export const fmtDT = (d) => { if (!d) return '—'; try { return new Date(d.replace(' ', 'T')).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }); } catch { return d; } };
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const timeGreet = () => { const h = new Date().getHours(); return h < 12 ? 'صباح الخير' : h < 17 ? 'مساء الخير' : 'مساء النور'; };
export const arDate = () => new Date().toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const L = {
  taskStatus: { new: 'جديدة', in_progress: 'قيد التنفيذ', paused: 'معلقة', completed: 'مكتملة', cancelled: 'ملغاة' },
  priority: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' },
  apptStatus: { scheduled: 'مجدول', done: 'تم', cancelled: 'ملغي', postponed: 'مؤجل' },
  clientStatus: { active: 'نشط', potential: 'محتمل', inactive: 'غير نشط', vip: 'مميز', blocked: 'محظور' },
  callDir: { in: 'وارد', out: 'صادر' },
  callResult: { answered: 'تم الرد', missed: 'فائت', busy: 'مشغول', no_answer: 'لا رد', follow_up: 'يحتاج متابعة', deal: 'صفقة', other: 'أخرى' },
  unitStatus: { available: 'متاحة', reserved: 'محجوزة', sold: 'مباعة', resale: 'إعادة بيع', blocked: 'موقوفة' },
  resStatus: { active: 'نشط', completed: 'مكتمل', cancelled: 'ملغي', expired: 'منتهي' },
  saleStatus: { active: 'نشطة', completed: 'مكتملة', cancelled: 'ملغاة' },
  payMethod: { cash: 'نقد', transfer: 'تحويل', check: 'شيك', card: 'شبكة' },
  userStatus: { active: 'نشط', inactive: 'موقوف', locked: 'مقفل' },
  action: { login: 'دخول', logout: 'خروج', create: 'إنشاء', update: 'تعديل', delete: 'حذف', export: 'تصدير', denied: 'مرفوض', seed: 'تهيئة', login_failed: 'فشل دخول' },
};
export const badge = {
  taskStatus: { new: 'b-blue', in_progress: 'b-amber', paused: 'b-gray', completed: 'b-green', cancelled: 'b-red' },
  priority: { low: 'b-gray', medium: 'b-blue', high: 'b-amber', urgent: 'b-red' },
  unitStatus: { available: 'b-green', reserved: 'b-amber', sold: 'b-blue', resale: 'b-purple', blocked: 'b-red' },
  resStatus: { active: 'b-green', completed: 'b-blue', cancelled: 'b-red', expired: 'b-gray' },
};
