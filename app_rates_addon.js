// =========================================================================
// SINKRONISASI HARGA SETORAN (GOOD 4K & CAPTHA 2K) - TAMBAHKAN KE app.js
// =========================================================================

let currentRates = {
  good: Number(window.FIH_CONFIG?.RATES_IDR?.good ?? 4000),
  captha: Number(window.FIH_CONFIG?.RATES_IDR?.captha ?? 2000)
};

function formatK(val) {
  const num = Number(val) || 0;
  if (num >= 1000 && num % 1000 === 0) return `${num / 1000}k`;
  return `Rp${num.toLocaleString("id-ID")}`;
}

function renderRatesUI() {
  const dashEl = document.getElementById("dashboard-rate-info");
  if (dashEl) {
    dashEl.textContent = `Harga per email: Good ${formatK(currentRates.good)} • Captha ${formatK(currentRates.captha)}`;
  }

  const goodInput = document.getElementById("admin-rate-good");
  const capthaInput = document.getElementById("admin-rate-captha");
  if (goodInput && document.activeElement !== goodInput) goodInput.value = currentRates.good;
  if (capthaInput && document.activeElement !== capthaInput) capthaInput.value = currentRates.captha;
}

// Panggil fungsi ini saat memuat row dari tabel app_settings di Supabase
function applyAppSettingsRow(row) {
  if (!row) return;
  currentRates.good = Number(row.rate_good ?? 4000);
  currentRates.captha = Number(row.rate_captha ?? 2000);
  renderRatesUI();
}

// Helper untuk mengambil nominal reward saat Admin menekan tombol Good / Captha
function getRewardForStatus(status) {
  if (status === "good") return Number(currentRates.good || 4000);
  if (status === "captha") return Number(currentRates.captha || 2000);
  return 0;
}

// Tombol Simpan Harga di Admin Panel
document.getElementById("btn-save-rates")?.addEventListener("click", async () => {
  const rateGood = Math.max(0, Number(document.getElementById("admin-rate-good")?.value || 0));
  const rateCaptha = Math.max(0, Number(document.getElementById("admin-rate-captha")?.value || 0));

  const { error } = await sb
    .from("app_settings")
    .upsert({
      id: 1,
      rate_good: rateGood,
      rate_captha: rateCaptha
    }, { onConflict: "id" });

  if (error) {
    alert(`Gagal simpan harga: ${error.message}`);
    return;
  }

  currentRates = { good: rateGood, captha: rateCaptha };
  renderRatesUI();
  alert("Harga berhasil disimpan dan disinkronkan!");
});

// Inisialisasi tampilan saat halaman pertama kali dimuat
document.addEventListener("DOMContentLoaded", renderRatesUI);
