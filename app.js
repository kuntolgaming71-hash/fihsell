(() => {
  "use strict";

  const STORAGE_KEY = "fih_app_state_v1";
  const sb = window.fihSupabase;
  const CFG = window.FIH_CONFIG;

  const defaultState = {
    currentUser: null,
    users: [],
    settings: {
      good_open: true,
      captha_open: true,
      pass_sgsg1122: true,
      pass_goldacok: false
    },
    deposits: [],
    withdrawals: [],
    dashboardInfos: [
      {
        id: "info-1",
        title: "Selamat Datang di FIH",
        content: "Pastikan seluruh setoran Gmail mematuhi 5 poin rules di bawah. Estimasi pengecekan 24-30 jam.",
        created_at: new Date().toISOString()
      }
    ],
    notifications: [],
    feedbacks: [],
    loginLogs: []
  };

  let state = loadLocalState();

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      return { ...structuredClone(defaultState), ...JSON.parse(raw) };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function formatIDR(num) {
    return "Rp" + Number(num || 0).toLocaleString("id-ID");
  }

  function formatDate(iso) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function isAdminUser(user) {
    if (!user) return false;
    return user.role === "admin" || (CFG.ADMIN_EMAILS || []).includes(user.email.toLowerCase());
  }

  function getUserBalances(userId) {
    const myDeposits = state.deposits.filter((d) => d.user_id === userId);
    const approved = myDeposits.filter((d) => d.status === "good" || d.status === "captha");
    const totalIncome = approved.reduce((sum, d) => sum + Number(d.reward_idr || 0), 0);

    const myWithdraws = (state.withdrawals || []).filter((w) => w.user_id === userId);
    // Saldo terpakai untuk penarikan yang statusnya pending atau approved (ditolak dikembalikan ke saldo)
    const reservedOrPaid = myWithdraws
      .filter((w) => w.status === "pending" || w.status === "approved")
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    const available = Math.max(0, totalIncome - reservedOrPaid);
    return { totalIncome, reservedOrPaid, available };
  }

  // ==========================================
  // 1. AUTH (Tanpa SQL langsung di bagian login)
  // ==========================================
  function initAuthUI() {
    document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.authTab;
        document.getElementById("login-form").classList.toggle("hidden", tab !== "login");
        document.getElementById("register-form").classList.toggle("hidden", tab !== "register");
      });
    });

    document.getElementById("register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("reg-username").value.trim();
      const email = document.getElementById("reg-email").value.trim().toLowerCase();
      const password = document.getElementById("reg-password").value;

      if (sb) {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { username } }
        });
        if (error) return showToast(error.message);
        if (data.user) {
          await completeLogin({
            id: data.user.id,
            email,
            username,
            role: isAdminUser({ email }) ? "admin" : "member",
            avatar: ""
          });
        }
        return;
      }

      if (state.users.some((u) => u.email === email)) {
        return showToast("Email sudah terdaftar, silakan masuk.");
      }

      const newUser = {
        id: "usr-" + Date.now(),
        username,
        email,
        password,
        role: isAdminUser({ email }) ? "admin" : "member",
        avatar: ""
      };
      state.users.push(newUser);
      saveLocalState();
      await completeLogin(newUser);
    });

    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value.trim().toLowerCase();
      const password = document.getElementById("login-password").value;

      if (sb) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return showToast("Login gagal: " + error.message);
        const meta = data.user.user_metadata || {};
        await completeLogin({
          id: data.user.id,
          email: data.user.email,
          username: meta.username || email.split("@")[0],
          role: isAdminUser({ email: data.user.email }) ? "admin" : "member",
          avatar: meta.avatar || ""
        });
        return;
      }

      let found = state.users.find((u) => u.email === email && u.password === password);
      if (!found && isAdminUser({ email })) {
        found = {
          id: "usr-admin",
          username: "Admin FIH",
          email,
          password,
          role: "admin",
          avatar: ""
        };
        state.users.push(found);
      }

      if (!found) {
        return showToast("Email atau kata sandi tidak cocok.");
      }
      await completeLogin(found);
    });

    document.getElementById("btn-logout").addEventListener("click", async () => {
      if (sb) await sb.auth.signOut();
      state.currentUser = null;
      saveLocalState();
      renderApp();
      showToast("Berhasil keluar akun.");
    });
  }

  async function completeLogin(userObj) {
    state.currentUser = {
      id: userObj.id,
      email: userObj.email,
      username: userObj.username,
      role: isAdminUser(userObj) ? "admin" : "member",
      avatar: userObj.avatar || ""
    };

    const logEntry = {
      id: "log-" + Date.now(),
      user_id: state.currentUser.id,
      username: state.currentUser.username,
      email: state.currentUser.email,
      device: navigator.userAgent.slice(0, 68),
      logged_at: new Date().toISOString()
    };
    state.loginLogs.unshift(logEntry);
    if (state.loginLogs.length > 50) state.loginLogs.length = 50;

    if (sb) {
      await sb.from("login_logs").insert([logEntry]).catch(() => {});
      await syncFromSupabase(true);
    }

    saveLocalState();
    renderApp();
    showToast("Selamat datang, " + state.currentUser.username + "!");
  }

  let _realtimeSubscribed = false;

  function initRealtimeSync() {
    if (!sb || _realtimeSubscribed || typeof sb.channel !== "function") return;
    _realtimeSubscribed = true;
    try {
      sb.channel("fih-realtime-all")
        .on("postgres_changes", { event: "*", schema: "public", table: "deposits" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "withdrawals" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "dashboard_infos" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "feedbacks" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "login_logs" }, () => {
          syncFromSupabase().then(() => renderAllViews());
        })
        .subscribe();
    } catch {
      // Abaikan jika realtime tidak tersedia di plan/konfigurasi
    }
  }

  async function syncFromSupabase(showErr = false) {
    if (!sb || !state.currentUser) return;
    initRealtimeSync();
    try {
      const [depRes, wdRes, infoRes, notifRes, setRes, fbRes, logRes] = await Promise.all([
        sb.from("deposits").select("*").order("created_at", { ascending: false }),
        sb.from("withdrawals").select("*").order("created_at", { ascending: false }),
        sb.from("dashboard_infos").select("*").order("created_at", { ascending: false }),
        sb.from("notifications").select("*").eq("user_id", state.currentUser.id).order("created_at", { ascending: false }),
        sb.from("app_settings").select("*").limit(1).maybeSingle(),
        sb.from("feedbacks").select("*").order("created_at", { ascending: false }),
        sb.from("login_logs").select("*").order("logged_at", { ascending: false }).limit(30)
      ]);

      const firstErr = [depRes, wdRes, infoRes, notifRes, setRes, fbRes, logRes].find((r) => r && r.error);
      if (firstErr && showErr) {
        showToast("Sync DB: " + firstErr.error.message);
      }

      if (depRes && !depRes.error && Array.isArray(depRes.data)) {
        state.deposits = depRes.data;
      }
      if (wdRes && !wdRes.error && Array.isArray(wdRes.data)) {
        state.withdrawals = wdRes.data;
      }
      if (infoRes && !infoRes.error && Array.isArray(infoRes.data) && infoRes.data.length) {
        state.dashboardInfos = infoRes.data;
      }
      if (notifRes && !notifRes.error && Array.isArray(notifRes.data)) {
        state.notifications = notifRes.data;
      }
      if (setRes && !setRes.error && setRes.data) {
        state.settings.good_open = !!setRes.data.good_open;
        state.settings.captha_open = !!setRes.data.captha_open;
        if (typeof setRes.data.pass_sgsg1122 === "boolean") {
          state.settings.pass_sgsg1122 = setRes.data.pass_sgsg1122;
        }
        if (typeof setRes.data.pass_goldacok === "boolean") {
          state.settings.pass_goldacok = setRes.data.pass_goldacok;
        }
      }
      if (fbRes && !fbRes.error && Array.isArray(fbRes.data)) {
        state.feedbacks = fbRes.data;
      }
      if (logRes && !logRes.error && Array.isArray(logRes.data)) {
        state.loginLogs = logRes.data;
      }
      saveLocalState();
    } catch (err) {
      if (showErr) {
        showToast("Gagal sinkronisasi: " + (err && err.message ? err.message : "kesalahan jaringan"));
      }
    }
  }

  // ==========================================
  // 2. NAVIGATION (Floating Pill Bar)
  // ==========================================
  function switchView(targetId) {
    document.querySelectorAll(".page-view").forEach((v) => v.classList.remove("active"));
    const target = document.getElementById(targetId);
    if (target) target.classList.add("active");

    document.querySelectorAll(".nav-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.target === targetId);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (sb && state.currentUser) {
      syncFromSupabase().then(() => renderAllViews());
    }
  }

  function initNavigation() {
    document.querySelectorAll(".nav-pill").forEach((pill) => {
      pill.addEventListener("click", () => switchView(pill.dataset.target));
    });

    document.getElementById("btn-open-notif").addEventListener("click", () => {
      switchView("view-notifications");
    });

    document.getElementById("btn-go-withdraw").addEventListener("click", () => {
      switchView("view-withdraw");
    });

    document.getElementById("btn-back-dashboard").addEventListener("click", () => {
      switchView("view-dashboard");
    });
  }

  // ==========================================
  // 3. GENERATOR NAMA GMAIL (Tanpa AI)
  // ==========================================
  const FIRST_NAMES = [
    "andi", "rizky", "putra", "bima", "fajar", "dimas", "bagas", "arif", "hendra", "yoga",
    "ayu", "sari", "indah", "citra", "nanda", "putri", "dewi", "rani", "tari", "nadia"
  ];
  const LAST_NAMES = [
    "pratama", "saputra", "wijaya", "santoso", "kusuma", "ramadhan", "hidayat", "nugroho",
    "lestari", "rahmawati", "permata", "setiawan", "maulana", "kurniawan", "utami", "melati"
  ];

  function generateGmailAddresses(count) {
    const results = [];
    for (let i = 0; i < count; i++) {
      const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
      const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      const digits = Math.floor(1000 + Math.random() * 9000);
      results.push(`${fn}${ln}${digits}@gmail.com`.toLowerCase());
    }
    return results;
  }

  function initGenerator() {
    document.getElementById("btn-generate-gmail").addEventListener("click", () => {
      const count = parseInt(document.getElementById("gen-count").value, 10) || 5;
      const list = generateGmailAddresses(count);
      const container = document.getElementById("generated-list");
      container.innerHTML = list
        .map(
          (email) => `
          <div class="gen-item">
            <span>${email}</span>
            <div class="gen-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-copy-email="${email}">Salin</button>
              <button type="button" class="btn btn-primary btn-sm" data-use-email="${email}">Pakai</button>
            </div>
          </div>`
        )
        .join("");
    });

    document.getElementById("generated-list").addEventListener("click", (e) => {
      const copyBtn = e.target.closest("[data-copy-email]");
      const useBtn = e.target.closest("[data-use-email]");
      if (copyBtn) {
        copyText(copyBtn.dataset.copyEmail, "Nama Gmail disalin!");
      }
      if (useBtn) {
        const ta = document.getElementById("deposit-bulk-list");
        const val = useBtn.dataset.useEmail;
        ta.value = ta.value.trim() ? ta.value.trim() + "\n" + val : val;
        showToast("Email ditambahkan ke daftar setoran.");
      }
    });
  }

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(successMsg));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast(successMsg);
    }
  }

  // ==========================================
  // 4. SETORAN GMAIL (Good & Captha)
  // ==========================================
  function initDeposit() {
    document.querySelectorAll("[data-deposit-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-deposit-type]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const cat = btn.dataset.depositType;
        document.getElementById("deposit-category").value = cat;
        updateDepositChannelAvailability();
      });
    });

    document.getElementById("deposit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentUser) return;

      const category = document.getElementById("deposit-category").value;
      const isOpen = category === "good" ? state.settings.good_open : state.settings.captha_open;
      if (!isOpen) {
        return showToast(`Jalur setoran Gmail ${category.toUpperCase()} sedang ditutup admin.`);
      }

      const rawLines = document
        .getElementById("deposit-bulk-list")
        .value.split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const selectedPass = document.getElementById("deposit-password-select").value;
      const note = document.getElementById("deposit-note").value.trim();

      if (!selectedPass) {
        return showToast("Tidak ada pilihan sandi yang aktif dari admin saat ini.");
      }

      if (!rawLines.length) {
        return showToast("Masukkan minimal 1 baris alamat Gmail.");
      }

      const existingSet = new Set(state.deposits.map((d) => d.gmail_address.toLowerCase()));
      const batchSet = new Set();
      const newItems = [];
      let skippedDuplicate = 0;
      let skippedInvalid = 0;

      for (let idx = 0; idx < rawLines.length; idx++) {
        const line = rawLines[idx];
        let emailPart = line;
        let passPart = selectedPass;

        if (line.includes(":")) {
          const parts = line.split(":");
          emailPart = parts[0].trim();
          passPart = parts.slice(1).join(":").trim() || selectedPass;
        } else if (line.includes("|")) {
          const parts = line.split("|");
          emailPart = parts[0].trim();
          passPart = parts.slice(1).join("|").trim() || selectedPass;
        } else if (/\s+/.test(line)) {
          const parts = line.split(/\s+/);
          emailPart = parts[0].trim();
          passPart = parts.slice(1).join(" ").trim() || selectedPass;
        }

        const cleanEmail = emailPart.toLowerCase();
        if (!cleanEmail.endsWith("@gmail.com")) {
          skippedInvalid++;
          continue;
        }
        if (passPart && /[A-Z]/.test(passPart)) {
          return showToast(`Sandi pada baris ${idx + 1} mengandung huruf kapital!`);
        }
        if (existingSet.has(cleanEmail) || batchSet.has(cleanEmail)) {
          skippedDuplicate++;
          continue;
        }

        batchSet.add(cleanEmail);
        newItems.push({
          id: "dep-" + Date.now() + "-" + idx,
          user_id: state.currentUser.id,
          username: state.currentUser.username,
          category,
          gmail_address: cleanEmail,
          gmail_password: passPart,
          note,
          status: "pending",
          reward_idr: CFG.RATES_IDR[category] || 0,
          created_at: new Date().toISOString()
        });
      }

      if (!newItems.length) {
        return showToast("Tidak ada Gmail baru yang valid untuk dikirim (cek duplikat/format @gmail.com).");
      }

      if (sb) {
        const { error } = await sb.from("deposits").insert(newItems);
        if (error) {
          return showToast("Gagal simpan ke database: " + error.message);
        }
        await syncFromSupabase(true);
      } else {
        state.deposits.unshift(...newItems);
      }
      saveLocalState();

      e.target.reset();
      document.getElementById("deposit-category").value = category;
      renderAllViews();

      let infoMsg = `${newItems.length} setoran berhasil dikirim! Estimasi 24-30 jam.`;
      if (skippedDuplicate || skippedInvalid) {
        infoMsg += ` (${skippedDuplicate} duplikat, ${skippedInvalid} format tidak sesuai dilewati)`;
      }
      showToast(infoMsg);
    });
  }

  function updateDepositChannelAvailability() {
    const cat = document.getElementById("deposit-category").value;
    const isOpen = cat === "good" ? state.settings.good_open : state.settings.captha_open;
    const alertBox = document.getElementById("deposit-closed-alert");
    const submitBtn = document.getElementById("btn-submit-deposit");

    const passSelect = document.getElementById("deposit-password-select");
    const activePasswords = [];
    if (state.settings.pass_sgsg1122) activePasswords.push("sgsg1122");
    if (state.settings.pass_goldacok) activePasswords.push("goldacok");

    const prevVal = passSelect.value;
    if (!activePasswords.length) {
      passSelect.innerHTML = `<option value="">Tidak ada sandi yang aktif (hubungi admin)</option>`;
    } else {
      passSelect.innerHTML = activePasswords
        .map((p) => `<option value="${p}">${p}</option>`)
        .join("");
      if (activePasswords.includes(prevVal)) {
        passSelect.value = prevVal;
      }
    }

    const canSubmit = isOpen && activePasswords.length > 0;
    alertBox.classList.toggle("hidden", isOpen);
    submitBtn.disabled = !canSubmit;
    submitBtn.style.opacity = canSubmit ? "1" : "0.5";
  }

  // ==========================================
  // 4B. PENARIKAN SALDO (WITHDRAW)
  // ==========================================
  function getMinWithdrawByMethod(method) {
    const m = (method || "").toUpperCase();
    if (m === "DANA" || m === "GOPAY") return 1;
    return 10000;
  }

  function updateWithdrawMethodUI() {
    const methodEl = document.getElementById("wd-method");
    const amountEl = document.getElementById("wd-amount");
    const minLabel = document.getElementById("wd-min-label");
    const minBadge = document.getElementById("wd-min-badge");
    if (!methodEl || !amountEl) return;

    const minVal = getMinWithdrawByMethod(methodEl.value);
    amountEl.min = String(minVal);
    amountEl.placeholder = `Minimal ${minVal}`;
    if (minLabel) minLabel.textContent = formatIDR(minVal);
    if (minBadge) minBadge.textContent = `Min. ${formatIDR(minVal)}`;
  }

  function initWithdraw() {
    document.getElementById("wd-method").addEventListener("change", updateWithdrawMethodUI);
    updateWithdrawMethodUI();

    document.querySelectorAll("[data-wd-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("wd-amount").value = btn.dataset.wdPreset;
      });
    });

    document.getElementById("btn-wd-all").addEventListener("click", () => {
      if (!state.currentUser) return;
      const { available } = getUserBalances(state.currentUser.id);
      document.getElementById("wd-amount").value = available;
    });

    document.getElementById("withdraw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentUser) return;

      const method = document.getElementById("wd-method").value;
      const MIN_WD = getMinWithdrawByMethod(method);
      const accountNumber = document.getElementById("wd-account-number").value.trim();
      const accountName = document.getElementById("wd-account-name").value.trim();
      const amount = parseInt(document.getElementById("wd-amount").value, 10) || 0;

      const { available } = getUserBalances(state.currentUser.id);

      if (amount < MIN_WD) {
        return showToast(`Minimal penarikan untuk ${method} adalah ${formatIDR(MIN_WD)}.`);
      }
      if (amount > available) {
        return showToast("Saldo siap tarik Anda tidak mencukupi.");
      }
      if (!accountNumber || !accountName) {
        return showToast("Lengkapi nomor tujuan dan nama penerima.");
      }

      const wdItem = {
        id: "wd-" + Date.now(),
        user_id: state.currentUser.id,
        username: state.currentUser.username,
        method,
        account_number: accountNumber,
        account_name: accountName,
        amount,
        status: "pending",
        created_at: new Date().toISOString()
      };

      if (sb) {
        const { error } = await sb.from("withdrawals").insert([wdItem]);
        if (error) {
          return showToast("Gagal simpan penarikan: " + error.message);
        }
        await syncFromSupabase(true);
      } else {
        state.withdrawals.unshift(wdItem);
      }
      saveLocalState();
      e.target.reset();
      updateWithdrawMethodUI();
      renderAllViews();
      showToast("Permintaan penarikan " + formatIDR(amount) + " berhasil dikirim!");
    });
  }

  function renderWithdrawView() {
    if (!state.currentUser) return;
    updateWithdrawMethodUI();
    const { available } = getUserBalances(state.currentUser.id);
    document.getElementById("wd-available-balance").textContent = formatIDR(available);

    const myWds = (state.withdrawals || []).filter((w) => w.user_id === state.currentUser.id);
    document.getElementById("wd-history-count").textContent = `${myWds.length} Riwayat`;

    const listEl = document.getElementById("user-withdraws-list");
    if (!myWds.length) {
      listEl.innerHTML = `<p class="muted-text">Belum ada riwayat penarikan saldo.</p>`;
      return;
    }

    listEl.innerHTML = myWds
      .map(
        (w) => `
        <div class="list-item">
          <div class="list-item-top">
            <strong>${formatIDR(w.amount)} • ${w.method}</strong>
            <span class="status-tag ${w.status}">${w.status}</span>
          </div>
          <span class="hint-text">${w.account_number} (${w.account_name}) • ${formatDate(w.created_at)}</span>
        </div>`
      )
      .join("");
  }

  async function processWithdrawDecision(wdId, decision) {
    const wd = (state.withdrawals || []).find((w) => w.id === wdId);
    if (!wd) return;

    wd.status = decision; // approved | rejected
    const labelMap = {
      approved: "Disetujui & Sudah Ditransfer",
      rejected: "Ditolak (Saldo Dikembalikan)"
    };

    const notif = {
      id: "ntf-" + Date.now(),
      user_id: wd.user_id,
      title: "Update Penarikan Saldo",
      message: `Penarikan ${formatIDR(wd.amount)} ke ${wd.method} (${wd.account_number}) ${labelMap[decision]}.`,
      is_read: false,
      created_at: new Date().toISOString()
    };
    state.notifications.unshift(notif);

    if (sb) {
      const { error } = await sb.from("withdrawals").update({ status: decision }).eq("id", wd.id);
      if (error) {
        return showToast("Gagal update penarikan: " + error.message);
      }
      await sb.from("notifications").insert([notif]).catch(() => {});
      await syncFromSupabase(true);
    }
    saveLocalState();
    renderAllViews();
    showToast("Status penarikan diperbarui: " + decision.toUpperCase());
  }

  // ==========================================
  // 5. PROFIL, NOTIFIKASI, & LAPORAN
  // ==========================================
  function initProfileAndFeedback() {
    document.getElementById("profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentUser) return;
      const newUsername = document.getElementById("edit-username").value.trim();
      if (newUsername.length < 3) return showToast("Username minimal 3 karakter.");

      state.currentUser.username = newUsername;
      const uIdx = state.users.findIndex((u) => u.id === state.currentUser.id);
      if (uIdx !== -1) state.users[uIdx].username = newUsername;

      if (sb) {
        await sb.auth.updateUser({ data: { username: newUsername } }).catch(() => {});
      }
      saveLocalState();
      renderAllViews();
      showToast("Username berhasil diperbarui!");
    });

    document.getElementById("profile-avatar-input").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file || !state.currentUser) return;
      const reader = new FileReader();
      reader.onload = async () => {
        state.currentUser.avatar = reader.result;
        const uIdx = state.users.findIndex((u) => u.id === state.currentUser.id);
        if (uIdx !== -1) state.users[uIdx].avatar = reader.result;
        saveLocalState();
        renderAllViews();
        showToast("Foto profil diperbarui!");
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("feedback-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentUser) return;
      const category = document.getElementById("feedback-category").value;
      const message = document.getElementById("feedback-message").value.trim();

      const fb = {
        id: "fb-" + Date.now(),
        user_id: state.currentUser.id,
        username: state.currentUser.username,
        category,
        message,
        created_at: new Date().toISOString()
      };
      state.feedbacks.unshift(fb);
      if (sb) {
        await sb.from("feedbacks").insert([fb]).catch(() => {});
      }
      saveLocalState();
      e.target.reset();
      renderAdminView();
      showToast("Laporan / umpan balik terkirim ke Admin.");
    });

    document.getElementById("btn-mark-all-read").addEventListener("click", async () => {
      if (!state.currentUser) return;
      state.notifications.forEach((n) => {
        if (n.user_id === state.currentUser.id) n.is_read = true;
      });
      if (sb) {
        await sb.from("notifications").update({ is_read: true }).eq("user_id", state.currentUser.id).catch(() => {});
      }
      saveLocalState();
      renderNotifications();
      showToast("Semua notifikasi ditandai dibaca.");
    });
  }

  // ==========================================
  // 6. ADMIN PANEL (Buka/Tutup, 1-Klik Queue, Info Dashboard)
  // ==========================================
  function initAdminControls() {
    const syncBtn = document.getElementById("btn-admin-sync");
    if (syncBtn) {
      syncBtn.addEventListener("click", async () => {
        showToast("Menyinkronkan data dari Supabase...");
        await syncFromSupabase(true);
        renderAllViews();
        showToast("Data terbaru berhasil dimuat!");
      });
    }

    document.getElementById("toggle-good-btn").addEventListener("click", async () => {
      state.settings.good_open = !state.settings.good_open;
      await persistSettings();
      showToast("Jalur Gmail Good: " + (state.settings.good_open ? "DIBUKA" : "DITUTUP"));
    });

    document.getElementById("toggle-captha-btn").addEventListener("click", async () => {
      state.settings.captha_open = !state.settings.captha_open;
      await persistSettings();
      showToast("Jalur Gmail Captha: " + (state.settings.captha_open ? "DIBUKA" : "DITUTUP"));
    });

    document.getElementById("toggle-pass-sgsg-btn").addEventListener("click", async () => {
      state.settings.pass_sgsg1122 = !state.settings.pass_sgsg1122;
      await persistSettings();
      showToast("Sandi sgsg1122: " + (state.settings.pass_sgsg1122 ? "ON" : "OFF"));
    });

    document.getElementById("toggle-pass-gold-btn").addEventListener("click", async () => {
      state.settings.pass_goldacok = !state.settings.pass_goldacok;
      await persistSettings();
      showToast("Sandi goldacok: " + (state.settings.pass_goldacok ? "ON" : "OFF"));
    });

    document.getElementById("admin-info-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("admin-info-title").value.trim();
      const content = document.getElementById("admin-info-content").value.trim();
      const infoItem = {
        id: "info-" + Date.now(),
        title,
        content,
        created_at: new Date().toISOString()
      };
      state.dashboardInfos.unshift(infoItem);
      if (sb) {
        await sb.from("dashboard_infos").insert([infoItem]).catch(() => {});
      }
      saveLocalState();
      e.target.reset();
      updateWithdrawMethodUI();
      renderAllViews();
      showToast("Informasi berhasil diterbitkan ke Dashboard!");
    });

    document.getElementById("admin-info-manage-list").addEventListener("click", async (e) => {
      const delBtn = e.target.closest("[data-del-info]");
      if (!delBtn) return;
      const id = delBtn.dataset.delInfo;
      state.dashboardInfos = state.dashboardInfos.filter((i) => i.id !== id);
      if (sb) {
        await sb.from("dashboard_infos").delete().eq("id", id).catch(() => {});
      }
      saveLocalState();
      renderAllViews();
      showToast("Informasi dihapus.");
    });

    // Delegasi tombol 1-klik antrean verifikasi
    document.getElementById("admin-queue-card").addEventListener("click", async (e) => {
      const copyEmail = e.target.closest("[data-q-copy-email]");
      const copyPass = e.target.closest("[data-q-copy-pass]");
      const decideBtn = e.target.closest("[data-q-decide]");

      if (copyEmail) {
        return copyText(copyEmail.dataset.qCopyEmail, "Email disalin! Tempel di tab penyamaran.");
      }
      if (copyPass) {
        return copyText(copyPass.dataset.qCopyPass, "Sandi disalin!");
      }
      if (decideBtn) {
        const id = decideBtn.dataset.id;
        const decision = decideBtn.dataset.qDecide; // good | captha | rejected
        await processDepositDecision(id, decision);
      }
    });

    document.getElementById("admin-withdraw-list").addEventListener("click", async (e) => {
      const copyAcc = e.target.closest("[data-wd-copy]");
      const actBtn = e.target.closest("[data-wd-decide]");
      if (copyAcc) {
        return copyText(copyAcc.dataset.wdCopy, "Nomor tujuan disalin!");
      }
      if (actBtn) {
        await processWithdrawDecision(actBtn.dataset.id, actBtn.dataset.wdDecide);
      }
    });
  }

  async function persistSettings() {
    if (sb) {
      const { error } = await sb.from("app_settings").upsert([{ id: 1, ...state.settings }]);
      if (error) {
        showToast("Gagal simpan pengaturan: " + error.message);
      } else {
        await syncFromSupabase(true);
      }
    }
    saveLocalState();
    renderAllViews();
  }

  async function processDepositDecision(depositId, decision) {
    const dep = state.deposits.find((d) => d.id === depositId);
    if (!dep) return;

    dep.status = decision;
    if (decision === "good") {
      dep.reward_idr = CFG.RATES_IDR.good || 3200;
    } else if (decision === "captha") {
      dep.reward_idr = CFG.RATES_IDR.captha || 1200;
    } else {
      dep.reward_idr = 0;
    }

    const labelMap = {
      good: "Disetujui (Gmail Good)",
      captha: "Disetujui (Gmail Captha)",
      rejected: "Ditolak (Tidak Sesuai Rules)"
    };

    const notif = {
      id: "ntf-" + Date.now(),
      user_id: dep.user_id,
      title: "Hasil Pengecekan Setoran",
      message: `Akun ${dep.gmail_address} berstatus: ${labelMap[decision]}.`,
      is_read: false,
      created_at: new Date().toISOString()
    };
    state.notifications.unshift(notif);

    if (sb) {
      const { error } = await sb.from("deposits").update({ status: dep.status, reward_idr: dep.reward_idr }).eq("id", dep.id);
      if (error) {
        return showToast("Gagal update status setoran: " + error.message);
      }
      await sb.from("notifications").insert([notif]).catch(() => {});
      await syncFromSupabase(true);
    }

    saveLocalState();
    renderAllViews();
    showToast(`Status diubah ke ${decision.toUpperCase()} & lanjut antrean berikutnya.`);
  }

  // ==========================================
  // 7. RENDER FUNCTIONS
  // ==========================================
  function renderApp() {
    const authScreen = document.getElementById("auth-screen");
    const mainLayout = document.getElementById("main-layout");

    if (!state.currentUser) {
      authScreen.classList.remove("hidden");
      mainLayout.classList.add("hidden");
      return;
    }

    authScreen.classList.add("hidden");
    mainLayout.classList.remove("hidden");
    renderAllViews();
  }

  function renderAllViews() {
    if (!state.currentUser) return;
    const isAdmin = isAdminUser(state.currentUser);

    document.getElementById("header-username").textContent = state.currentUser.username;
    document.getElementById("nav-admin-tab").classList.toggle("hidden", !isAdmin);

    renderDashboard();
    renderDepositView();
    renderWithdrawView();
    renderLeaderboard();
    renderNotifications();
    renderProfile();
    if (isAdmin) renderAdminView();
  }

  function renderDashboard() {
    const myDeposits = state.deposits.filter((d) => d.user_id === state.currentUser.id);
    const approved = myDeposits.filter((d) => d.status === "good" || d.status === "captha");
    const pending = myDeposits.filter((d) => d.status === "pending");
    const goodCount = myDeposits.filter((d) => d.status === "good").length;
    const capthaCount = myDeposits.filter((d) => d.status === "captha").length;
    const { totalIncome, available } = getUserBalances(state.currentUser.id);

    document.getElementById("dash-available-balance").textContent = formatIDR(available);
    document.getElementById("dash-total-income").textContent = formatIDR(totalIncome);
    document.getElementById("dash-approved-count").textContent = `${approved.length} Approved`;
    document.getElementById("dash-pending-count").textContent = pending.length;
    document.getElementById("dash-good-count").textContent = goodCount;
    document.getElementById("dash-captha-count").textContent = capthaCount;

    // Grafik Pendapatan Dinamis (7 hari terakhir)
    const chartEl = document.getElementById("income-chart");
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("id-ID", { weekday: "short" });
      const val = approved
        .filter((item) => (item.created_at || "").startsWith(key))
        .reduce((s, item) => s + Number(item.reward_idr || 0), 0);
      days.push({ label, val });
    }
    const maxVal = Math.max(...days.map((x) => x.val), 1000);
    chartEl.innerHTML = days
      .map((d) => {
        const pct = Math.max(8, Math.round((d.val / maxVal) * 100));
        const shortVal = d.val > 0 ? Math.round(d.val / 1000) + "k" : "0";
        return `
          <div class="chart-col">
            <span class="chart-val">${shortVal}</span>
            <div class="chart-bar" style="height:${pct}%"></div>
            <span class="chart-day">${d.label}</span>
          </div>`;
      })
      .join("");

    // Informasi Khusus Dashboard dari Admin Panel
    const infoBox = document.getElementById("dashboard-admin-info-list");
    if (!state.dashboardInfos.length) {
      infoBox.innerHTML = `<p class="muted-text">Belum ada informasi terbaru dari admin.</p>`;
    } else {
      infoBox.innerHTML = state.dashboardInfos
        .map(
          (info) => `
          <div class="list-item">
            <div class="list-item-top">
              <strong>${info.title}</strong>
              <span class="hint-text">${formatDate(info.created_at)}</span>
            </div>
            <p class="muted-text">${info.content}</p>
          </div>`
        )
        .join("");
    }
  }

  function renderDepositView() {
    const goodBadge = document.getElementById("status-good-badge");
    const capthaBadge = document.getElementById("status-captha-badge");

    goodBadge.textContent = state.settings.good_open ? "BUKA" : "TUTUP";
    goodBadge.className = "status-pill " + (state.settings.good_open ? "open" : "closed");

    capthaBadge.textContent = state.settings.captha_open ? "BUKA" : "TUTUP";
    capthaBadge.className = "status-pill " + (state.settings.captha_open ? "open" : "closed");

    updateDepositChannelAvailability();

    const myDeposits = state.deposits.filter((d) => d.user_id === state.currentUser.id);
    document.getElementById("user-deposit-total").textContent = `${myDeposits.length} Akun`;

    const listEl = document.getElementById("user-deposits-list");
    if (!myDeposits.length) {
      listEl.innerHTML = `<p class="muted-text">Belum ada riwayat setoran.</p>`;
      return;
    }

    listEl.innerHTML = myDeposits
      .map(
        (d) => `
        <div class="list-item">
          <div class="list-item-top">
            <strong>${d.gmail_address}</strong>
            <span class="status-tag ${d.status}">${d.status}</span>
          </div>
          <div class="list-item-top">
            <span class="hint-text">Kategori: ${d.category.toUpperCase()} • ${formatDate(d.created_at)}</span>
            <strong>${d.reward_idr > 0 ? formatIDR(d.reward_idr) : "-"}</strong>
          </div>
        </div>`
      )
      .join("");
  }

  function renderLeaderboard() {
    const MIN_REQUIRED = 100;
    const validDeposits = state.deposits.filter((d) => d.status === "good" || d.status === "captha");

    // Hitung per user
    const map = {};
    validDeposits.forEach((d) => {
      if (!map[d.user_id]) {
        map[d.user_id] = { user_id: d.user_id, username: d.username, count: 0 };
      }
      map[d.user_id].count += 1;
    });

    const myCount = map[state.currentUser.id]?.count || 0;
    const pct = Math.min(100, Math.round((myCount / MIN_REQUIRED) * 100));
    document.getElementById("lb-user-progress-text").textContent = `${myCount} / ${MIN_REQUIRED} Gmail`;
    document.getElementById("lb-user-progress-bar").style.width = pct + "%";
    document.getElementById("lb-user-status-msg").textContent =
      myCount >= MIN_REQUIRED
        ? "Selamat! Anda sudah memenuhi syarat minimal 100 Gmail di Leaderboard."
        : `Kurang ${MIN_REQUIRED - myCount} Gmail terverifikasi lagi untuk masuk papan peringkat.`;

    const qualified = Object.values(map)
      .filter((u) => u.count >= MIN_REQUIRED)
      .sort((a, b) => b.count - a.count);

    const listEl = document.getElementById("leaderboard-list");
    if (!qualified.length) {
      listEl.innerHTML = `<p class="muted-text">Belum ada peserta yang mencapai minimal 100 setoran Gmail terverifikasi.</p>`;
      return;
    }

    const prizes = ["Rp15.000", "Rp10.000", "Rp5.000"];
    listEl.innerHTML = qualified
      .map(
        (u, idx) => `
        <div class="list-item">
          <div class="list-item-top">
            <strong>#${idx + 1} ${u.username}</strong>
            <span class="badge-primary">${u.count} Gmail</span>
          </div>
          ${idx < 3 ? `<span class="hint-text">Estimasi Hadiah Peringkat: <strong>${prizes[idx]}</strong></span>` : ""}
        </div>`
      )
      .join("");
  }

  function renderNotifications() {
    const mine = state.notifications.filter((n) => n.user_id === state.currentUser.id);
    const unreadCount = mine.filter((n) => !n.is_read).length;

    const navBadge = document.getElementById("nav-notif-badge");
    const headerDot = document.getElementById("header-notif-dot");

    navBadge.textContent = unreadCount;
    navBadge.classList.toggle("hidden", unreadCount === 0);
    headerDot.classList.toggle("hidden", unreadCount === 0);

    const listEl = document.getElementById("notifications-list");
    if (!mine.length) {
      listEl.innerHTML = `<p class="muted-text">Belum ada notifikasi.</p>`;
      return;
    }

    listEl.innerHTML = mine
      .map(
        (n) => `
        <div class="list-item" style="${n.is_read ? "" : "border-color:#2563eb;"}">
          <div class="list-item-top">
            <strong>${n.title}</strong>
            <span class="hint-text">${formatDate(n.created_at)}</span>
          </div>
          <p class="muted-text">${n.message}</p>
        </div>`
      )
      .join("");
  }

  function renderProfile() {
    const u = state.currentUser;
    document.getElementById("profile-display-name").textContent = u.username;
    document.getElementById("profile-display-email").textContent = u.email;
    document.getElementById("profile-role-badge").textContent = isAdminUser(u) ? "Admin FIH" : "Member FIH";
    document.getElementById("edit-username").value = u.username;

    const avatarUrl =
      u.avatar ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=0f172a&color=fff`;
    document.getElementById("profile-avatar-preview").src = avatarUrl;
  }

  function renderAdminView() {
    const goodBtn = document.getElementById("toggle-good-btn");
    const capthaBtn = document.getElementById("toggle-captha-btn");

    goodBtn.textContent = state.settings.good_open ? "BUKA" : "TUTUP";
    goodBtn.classList.toggle("active", state.settings.good_open);

    capthaBtn.textContent = state.settings.captha_open ? "BUKA" : "TUTUP";
    capthaBtn.classList.toggle("active", state.settings.captha_open);

    const sgsgBtn = document.getElementById("toggle-pass-sgsg-btn");
    const goldBtn = document.getElementById("toggle-pass-gold-btn");
    if (sgsgBtn) {
      sgsgBtn.textContent = state.settings.pass_sgsg1122 ? "ON" : "OFF";
      sgsgBtn.classList.toggle("active", state.settings.pass_sgsg1122);
    }
    if (goldBtn) {
      goldBtn.textContent = state.settings.pass_goldacok ? "ON" : "OFF";
      goldBtn.classList.toggle("active", state.settings.pass_goldacok);
    }

    // Antrean 1 per 1
    const pendingQueue = state.deposits.filter((d) => d.status === "pending");
    document.getElementById("admin-queue-count").textContent = `${pendingQueue.length} Antrean`;

    const queueBox = document.getElementById("admin-queue-card");
    if (!pendingQueue.length) {
      queueBox.innerHTML = `<p class="muted-text">Semua antrean setoran sudah selesai diperiksa.</p>`;
    } else {
      const current = pendingQueue[pendingQueue.length - 1]; // FIFO terlama dulu
      queueBox.innerHTML = `
        <div class="list-item-top">
          <span class="badge-primary">Target: ${current.category.toUpperCase()}</span>
          <span class="hint-text">Penyetor: ${current.username}</span>
        </div>
        <div>
          <p class="hint-text">Email Gmail</p>
          <strong>${current.gmail_address}</strong>
        </div>
        <div>
          <p class="hint-text">Kata Sandi</p>
          <strong>${current.gmail_password}</strong>
        </div>
        ${current.note ? `<p class="hint-text">Catatan: ${current.note}</p>` : ""}
        <div class="queue-actions-copy">
          <button type="button" class="btn btn-secondary btn-sm" data-q-copy-email="${current.gmail_address}">Salin Email</button>
          <button type="button" class="btn btn-secondary btn-sm" data-q-copy-pass="${current.gmail_password}">Salin Sandi</button>
        </div>
        <div class="queue-actions-decision">
          <button type="button" class="btn btn-primary btn-sm" data-id="${current.id}" data-q-decide="good">Good</button>
          <button type="button" class="btn btn-secondary btn-sm" data-id="${current.id}" data-q-decide="captha">Captha</button>
          <button type="button" class="btn btn-danger btn-sm" data-id="${current.id}" data-q-decide="rejected">Tolak</button>
        </div>
      `;
    }

    // Kelola Permintaan Penarikan User
    const allWds = state.withdrawals || [];
    const pendingWds = allWds.filter((w) => w.status === "pending");
    document.getElementById("admin-wd-count").textContent = `${pendingWds.length} Pending`;

    const adminWdList = document.getElementById("admin-withdraw-list");
    adminWdList.innerHTML = allWds.length
      ? allWds
          .map(
            (w) => `
          <div class="list-item">
            <div class="list-item-top">
              <strong>${w.username} • ${formatIDR(w.amount)}</strong>
              <span class="status-tag ${w.status}">${w.status}</span>
            </div>
            <span class="hint-text">${w.method}: <strong>${w.account_number}</strong> (${w.account_name}) • ${formatDate(w.created_at)}</span>
            ${
              w.status === "pending"
                ? `<div class="wd-admin-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-wd-copy="${w.account_number}">Salin No</button>
                    <button type="button" class="btn btn-primary btn-sm" data-id="${w.id}" data-wd-decide="approved">ACC / Transfer</button>
                    <button type="button" class="btn btn-danger btn-sm" data-id="${w.id}" data-wd-decide="rejected">Tolak</button>
                  </div>`
                : ""
            }
          </div>`
          )
          .join("")
      : `<p class="muted-text">Belum ada permintaan penarikan saldo.</p>`;

    // Kelola Informasi Dashboard
    const infoManage = document.getElementById("admin-info-manage-list");
    infoManage.innerHTML = state.dashboardInfos
      .map(
        (info) => `
        <div class="list-item">
          <div class="list-item-top">
            <strong>${info.title}</strong>
            <button type="button" class="text-btn" data-del-info="${info.id}">Hapus</button>
          </div>
          <p class="muted-text">${info.content}</p>
        </div>`
      )
      .join("");

    // Laporan & Umpan Balik User
    const fbList = document.getElementById("admin-feedback-list");
    fbList.innerHTML = state.feedbacks.length
      ? state.feedbacks
          .map(
            (f) => `
          <div class="list-item">
            <div class="list-item-top">
              <strong>${f.username} (${f.category})</strong>
              <span class="hint-text">${formatDate(f.created_at)}</span>
            </div>
            <p class="muted-text">${f.message}</p>
          </div>`
          )
          .join("")
      : `<p class="muted-text">Belum ada laporan masuk.</p>`;

    // Log Aktivitas Login User
    const logList = document.getElementById("admin-login-logs");
    logList.innerHTML = state.loginLogs.length
      ? state.loginLogs
          .map(
            (l) => `
          <div class="list-item">
            <div class="list-item-top">
              <strong>${l.username}</strong>
              <span class="hint-text">${formatDate(l.logged_at)}</span>
            </div>
            <span class="hint-text">${l.email}</span>
          </div>`
          )
          .join("")
      : `<p class="muted-text">Belum ada log aktivitas login.</p>`;
  }

  // Bootstrap
  document.addEventListener("DOMContentLoaded", async () => {
    initAuthUI();
    initNavigation();
    initGenerator();
    initDeposit();
    initWithdraw();
    initProfileAndFeedback();
    initAdminControls();

    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data && data.session && data.session.user) {
        const u = data.session.user;
        const meta = u.user_metadata || {};
        state.currentUser = {
          id: u.id,
          email: u.email,
          username: meta.username || u.email.split("@")[0],
          role: isAdminUser({ email: u.email }) ? "admin" : "member",
          avatar: meta.avatar || ""
        };
        await syncFromSupabase(true);
      }
    }
    renderApp();
  });
})();
