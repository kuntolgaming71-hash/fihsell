// Konfigurasi Supabase FIH (Sudah Terhubung)
window.FIH_CONFIG = {
  SUPABASE_URL: "https://lxoqpiyphxwvzxmmipuz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_UJS7EDs--8YxwC5fGTGGKw_UiGUeGRZ",
  ADMIN_EMAILS: ["wafiqsanjayaabil@gmail.com"],
  RATES_IDR: {
    good: 3200,
    captha: 1200
  }
};

window.fihSupabase = null;
if (
  window.supabase &&
  window.FIH_CONFIG.SUPABASE_URL &&
  !window.FIH_CONFIG.SUPABASE_URL.includes("lxoqpiyphxwvzxmmipuz")
) {
  window.fihSupabase = window.supabase.createClient(
    window.FIH_CONFIG.SUPABASE_URL,
    window.FIH_CONFIG.SUPABASE_ANON_KEY
  );
}
