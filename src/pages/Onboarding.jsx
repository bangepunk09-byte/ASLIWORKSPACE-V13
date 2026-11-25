import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg } from "../lib/api";
import { Logo } from "../components/common";
import { AppSelect } from "../components/ui/select";
import { DatePicker } from "../components/ui/date-picker";

const inp = "mt-1 h-11 w-full rounded-xl border border-border bg-surface2/75 px-3.5 text-sm outline-none focus:border-[var(--c-accent)]";
const Field = ({ label, req, children }) => <div className="block text-xs font-semibold text-sub">{label}{req && <span className="text-rose-500"> *</span>}{children}</div>;

export default function Onboarding() {
  const { me, ws, setSession, labels, showTopNotif, t } = useApp();
  const [f, setF] = useState({
    name: me.name || "",
    nickname: me.nickname || "",
    department: me.department || "",
    company: me.company || "",
    job_title: me.job_title || "",
    phone: me.phone || "",
    employee_id: me.employee_id || "",
    employment_status: me.employment_status || "",
    join_date: me.join_date || "",
  });
  const [divisions, setDivisions] = useState(ws?.divisions || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/workspace").then((r) => setDivisions(r.data.divisions || [])); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const ok = ["name", "nickname", "department", "company", "job_title"].every((k) => String(f[k] || "").trim());
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/me/onboarding", f);
      setSession((s) => ({ ...s, user: data }));
      if (!data.is_verified) {
        try { localStorage.setItem(`circle_verify_prompt_seen_${data.user_id}`, "1"); } catch {}
        showTopNotif?.({
          id: `verify_onb_${Date.now()}`,
          title: "Lengkapi Profil 100% untuk Centang Verified",
          body: `Profil Anda baru terisi ${data.profile_completion || 0}%. Lengkapi seluruh form di Ubah Profil untuk mendapat centang Verified.`,
          type: "profile_verify",
          link: `/people/${data.user_id}?edit=1`,
        });
      } else {
        toast.success(`Selamat datang, ${data.nickname}!`);
      }
    } catch (er) { toast.error(errMsg(er)); }
    setBusy(false);
  };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface2 px-3 py-6 sm:px-4 sm:py-10" data-testid="onboarding-page">
      <form onSubmit={submit} className="card w-full max-w-xl p-5 sm:p-8">
        <div className="flex items-center gap-3"><Logo ws={ws} size={40} /><div><h1 className="text-xl sm:text-2xl font-bold">{t("onb_title", "Lengkapi profil kamu")}</h1><p className="text-xs sm:text-sm text-sub">{t("onb_subtitle", "Sekali saja, supaya rekan kerja mudah menemukanmu di Direktori Drive.")}</p></div></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label={t("onb_name_label", "Nama lengkap")} req><input value={f.name} onChange={set("name")} className={inp} data-testid="onb-name-input" /></Field>
          <Field label={t("onb_nickname_label", "Nama panggilan")} req><input value={f.nickname} onChange={set("nickname")} placeholder={t("onb_nickname_ph", "mis. Kiki")} className={inp} data-testid="onb-nickname-input" /></Field>
          <Field label={t("onb_division_label", "Divisi")} req><AppSelect value={f.department} onChange={set("department")} placeholder={t("onb_division_ph", "Pilih divisi")} className={inp} data-testid="onb-division-select"><option value="">{t("onb_division_ph", "Pilih divisi")}</option>{divisions.map((d) => <option key={d} value={d}>{d}</option>)}</AppSelect></Field>
          <Field label={t("onb_company_label", "Perusahaan")} req><input list="onb-companies" value={f.company} onChange={set("company")} placeholder={t("onb_company_ph", "Pilih atau ketik")} className={inp} data-testid="onb-company-input" /><datalist id="onb-companies">{[...new Set(labels.filter((l) => !l.archived).map((l) => l.name))].map((n) => <option key={n} value={n} />)}</datalist></Field>
          <Field label={t("onb_job_label", "Jabatan")} req><input value={f.job_title} onChange={set("job_title")} placeholder={t("onb_job_ph", "mis. Graphic Designer")} className={inp} data-testid="onb-jobtitle-input" /></Field>
          <Field label={t("onb_phone_label", "Nomor HP")}><input type="tel" value={f.phone} onChange={set("phone")} placeholder={t("onb_phone_ph", "08xx")} className={inp} data-testid="onb-phone-input" /></Field>
          <Field label={t("onb_empid_label", "ID Employee")}><input value={f.employee_id} onChange={set("employee_id")} placeholder={t("onb_empid_ph", "mis. EMP-001")} className={inp} data-testid="onb-empid-input" /></Field>
          <Field label={t("onb_empstatus_label", "Status Kepegawaian")}><AppSelect value={f.employment_status} onChange={set("employment_status")} placeholder={t("onb_empstatus_ph", "Pilih status")} className={inp} data-testid="onb-empstatus-select">{[["Full-time", t("onb_status_fulltime", "Penuh Waktu")], ["Part-time", t("onb_status_parttime", "Paruh Waktu")], ["Contract", t("onb_status_contract", "Kontrak")], ["Intern", t("onb_status_intern", "Magang")], ["On leave", t("onb_status_leave", "Sedang Cuti")]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</AppSelect></Field>
          <Field label={t("onb_joindate_label", "Tanggal Bergabung")}><DatePicker showQuickPresets={false} value={f.join_date} onChange={(val) => setF({ ...f, join_date: val })} placeholder={t("onb_joindate_ph", "Pilih tanggal bergabung")} className={inp} data-testid="onb-joindate-input" /></Field>
        </div>
        {!divisions.length && <p className="mt-4 text-xs text-rose-500" data-testid="onb-no-divisions">{t("onb_no_divisions", "Daftar divisi belum diatur admin. Hubungi admin workspace.")}</p>}
        <button type="submit" disabled={!ok || busy} className="btn-accent mt-6 h-11 w-full text-sm font-semibold disabled:opacity-50" data-testid="onb-submit-btn">{busy ? t("onb_saving", "Menyimpan…") : t("onb_submit", "Simpan & masuk")}</button>
      </form>
    </div>
  );
}
