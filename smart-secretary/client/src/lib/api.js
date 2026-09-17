// عميل API موحد
let token = localStorage.getItem('ss_token') || '';
export const setToken = (t) => { token = t || ''; t ? localStorage.setItem('ss_token', t) : localStorage.removeItem('ss_token'); };
export const getToken = () => token;

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
  });
  if (res.status === 401) {
    setToken('');
    if (!location.hash.includes('login')) location.hash = '#/login';
    throw new Error('انتهت الجلسة — سجل الدخول مجددًا');
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (!res.ok) throw new Error('خطأ في الاتصال بالخادم');
    return res;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}

export const q = (o = {}) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) p.append(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
};

export const fileUrl = (id, dl = false) => `/api/files/${id}/raw?token=${encodeURIComponent(token)}${dl ? '&dl=1' : ''}`;
export const excelUrl = (name, filters = {}) => {
  // تنزيل عبر fetch مع التوكن
  return fetch('/api/reports/' + name + '/excel' + q(filters), { headers: { Authorization: 'Bearer ' + token } })
    .then(async r => {
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'تعذر التصدير'); }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `report-${name}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
};
