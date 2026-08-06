// =========================================================================
// KONFIGURASI API — WAJIB DIISI SEBELUM DIPAKAI
// =========================================================================
const API_URL = "https://script.google.com/macros/s/AKfycbz25Fw_ceLoiFivtuYqHd9V5cM7phQ82fBE-GfhsqChGGMtTbzhAm2SDMYxc0sNOb1k/exec";
const API_KEY = "sk_live_4zXHlUp57mSaUjEcXrdXuaw8UrHGsUxK";

// =========================================================================
// STATE GLOBAL
// =========================================================================
let isLoggedIn = false;
let currentUser = null; // { username, nama, role, unit }
let currentEditId = null;
let fp;
let chartSNPInstance = null;
let chartUnitInstance = null;
let calendar;
let semuaDataKalender = [];
let daftarRingkasanCache = [];
let semuaDataRealisasiCache = []; // untuk filter riwayat
let pengaturanAksesCache = null;
const kegiatanCache = new Map(); // cache getKegiatanById

const DAFTAR_TAB_KEY = ['form', 'daftar', 'rekap', 'sumberdana', 'kalender', 'realisasi'];

// =========================================================================
// XSS SANITIZATION — mencegah injeksi HTML dari data user
// =========================================================================
function esc_(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =========================================================================
// API LAYER — dengan token sesi
// =========================================================================
async function callAPI(action, payload) {
  const token = localStorage.getItem('raks_token');
  const body = { action: action, apiKey: API_KEY, payload: payload || {} };
  if (token) body.token = token;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.success) {
    // Jika session expired, tawarkan login ulang
    if (json.code === 'SESSION_EXPIRED') {
      handleSessionExpired();
    }
    throw new Error(json.error || 'Terjadi kesalahan pada server');
  }
  return json.data;
}

function handleSessionExpired() {
  clearSession();
  toast("Sesi Anda telah berakhir. Silakan login kembali.", "error");
  if (requiresLoginForCurrentAction()) {
    bukaModalLogin();
  }
}

function requiresLoginForCurrentAction() {
  // Cek apakah halaman aktif membutuhkan login
  const activeTab = document.querySelector('#navTabs .tab-btn.active');
  if (!activeTab) return false;
  const id = activeTab.id.replace('tab-', '');
  return id === 'form' || id === 'admin';
}

// =========================================================================
// SESSION MANAGEMENT (localStorage)
// =========================================================================
function saveSession(token, user) {
  localStorage.setItem('raks_token', token);
  localStorage.setItem('raks_user', JSON.stringify(user));
  isLoggedIn = true;
  currentUser = user;
  renderUserStatus();
}

function loadSession() {
  const token = localStorage.getItem('raks_token');
  const userStr = localStorage.getItem('raks_user');
  if (token && userStr) {
    try {
      currentUser = JSON.parse(userStr);
      isLoggedIn = true;
    } catch (e) {
      clearSession();
    }
  }
}

function clearSession() {
  localStorage.removeItem('raks_token');
  localStorage.removeItem('raks_user');
  isLoggedIn = false;
  currentUser = null;
  renderUserStatus();
}

function getToken() {
  return localStorage.getItem('raks_token');
}

// =========================================================================
// LOGIN / LOGOUT UI
// =========================================================================
function renderUserStatus() {
  const guestEl = document.getElementById('sidebarGuest');
  const userEl = document.getElementById('sidebarUser');
  const tabAdmin = document.getElementById('tab-admin');

  if (isLoggedIn && currentUser) {
    guestEl.classList.add('hidden');
    userEl.classList.remove('hidden');
    document.getElementById('userNameDisplay').textContent = currentUser.nama;
    document.getElementById('userRoleDisplay').textContent =
      currentUser.role === 'admin' ? '👑 Admin' :
      currentUser.role === 'kepsek' ? '🏫 Kepsek' :
      '📋 Waka ' + (currentUser.unit || '');

    // Tab admin hanya untuk admin
    if (currentUser.role === 'admin') {
      tabAdmin.classList.remove('hidden');
    } else {
      tabAdmin.classList.add('hidden');
    }
  } else {
    guestEl.classList.remove('hidden');
    userEl.classList.add('hidden');
    tabAdmin.classList.add('hidden');
  }

  // Terapkan pengaturan akses tab
  terapkanPengaturanAksesUI();
}

function bukaModalLogin() {
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginError').textContent = '';
  openModal('modalLogin');
  document.getElementById('loginUsername').focus();
}

async function prosesLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('btnProsesLogin');

  if (!username || !password) {
    errEl.textContent = 'Username dan password wajib diisi.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Masuk...';
  errEl.classList.add('hidden');

  try {
    const data = await callAPI('login', { username: username, password: password });
    saveSession(data.token, data.user);
    closeModal('modalLogin');
    toast('Berhasil login sebagai ' + data.user.nama + '.', 'success');
    // Reload data setelah login (backend mungkin filter berbeda)
    loadDaftarGuru();
    loadDataDashboard();
    loadDaftarKegiatan();
    loadDataKalender();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
}

async function logoutUI() {
  try {
    await callAPI('logout');
  } catch (e) { /* abaikan error logout */ }
  clearSession();
  toast('Berhasil logout.', 'success');
  // Jika di halaman admin, pindah ke dashboard
  const activeTab = document.querySelector('#navTabs .tab-btn.active');
  if (activeTab && activeTab.id === 'tab-admin') {
    gantiHalaman('rekap');
  }
}

// =========================================================================
// REQUIRE LOGIN GUARD — untuk aksi yang butuh autentikasi
// =========================================================================
function requireLoginAndDo(action) {
  if (isLoggedIn) {
    executeAction(action);
  } else {
    // Simpan aksi yang diminta, setelah login akan dijalankan
    window._pendingAction = action;
    bukaModalLogin();
    toast('Silakan login terlebih dahulu untuk mengakses fitur ini.', 'error');
  }
}

function executeAction(action) {
  switch (action) {
    case 'form':
      gantiHalaman('form');
      break;
    case 'simpanDana':
      simpanKonfigurasiDana();
      break;
    case 'ajukanRealisasi':
      ajukanRealisasiUI();
      break;
    case 'kunciKegiatan':
      // handled by specific function with ID param
      break;
    case 'setujuiRealisasi':
      // handled by specific function
      break;
    default:
      break;
  }
}

// Cek dan jalankan pending action setelah login
function checkPendingAction() {
  if (window._pendingAction && isLoggedIn) {
    const action = window._pendingAction;
    window._pendingAction = null;
    executeAction(action);
  }
}

// Override prosesLogin untuk handle pending action
const _originalProsesLogin = prosesLogin;
prosesLogin = async function() {
  await _originalProsesLogin.call(this);
  if (isLoggedIn) {
    checkPendingAction();
  }
};

// =========================================================================
// TOAST NOTIFIKASI
// =========================================================================
function toast(pesan, tipe) {
  const stack = document.getElementById('toastStack');
  // Batasi max 5 toast sekaligus
  while (stack.children.length >= 5) stack.removeChild(stack.firstChild);
  const el = document.createElement('div');
  el.className = 'toast' + (tipe === 'error' ? ' error' : tipe === 'success' ? ' success' : '');
  el.textContent = pesan;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// =========================================================================
// SIDEBAR MOBILE
// =========================================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('navBackdrop').classList.toggle('hidden');
}

// =========================================================================
// NAVIGASI TAB
// =========================================================================
function gantiHalaman(halaman) {
  if (halaman === 'admin' && (!isLoggedIn || !currentUser || currentUser.role !== 'admin')) {
    toast("Login sebagai Admin dulu untuk mengakses panel ini.", "error");
    if (!isLoggedIn) bukaModalLogin();
    return;
  }

  ['form', 'rekap', 'daftar', 'sumberdana', 'kalender', 'realisasi', 'admin'].forEach(id => {
    const halamanEl = document.getElementById('halaman-' + id);
    const tabEl = document.getElementById('tab-' + id);
    if (halamanEl) halamanEl.classList.add('hidden');
    if (tabEl) tabEl.classList.remove('active');
  });
  document.getElementById('halaman-' + halaman).classList.remove('hidden');
  document.getElementById('tab-' + halaman).classList.add('active');

  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('navBackdrop').classList.add('hidden');

  if (halaman === 'realisasi') { loadRingkasanAnggaran(); loadRiwayatRealisasi(); loadKegiatanFinalUntukRealisasi(); loadAntreanPersetujuan(); }
  if (halaman === 'admin') { isiFormPengaturanAksesAdmin(); loadUsers(); }
}

// =========================================================================
// MODAL
// =========================================================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// =========================================================================
// INISIALISASI
// =========================================================================
window.onload = async function () {
  initFlatpickr();
  initCalendar();

  // Load session yang tersimpan
  loadSession();
  renderUserStatus();

  // Load data secara PARALEL (semua independent, kurangi waktu load)
  await Promise.all([
    loadDaftarGuru(),
    loadDataDashboard(),
    loadDaftarKegiatan(),
    loadSumberDana(),
    loadDataKalender()
  ]);
  hitungDana();
  tambahBaris(true); // baris pertama form rincian
  await loadPengaturanAkses();

  // Set unit otomatis untuk waka
  if (isLoggedIn && currentUser && currentUser.role === 'waka' && currentUser.unit) {
    const unitEl = document.getElementById('unit');
    if (unitEl) { unitEl.value = currentUser.unit; unitEl.disabled = true; }
  }
};

// =========================================================================
// FORM INPUT RAK
// =========================================================================
function initFlatpickr() {
  fp = flatpickr("#inputPelaksanaan", { mode: "range", dateFormat: "d-m-Y", allowInput: true });
}

function togglePelaksanaan() {
  const tipe = document.getElementById('tipePelaksanaan').value;
  const input = document.getElementById('inputPelaksanaan');
  if (tipe === 'teks') {
    fp.destroy();
    input.value = "";
    input.placeholder = "Contoh: Setiap Bulan";
  } else {
    initFlatpickr();
    input.placeholder = "Pilih tanggal rentang";
  }
}

function tambahBaris(skipIfExists) {
  if (skipIfExists && document.querySelectorAll('#bodyRincian tr').length > 0) return;
  const tbody = document.getElementById('bodyRincian');
  const row = `<tr>
    <td><input type="text" class="cell-input komponen" required></td>
    <td><input type="number" class="cell-input volume" value="0" style="width:70px" onfocus="if(this.value=='0') this.value=''" onblur="if(this.value=='') this.value='0'" oninput="hitungTotal()" required></td>
    <td><input type="text" class="cell-input satuan" style="width:90px" required></td>
    <td><input type="number" class="cell-input harga" value="0" style="width:110px" onfocus="if(this.value=='0') this.value=''" onblur="if(this.value=='') this.value='0'" oninput="hitungTotal()" required></td>
    <td><input type="number" class="cell-input jumlah readonly" style="width:120px" readonly value="0"></td>
    <td><select class="cell-input snp"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option></select></td>
    <td><select class="cell-input sumber"><option value="IKT">IKT</option><option value="BOS">BOS</option></select></td>
    <td class="center"><button type="button" class="btn-secondary btn-sm" onclick="hapusBaris(this)">✕</button></td>
  </tr>`;
  tbody.insertAdjacentHTML('beforeend', row);
}

function hapusBaris(btn) {
  if (document.querySelectorAll('#bodyRincian tr').length > 1) {
    btn.closest('tr').remove();
    hitungTotal();
  } else {
    toast("Minimal harus ada 1 komponen belanja!", "error");
  }
}

function hitungTotal() {
  let grandTotal = 0;
  document.querySelectorAll('#bodyRincian tr').forEach(row => {
    const vol = parseFloat(row.querySelector('.volume').value) || 0;
    const harga = parseFloat(row.querySelector('.harga').value) || 0;
    const subtotal = vol * harga;
    row.querySelector('.jumlah').value = subtotal;
    grandTotal += subtotal;
  });
  document.getElementById('labelGrandTotal').innerText = grandTotal.toLocaleString('id-ID');
}

function batalForm() {
  currentEditId = null;
  document.getElementById('judulFormRAK').innerText = "Input Rencana Anggaran Kegiatan (RAK)";
  const btn = document.getElementById('btnSimpan');
  btn.innerText = "SIMPAN RENCANA KEGIATAN";
  btn.classList.remove('btn-warning');
  btn.classList.add('btn-primary');
  document.getElementById("formRAK").reset();
  document.getElementById("labelGrandTotal").innerText = "0";
  document.getElementById('bodyRincian').innerHTML = '';
  tambahBaris();
  // Re-lock unit untuk waka
  if (isLoggedIn && currentUser && currentUser.role === 'waka' && currentUser.unit) {
    const unitEl = document.getElementById('unit');
    if (unitEl) { unitEl.value = currentUser.unit; unitEl.disabled = true; }
  }
}

// =========================================================================
// INTEGRASI BACKEND — REFERENSI
// =========================================================================
function loadDaftarGuru() {
  return callAPI('getDaftarGuru').then(data => {
    let options = '';
    data.forEach(nama => { options += `<option value="${esc_(nama)}">`; });
    document.getElementById('listGuru').innerHTML = options;
    // Update datalist form RAK juga
    document.getElementById('listGuruForm').innerHTML = options;
  }).catch(err => console.error(err));
}

// =========================================================================
// DASHBOARD
// =========================================================================
function loadDataDashboard() {
  return callAPI('getDataDashboard').then(data => {
    if (!data) return;

    document.getElementById('heroBOS').innerText = formatRupiah(data.pemasukanBOS);
    document.getElementById('heroBOSsub').innerText = "Rencana Anggaran: " + formatRupiah(data.totalBOS);
    document.getElementById('heroIKT').innerText = formatRupiah(data.pemasukanIKT);
    document.getElementById('heroIKTsub').innerText = "Rencana Anggaran: " + formatRupiah(data.totalIKT);
    document.getElementById('heroTotal').innerText = formatRupiah(data.pemasukanTotal);
    document.getElementById('heroTotalSub').innerText = "Rencana Anggaran: " + formatRupiah(data.totalAnggaran);

    const selisihTotal = data.pemasukanTotal - data.totalAnggaran;
    const cardTotal = document.getElementById('heroCardTotal');
    cardTotal.classList.remove('accent-red', 'accent-green');
    cardTotal.classList.add(selisihTotal < 0 ? 'accent-red' : 'accent-green');
    document.getElementById('heroTotalStatus').innerText = selisihTotal < 0
      ? "Defisit " + formatRupiah(selisihTotal)
      : (selisihTotal === 0 ? "Seimbang" : "Surplus +" + formatRupiah(selisihTotal));

    // Hero card realisasi
    document.getElementById('heroRealisasi').innerText = formatRupiah(data.realisasiDisetujui);
    document.getElementById('heroRealisasiSub').innerText =
      "Disetujui: " + formatRupiah(data.realisasiDisetujui) + " · Pending: " + formatRupiah(data.realisasiPending);
    const persenRealisasi = data.totalAnggaran > 0
      ? Math.round((data.realisasiDisetujui / data.totalAnggaran) * 100) : 0;
    document.getElementById('heroRealisasiStatus').innerText = persenRealisasi + "% anggaran terealisasi";

    const namaSNP = ["Kompetensi Lulusan", "Standar Isi", "Standar Proses", "Sistem Penilaian", "Pendidik & Tendik", "Sarana Prasarana", "Standar Pengelolaan", "Standar Pembiayaan"];
    let htmlTabel = '';
    if (data.snp && data.snp.forEach) {
      data.snp.forEach((nilai, index) => {
        htmlTabel += `<tr><td>${index + 1}. ${namaSNP[index]}</td><td class="num">${formatRupiah(nilai)}</td></tr>`;
      });
      document.getElementById('bodyTabelSNP').innerHTML = htmlTabel;
    }

    const canvasSNP = document.getElementById('grafikSNP');
    if (canvasSNP && data.snp) {
      if (chartSNPInstance) chartSNPInstance.destroy();
      chartSNPInstance = new Chart(canvasSNP.getContext('2d'), {
        type: 'bar',
        data: { labels: ['SNP 1', 'SNP 2', 'SNP 3', 'SNP 4', 'SNP 5', 'SNP 6', 'SNP 7', 'SNP 8'],
                 datasets: [{ label: 'Anggaran (Rp)', data: data.snp, backgroundColor: '#DC2626', borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }

    const canvasUnit = document.getElementById('grafikUnit');
    if (canvasUnit && data.unit) {
      if (chartUnitInstance) chartUnitInstance.destroy();
      chartUnitInstance = new Chart(canvasUnit.getContext('2d'), {
        type: 'bar',
        data: { labels: Object.keys(data.unit),
                 datasets: [{ label: 'Total Anggaran', data: Object.values(data.unit), backgroundColor: ['#111827', '#DC2626', '#D97706', '#7C3AED', '#059669'], borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }
  }).catch(err => toast("Gagal memuat dashboard: " + err.message, "error"));
}

// =========================================================================
// DAFTAR KEGIATAN
// =========================================================================
function loadDaftarKegiatan() {
  const tbody = document.getElementById('bodyDaftarKegiatan');
  if (!tbody) return Promise.resolve();
  tbody.innerHTML = '<tr class="table-loading-row"><td colspan="11">Memuat data dari server...</td></tr>';

  return callAPI('getDaftarKegiatan').then(data => {
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr class="table-loading-row"><td colspan="11">Belum ada data anggaran yang diinput.</td></tr>';
      return;
    }
    let barisHTML = '';
    data.forEach((item, index) => {
      const isFinal = item.status === 'FINAL';
      const badgeStatus = isFinal ? '<span class="badge badge-ungu">🔒 FINAL</span>' : '<span class="badge">DRAFT</span>';
      const tombolEdit = isFinal
        ? `<button disabled title="Terkunci">📝</button>`
        : `<button onclick="editKegiatan('${esc_(item.id)}', this)" title="Edit">📝</button>`;
      const tombolHapus = isFinal
        ? `<button disabled title="Terkunci">🗑️</button>`
        : `<button onclick="hapusKegiatan('${esc_(item.id)}')" title="Hapus">🗑️</button>`;
      const tombolKunci = isFinal
        ? `<button onclick="bukaKunciKegiatanUI('${esc_(item.id)}')" title="Buka Kunci">🔓</button>`
        : `<button onclick="kunciKegiatanUI('${esc_(item.id)}')" title="Kunci RAKS">🔒</button>`;

      barisHTML += `
        <tr>
          <td class="center">${index + 1}</td>
          <td class="mono">${esc_(item.waktu)}</td>
          <td>${esc_(item.program)}</td>
          <td>${esc_(item.nama)}</td>
          <td class="num">${formatRupiah(item.danaBOS)}</td>
          <td class="num">${formatRupiah(item.danaIKT)}</td>
          <td class="num" style="font-weight:700;color:#059669">${formatRupiah(item.total)}</td>
          <td>${esc_(item.pj)}</td>
          <td class="center">${esc_(item.snp)}</td>
          <td>${esc_(item.unit)}</td>
          <td class="center">${badgeStatus}</td>
        </tr>
        <tr>
          <td colspan="11" style="padding:0;border-bottom:2px solid var(--border);">
            <div class="row-actions" style="justify-content:flex-end;padding:2px 12px 8px;">
              <button onclick="lihatDetail('${esc_(item.id)}')" title="Detail">🔍</button>
              ${tombolEdit} ${tombolHapus} ${tombolKunci}
            </div>
          </td>
        </tr>`;
    });
    tbody.innerHTML = barisHTML;
  }).catch(err => { tbody.innerHTML = `<tr class="table-loading-row"><td colspan="11" style="color:var(--red-dark)">Gagal memuat: ${esc_(err.message)}</td></tr>`; });
}

// =========================================================================
// SIMPAN / EDIT / HAPUS
// =========================================================================
function editKegiatan(idKegiatan, btnElement) {
  if (!isLoggedIn) { requireLoginAndDo('form'); return; }
  const btnEdit = btnElement;
  let originalText = "📝";
  if (btnEdit) { originalText = btnEdit.innerText; btnEdit.innerText = "⏳"; btnEdit.disabled = true; }

  // Cek cache dulu
  const cached = kegiatanCache.get(idKegiatan);
  if (cached) {
    applyEditData(cached, idKegiatan);
    if (btnEdit) { btnEdit.innerText = originalText; btnEdit.disabled = false; }
    return;
  }

  callAPI('getKegiatanById', { idKegiatan: idKegiatan }).then(data => {
    kegiatanCache.set(idKegiatan, data);
    applyEditData(data, idKegiatan);
    if (btnEdit) { btnEdit.innerText = originalText; btnEdit.disabled = false; }
  }).catch(err => { toast("Gagal memuat data: " + err.message, "error"); if (btnEdit) { btnEdit.innerText = originalText; btnEdit.disabled = false; } });
}

function applyEditData(data, idKegiatan) {
  currentEditId = idKegiatan;
  gantiHalaman('form');
  document.getElementById('judulFormRAK').innerText = "Edit Rencana Anggaran (ID: " + idKegiatan + ")";
  const btnSimpan = document.getElementById('btnSimpan');
  btnSimpan.innerText = "UPDATE DATA KEGIATAN";
  btnSimpan.classList.remove('btn-primary');
  btnSimpan.classList.add('btn-warning');

  if (data && data.identitas) {
    document.getElementById('unit').value = data.identitas.unit || "";
    document.getElementById('program').value = data.identitas.program || "";
    document.getElementById('kegiatan').value = data.identitas.kegiatan || "";
    document.getElementById('pjInput').value = data.identitas.pj || "";
    document.getElementById('inputPelaksanaan').value = data.identitas.pelaksanaan || "";
    document.getElementById('indikator').value = data.identitas.indikator || "";
    document.getElementById('target').value = data.identitas.target || "";
  }

  const tbody = document.getElementById('bodyRincian');
  tbody.innerHTML = '';
  if (data && data.rincian && data.rincian.length > 0) {
    data.rincian.forEach(item => {
      const row = `<tr>
        <td><input type="text" class="cell-input komponen" value="${esc_(item.komponen)}" required></td>
        <td><input type="number" class="cell-input volume" style="width:70px" value="${item.volume || 0}" oninput="hitungTotal()" required></td>
        <td><input type="text" class="cell-input satuan" style="width:90px" value="${esc_(item.satuan)}" required></td>
        <td><input type="number" class="cell-input harga" style="width:110px" value="${item.harga || 0}" oninput="hitungTotal()" required></td>
        <td><input type="number" class="cell-input jumlah readonly" style="width:120px" readonly value="${item.jumlah || 0}"></td>
        <td><select class="cell-input snp">${[1,2,3,4,5,6,7,8].map(n => `<option value="${n}" ${item.snp == n ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td><select class="cell-input sumber"><option value="IKT" ${item.sumber == 'IKT' ? 'selected' : ''}>IKT</option><option value="BOS" ${item.sumber == 'BOS' ? 'selected' : ''}>BOS</option></select></td>
        <td class="center"><button type="button" class="btn-secondary btn-sm" onclick="hapusBaris(this)">✕</button></td>
      </tr>`;
      tbody.insertAdjacentHTML('beforeend', row);
    });
  } else { tambahBaris(); }

  hitungTotal();
}

function simpanData() {
  if (!isLoggedIn) { requireLoginAndDo('form'); return; }
  const btn = document.getElementById('btnSimpan');
  btn.disabled = true;
  btn.innerText = "Memproses...";

  const payload = {
    idKegiatan: currentEditId,
    identitas: {
      unit: document.getElementById('unit').value,
      program: document.getElementById('program').value,
      kegiatan: document.getElementById('kegiatan').value,
      pj: document.getElementById('pjInput').value,
      pelaksanaan: document.getElementById('inputPelaksanaan').value,
      indikator: document.getElementById('indikator').value,
      target: document.getElementById('target').value
    },
    rincian: []
  };
  document.querySelectorAll('#bodyRincian tr').forEach(row => {
    payload.rincian.push({
      komponen: row.querySelector('.komponen').value,
      volume: row.querySelector('.volume').value,
      satuan: row.querySelector('.satuan').value,
      harga: row.querySelector('.harga').value,
      jumlah: row.querySelector('.jumlah').value,
      snp: row.querySelector('.snp').value,
      sumber: row.querySelector('.sumber').value
    });
  });

  callAPI('simpanDataRAK', payload).then(response => {
    toast(response.pesan, "success");
    kegiatanCache.clear(); // invalidate cache
    batalForm();
    loadDataDashboard();
    loadDaftarKegiatan();
    gantiHalaman('daftar');
  }).catch(err => toast("Gagal menyimpan: " + err.message, "error")).finally(() => { btn.disabled = false; });
}

function hapusKegiatan(idKegiatan) {
  if (!isLoggedIn) { requireLoginAndDo('form'); return; }
  if (!confirm("⚠️ Apakah Anda yakin ingin menghapus kegiatan ini beserta seluruh rincian anggarannya? Tindakan ini permanen.")) return;
  callAPI('hapusDataKegiatan', { idKegiatan: idKegiatan }).then(response => {
    toast(response, "success");
    kegiatanCache.clear();
    loadDataDashboard();
    loadDaftarKegiatan();
  }).catch(err => toast("Terjadi kesalahan: " + err.message, "error"));
}

// =========================================================================
// PENGUNCIAN RAKS
// =========================================================================
function kunciKegiatanUI(idKegiatan) {
  if (!isLoggedIn) { requireLoginAndDo('form'); return; }
  if (!confirm("Kunci RAKS ini sebagai FINAL? Setelah dikunci, data TIDAK BISA diedit/dihapus kecuali dibuka kembali oleh admin.")) return;
  callAPI('kunciKegiatan', { idKegiatan: idKegiatan }).then(response => {
    toast(response, "success");
    kegiatanCache.clear();
    loadDaftarKegiatan();
  }).catch(err => toast("Gagal mengunci: " + err.message, "error"));
}

function bukaKunciKegiatanUI(idKegiatan) {
  if (!isLoggedIn) { requireLoginAndDo('form'); return; }
  callAPI('bukaKembaliKegiatan', { idKegiatan: idKegiatan }).then(response => {
    toast(response, "success");
    kegiatanCache.clear();
    loadDaftarKegiatan();
  }).catch(err => toast("Gagal membuka kunci: " + err.message, "error"));
}

// =========================================================================
// SUMBER DANA
// =========================================================================
function hitungDana() {
  let grandTotal = 0, grandRealisasi = 0;
  let sumTotalBOS = 0, sumRealisasiBOS = 0, sumTotalIKT = 0, sumRealisasiIKT = 0;

  document.querySelectorAll('#bodySumberDana .baris-dana').forEach(row => {
    const qty = parseFloat(row.querySelector('.qty').value) || 0;
    const harga = parseFloat(row.querySelector('.harga').value) || 0;
    const persen = parseFloat(row.querySelector('.persen').value) || 0;
    const total = qty * harga;
    row.querySelector('.total').value = total;
    const realisasi = Math.round(total * (persen / 100));
    row.querySelector('.realisasi').value = realisasi;
    grandTotal += total; grandRealisasi += realisasi;
    const kategori = row.getAttribute('data-kategori');
    if (kategori === 'BOS') { sumTotalBOS += total; sumRealisasiBOS += realisasi; }
    else if (kategori === 'IKT') { sumTotalIKT += total; sumRealisasiIKT += realisasi; }
  });

  document.getElementById('rekapTotalBOS').innerText = formatRupiah(sumTotalBOS);
  document.getElementById('rekapRealisasiBOS').innerText = formatRupiah(sumRealisasiBOS);
  document.getElementById('rekapTotalIKT').innerText = formatRupiah(sumTotalIKT);
  document.getElementById('rekapRealisasiIKT').innerText = formatRupiah(sumRealisasiIKT);
  document.getElementById('grandTotalDana').innerText = formatRupiah(grandTotal);
  document.getElementById('grandRealisasiDana').innerText = formatRupiah(grandRealisasi);
}

function loadSumberDana() {
  return callAPI('getSumberDana').then(data => {
    if (data && data.length > 0) {
      document.querySelectorAll('#bodySumberDana .baris-dana').forEach(row => {
        const uraianHtml = row.cells[1].innerText.trim();
        const match = data.find(d => d.uraian.trim() === uraianHtml);
        if (match) {
          row.querySelector('.qty').value = match.qty;
          row.querySelector('.harga').value = match.harga;
          row.querySelector('.persen').value = match.persen;
        }
      });
    }
    hitungDana();
  }).catch(err => console.error(err));
}

function simpanKonfigurasiDana() {
  if (!isLoggedIn) { requireLoginAndDo('simpanDana'); return; }
  const btn = document.getElementById('btnSimpanDana');
  btn.disabled = true;
  btn.innerText = "⏳ Memproses...";
  const payload = [];
  document.querySelectorAll('#bodySumberDana .baris-dana').forEach(row => {
    payload.push({
      uraian: row.cells[1].innerText.trim(),
      qty: parseFloat(row.querySelector('.qty').value) || 0,
      harga: parseFloat(row.querySelector('.harga').value) || 0,
      persen: parseFloat(row.querySelector('.persen').value) || 0,
      kategori: row.getAttribute('data-kategori')
    });
  });
  callAPI('simpanSumberDana', payload).then(response => {
    toast(response, "success");
    loadSumberDana();
  }).catch(err => toast("Gagal menyimpan: " + err.message, "error")).finally(() => {
    btn.disabled = false;
    btn.innerText = "💾 Simpan Perubahan Sumber Dana";
  });
}

// =========================================================================
// DETAIL MODAL
// =========================================================================
function lihatDetail(idKegiatan) {
  document.getElementById('detNama').innerText = "Memuat data...";
  document.getElementById('detRincianBody').innerHTML = '<tr><td colspan="7" class="center">Sedang menarik data...</td></tr>';
  openModal('modalDetail');

  // Cek cache
  const cached = kegiatanCache.get(idKegiatan);
  if (cached) {
    applyDetailData(cached);
    return;
  }

  callAPI('getKegiatanById', { idKegiatan: idKegiatan }).then(data => {
    kegiatanCache.set(idKegiatan, data);
    applyDetailData(data);
  }).catch(err => toast("Gagal memuat detail: " + err.message, "error"));
}

function applyDetailData(data) {
  document.getElementById('detId').textContent = data.identitas.id;
  document.getElementById('detNama').textContent = data.identitas.kegiatan;
  document.getElementById('detProgram').textContent = data.identitas.program;
  document.getElementById('detUnit').textContent = data.identitas.unit;
  document.getElementById('detPj').textContent = data.identitas.pj;
  document.getElementById('detWaktu').textContent = data.identitas.pelaksanaan;
  document.getElementById('detIndikator').textContent = data.identitas.indikator;
  document.getElementById('detTarget').textContent = data.identitas.target;
  document.getElementById('detStatus').innerHTML = data.identitas.status === 'FINAL'
    ? '<span class="badge badge-ungu">🔒 FINAL' + (data.identitas.tanggalDikunci ? ' — ' + esc_(data.identitas.tanggalDikunci) : '') + '</span>'
    : '<span class="badge">DRAFT</span>';

  let tbodyHTML = "", grandTotal = 0;
  if (data.rincian.length === 0) {
    tbodyHTML = '<tr><td colspan="7" class="center">Tidak ada rincian anggaran.</td></tr>';
  } else {
    data.rincian.forEach(item => {
      grandTotal += item.jumlah;
      tbodyHTML += `<tr><td>${esc_(item.komponen)}</td><td class="center">${esc_(item.volume)}</td><td class="center">${esc_(item.satuan)}</td>
        <td class="num">${formatRupiah(item.harga)}</td><td class="num" style="font-weight:700">${formatRupiah(item.jumlah)}</td>
        <td class="center">${esc_(item.snp)}</td><td class="center"><span class="badge ${item.sumber === 'BOS' ? 'badge-ungu' : 'badge-hijau'}">${esc_(item.sumber)}</span></td></tr>`;
    });
  }
  document.getElementById('detRincianBody').innerHTML = tbodyHTML;
  document.getElementById('detGrandTotal').innerText = formatRupiah(grandTotal);
}

// =========================================================================
// KALENDER
// =========================================================================
function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth', locale: 'id',
    headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
    buttonText: { today: 'Hari Ini' },
    eventClick: function (info) { lihatDetail(info.event.id); }
  });
  calendar.render();
}

function loadDataKalender() {
  return callAPI('getDataKalender').then(events => {
    semuaDataKalender = events;
    if (calendar) terapkanFilterKalender();
  }).catch(err => console.error(err));
}

function terapkanFilterKalender() {
  const elemenCentang = document.querySelectorAll('.filter-chk:checked');
  const unitTerpilih = Array.from(elemenCentang).map(chk => chk.value);
  const dataYangDitampilkan = semuaDataKalender.filter(k => unitTerpilih.includes(k.unit));
  calendar.removeAllEvents();
  calendar.addEventSource(dataYangDitampilkan);
}

function terapkanFilterDaftar() {
  const pilihan = document.getElementById('filterUnitDaftar').value.toUpperCase();
  const tabel = document.getElementById('tabelDaftarKegiatan');
  if (!tabel) return;
  // Setiap kegiatan terdiri dari 2 <tr> (data + aksi), jadi kita filter berpasangan
  const rows = Array.from(tabel.querySelectorAll('tbody > tr'));
  for (let i = 0; i < rows.length; i += 2) {
    const rowData = rows[i];
    const rowAksi = rows[i + 1];
    if (!rowData) continue;
    const teksBaris = rowData.textContent.toUpperCase();
    let tampil = true;
    if (pilihan !== "SEMUA") {
      if (pilihan === "SARANA PRASARANA") tampil = teksBaris.indexOf("SARANA PRASARANA") > -1 || teksBaris.indexOf("SARPRAS") > -1;
      else tampil = teksBaris.indexOf(pilihan) > -1;
    }
    rowData.style.display = tampil ? "" : "none";
    if (rowAksi) rowAksi.style.display = tampil ? "" : "none";
  }
}

// =========================================================================
// EXPORT EXCEL (lazy load XLSX library)
// =========================================================================
let xlsxLoaded = false;

async function loadXLSX() {
  if (xlsxLoaded) return;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => { xlsxLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Gagal memuat library Excel'));
    document.head.appendChild(script);
  });
}

async function downloadExcelDetail() {
  try {
    await loadXLSX();
  } catch (e) {
    toast(e.message, "error");
    return;
  }

  const unit = document.getElementById('detUnit').textContent;
  const program = document.getElementById('detProgram').textContent;
  const kegiatan = document.getElementById('detNama').textContent;
  const waktu = document.getElementById('detWaktu').textContent;
  const indikator = document.getElementById('detIndikator').textContent;
  const target = document.getElementById('detTarget').textContent;
  const pj = document.getElementById('detPj').textContent;
  const totalAnggaran = document.getElementById('detGrandTotal').textContent;

  let excelData = [];
  excelData.push(["RINCIAN ANGGARAN KEGIATAN SEKOLAH (RAKS)"]);
  excelData.push([]);
  excelData.push(["UNIT", ":", unit]); excelData.push(["PROGRAM", ":", program]);
  excelData.push(["KEGIATAN", ":", kegiatan]); excelData.push(["Waktu", ":", waktu]);
  excelData.push(["INDIKATOR KEBERHASILAN", ":", indikator]); excelData.push(["TARGET/JAMINAN MUTU", ":", target]);
  excelData.push(["PENANGGUNG JAWAB", ":", pj]); excelData.push(["TOTAL ANGGARAN", ":", totalAnggaran]);
  excelData.push([]);
  excelData.push(["Komponen", "Vol", "Satuan", "Harga (Rp)", "Total (Rp)", "SNP", "Sumber"]);

  document.querySelectorAll('#detRincianBody tr').forEach(row => {
    let rowData = [];
    row.querySelectorAll('td').forEach(cell => rowData.push(cell.textContent.trim()));
    if (rowData.length > 0) excelData.push(rowData);
  });

  const ws = XLSX.utils.aoa_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  ws['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 35 }, { wch: 20 }, { wch: 20 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, "Rincian Anggaran");
  let safeName = kegiatan.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  XLSX.writeFile(wb, "RAKS_" + unit + "_" + safeName + ".xlsx");
}

async function downloadExcelSemuaKegiatan() {
  try {
    await loadXLSX();
  } catch (e) {
    toast(e.message, "error");
    return;
  }

  const btn = document.getElementById('btnDownloadSemua');
  if (btn) { btn.innerHTML = "⏳ Menyiapkan Data..."; btn.disabled = true; }

  callAPI('getDataUntukExcelSemua').then(kegiatanMap => {
    if (!kegiatanMap) { toast("Data kosong.", "error"); resetTombolDownload(); return; }
    const wb = XLSX.utils.book_new();
    for (const id in kegiatanMap) {
      const keg = kegiatanMap[id];
      let excelData = [];
      const totalRupiah = "Rp " + keg.total.toLocaleString('id-ID');
      excelData.push(["RINCIAN ANGGARAN KEGIATAN SEKOLAH (RAKS)"]); excelData.push([]);
      excelData.push(["UNIT", ":", keg.identitas.unit]); excelData.push(["PROGRAM", ":", keg.identitas.program]);
      excelData.push(["KEGIATAN", ":", keg.identitas.nama]); excelData.push(["WAKTU", ":", keg.identitas.waktu]);
      excelData.push(["INDIKATOR KEBERHASILAN", ":", keg.identitas.indikator]); excelData.push(["TARGET/JAMINAN MUTU", ":", keg.identitas.target]);
      excelData.push(["PENANGGUNG JAWAB", ":", keg.identitas.pj]); excelData.push(["STATUS", ":", keg.identitas.status]);
      excelData.push(["TOTAL ANGGARAN", ":", totalRupiah]); excelData.push([]);
      excelData.push(["Komponen Belanja", "Volume", "Satuan", "Harga Satuan", "Total Jumlah", "SNP", "Sumber Dana"]);
      keg.rincian.forEach(baris => excelData.push(baris));

      const ws = XLSX.utils.aoa_to_sheet(excelData);
      ws['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 15 }];
      const namaSheetKotor = String(keg.identitas.nama).replace(/[^a-zA-Z0-9 ]/g, "").substring(0, 25);
      let namaSheet = namaSheetKotor, counter = 1;
      while (wb.SheetNames.includes(namaSheet)) { namaSheet = namaSheetKotor + "_" + counter; counter++; }
      XLSX.utils.book_append_sheet(wb, ws, namaSheet);
    }
    const tanggal = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, "Backup_Master_RAKS_" + tanggal + ".xlsx");
    resetTombolDownload();
  }).catch(err => { toast("Gagal memuat data: " + err.message, "error"); resetTombolDownload(); });
}

function resetTombolDownload() {
  const btn = document.getElementById('btnDownloadSemua');
  if (btn) { btn.innerHTML = "📚 Ekspor Semua ke Excel (Multi-Sheet)"; btn.disabled = false; }
}

// =========================================================================
// REALISASI ANGGARAN
// =========================================================================
function loadKegiatanFinalUntukRealisasi() {
  return callAPI('getDaftarKegiatan').then(data => {
    const select = document.getElementById('realKegiatanId');
    const finalOnly = (data || []).filter(k => k.status === 'FINAL');
    if (finalOnly.length === 0) {
      select.innerHTML = '<option value="">-- Belum ada RAKS berstatus FINAL --</option>';
      return;
    }
    select.innerHTML = finalOnly.map(k => `<option value="${esc_(k.id)}">${esc_(k.nama)} (${esc_(k.unit)})</option>`).join('');
    tampilkanSisaAnggaran();
  }).catch(err => console.error(err));
}

function tampilkanSisaAnggaran() {
  const id = document.getElementById('realKegiatanId').value;
  const info = document.getElementById('realSisaInfo');
  const ring = daftarRingkasanCache.find(r => r.identitas && r.identitas.id === id);
  if (ring) {
    info.innerHTML = `Dianggarkan: <strong>${formatRupiah(ring.totalAnggaran)}</strong> ·
      Sudah realisasi: <strong>${formatRupiah(ring.realisasiDisetujui)}</strong> ·
      Sisa: <strong style="color:#059669">${formatRupiah(ring.sisaAnggaran)}</strong>`;
  } else {
    info.innerText = '';
  }
}

function ajukanRealisasiUI() {
  if (!isLoggedIn) { requireLoginAndDo('ajukanRealisasi'); return; }
  const payload = {
    idKegiatan: document.getElementById('realKegiatanId').value,
    tanggalPenggunaan: document.getElementById('realTanggal').value,
    jumlah: document.getElementById('realJumlah').value,
    komponen: document.getElementById('realKomponen').value,
    diajukanOleh: document.getElementById('realDiajukanOleh').value,
    keterangan: document.getElementById('realKeterangan').value,
    bukti: document.getElementById('realBukti').value
  };
  if (!payload.idKegiatan) { toast("Pilih kegiatan terlebih dahulu.", "error"); return; }

  callAPI('ajukanRealisasi', payload).then(response => {
    toast(response, "success");
    ['realTanggal', 'realJumlah', 'realKomponen', 'realDiajukanOleh', 'realKeterangan', 'realBukti'].forEach(id => document.getElementById(id).value = '');
    loadRingkasanAnggaran();
    loadRiwayatRealisasi();
    loadAntreanPersetujuan();
    loadKegiatanFinalUntukRealisasi(); // refresh dropdown & sisa anggaran
  }).catch(err => toast("Gagal mengajukan: " + err.message, "error"));
}

function loadRingkasanAnggaran() {
  return callAPI('getRingkasanAnggaran').then(data => {
    daftarRingkasanCache = data || [];
    const tbody = document.getElementById('bodyRingkasanAnggaran');
    if (!data || data.length === 0) { tbody.innerHTML = '<tr class="table-loading-row"><td colspan="5">Belum ada data.</td></tr>'; return; }

    tbody.innerHTML = data.map(r => {
      if (!r.identitas) return '';
      const totalRealisasi = r.realisasiDisetujui + r.realisasiPending;
      const persenDisetujui = r.totalAnggaran > 0 ? Math.min(100, (r.realisasiDisetujui / r.totalAnggaran) * 100) : 0;
      const persenPending = r.totalAnggaran > 0 ? Math.min(100 - persenDisetujui, (r.realisasiPending / r.totalAnggaran) * 100) : 0;
      const persenSisa = Math.max(0, 100 - persenDisetujui - persenPending);
      return `<tr>
        <td>${esc_(r.identitas.nama)}<br><span style="font-size:11px;color:var(--text-secondary)">${esc_(r.identitas.unit)}</span></td>
        <td class="num">${formatRupiah(r.totalAnggaran)}</td>
        <td class="num" style="color:var(--green);font-weight:600">${formatRupiah(totalRealisasi)}</td>
        <td class="num" style="font-weight:700">${formatRupiah(r.sisaAnggaran)}</td>
        <td>
          <div class="status-bar">
            <div class="status-bar-segment seg-hijau" style="width:${persenDisetujui}%" title="Disetujui"></div>
            <div class="status-bar-segment seg-amber" style="width:${persenPending}%" title="Pending"></div>
            <div class="status-bar-segment seg-abu" style="width:${persenSisa}%" title="Sisa"></div>
          </div>
        </td>
      </tr>`;
    }).join('');
  }).catch(err => console.error(err));
}

function loadRiwayatRealisasi() {
  return callAPI('getAllRealisasi').then(data => {
    semuaDataRealisasiCache = data || [];
    renderRiwayatRealisasi(semuaDataRealisasiCache);
  }).catch(err => console.error(err));
}

function renderRiwayatRealisasi(data) {
  const tbody = document.getElementById('bodyRiwayatRealisasi');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr class="table-loading-row"><td colspan="6">Belum ada pengajuan.</td></tr>'; return; }

  tbody.innerHTML = data.map(r => {
    let badgeClass = 'badge';
    if (r.status === 'Disetujui') badgeClass = 'badge badge-hijau';
    else if (r.status === 'Diajukan') badgeClass = 'badge badge-amber';
    else if (r.status === 'Ditolak') badgeClass = 'badge badge-merah';

    // Cari nama kegiatan dari cache ringkasan
    const ring = daftarRingkasanCache.find(rr => rr.identitas && rr.identitas.id === r.idKegiatan);
    const namaKegiatan = ring ? ring.identitas.nama : r.idKegiatan;
    const unitKegiatan = ring ? ring.identitas.unit : '';

    const keterangan = r.status === 'Ditolak'
      ? `<span style="font-size:11px;color:var(--text-secondary)">Ditolak: ${esc_(r.alasan || '-')}</span>`
      : (r.keterangan ? esc_(r.keterangan) : '—');

    return `<tr>
      <td>${esc_(r.tanggalPenggunaan)}</td>
      <td>${esc_(namaKegiatan)}<br><span style="font-size:11px;color:var(--text-secondary)">${esc_(unitKegiatan)}</span></td>
      <td>${esc_(r.komponen)}</td>
      <td class="num">${formatRupiah(r.jumlah)}</td>
      <td class="center"><span class="${badgeClass}">${esc_(r.status)}</span></td>
      <td>${keterangan}</td>
    </tr>`;
  }).join('');
}

function terapkanFilterRiwayat() {
  const filter = document.getElementById('filterStatusRiwayat').value;
  if (!filter) {
    renderRiwayatRealisasi(semuaDataRealisasiCache);
  } else {
    renderRiwayatRealisasi(semuaDataRealisasiCache.filter(r => r.status === filter));
  }
}

function loadAntreanPersetujuan() {
  const tbody = document.getElementById('bodyAntreanRealisasi');
  if (!tbody) return Promise.resolve();

  // Hanya tampil untuk admin/kepsek
  if (!isLoggedIn || !currentUser || !['admin','kepsek'].includes(currentUser.role)) {
    document.getElementById('blokAntreanRealisasi').style.display = 'none';
    return Promise.resolve();
  }
  document.getElementById('blokAntreanRealisasi').style.display = '';

  return callAPI('getAllRealisasi').then(data => {
    const pending = (data || []).filter(r => r.status === 'Diajukan');
    if (pending.length === 0) {
      tbody.innerHTML = '<tr class="table-loading-row"><td colspan="6">✅ Tidak ada pengajuan yang menunggu persetujuan.</td></tr>';
      return;
    }
    tbody.innerHTML = pending.map(r => {
      const ring = daftarRingkasanCache.find(rr => rr.identitas && rr.identitas.id === r.idKegiatan);
      const namaKegiatan = ring ? ring.identitas.nama : r.idKegiatan;
      const unitKegiatan = ring ? ring.identitas.unit : '';
      return `<tr>
        <td>${esc_(namaKegiatan)}<br><span style="font-size:11px;color:var(--text-secondary)">${esc_(unitKegiatan)}</span></td>
        <td>${esc_(r.tanggalPenggunaan)}</td>
        <td>${esc_(r.komponen)}</td>
        <td class="num" style="font-weight:600">${formatRupiah(r.jumlah)}</td>
        <td>${esc_(r.diajukanOleh)}</td>
        <td class="center">
          <div class="row-actions" style="justify-content:center">
            <button onclick="setujuiRealisasiUI('${esc_(r.idRealisasi)}')" title="Setujui" style="color:#059669">✔️</button>
            <button onclick="tolakRealisasiUI('${esc_(r.idRealisasi)}')" title="Tolak" style="color:var(--red-dark)">✖️</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }).catch(err => console.error(err));
}

function setujuiRealisasiUI(idRealisasi) {
  if (!isLoggedIn) { toast("Silakan login terlebih dahulu.", "error"); bukaModalLogin(); return; }
  if (!['admin','kepsek'].includes(currentUser.role)) { toast("Hanya Kepsek/Admin yang bisa menyetujui realisasi.", "error"); return; }
  callAPI('setujuiRealisasi', { idRealisasi: idRealisasi }).then(response => {
    toast(response, "success");
    loadRingkasanAnggaran();
    loadRiwayatRealisasi();
    loadAntreanPersetujuan();
    loadKegiatanFinalUntukRealisasi(); // refresh sisa anggaran
  }).catch(err => toast("Gagal: " + err.message, "error"));
}

function tolakRealisasiUI(idRealisasi) {
  if (!isLoggedIn) { toast("Silakan login terlebih dahulu.", "error"); bukaModalLogin(); return; }
  if (!['admin','kepsek'].includes(currentUser.role)) { toast("Hanya Kepsek/Admin yang bisa menolak realisasi.", "error"); return; }
  const alasan = prompt("Alasan penolakan:") || "-";
  callAPI('tolakRealisasi', { idRealisasi: idRealisasi, alasan: alasan }).then(response => {
    toast(response, "success");
    loadRingkasanAnggaran();
    loadRiwayatRealisasi();
    loadAntreanPersetujuan();
    loadKegiatanFinalUntukRealisasi(); // refresh sisa anggaran
  }).catch(err => toast("Gagal: " + err.message, "error"));
}

// =========================================================================
// PANEL ADMIN — KUNCI MASSAL & KONTROL AKSES TAB
// =========================================================================
function kunciSemuaUI() {
  if (!isLoggedIn || !currentUser || currentUser.role !== 'admin') {
    toast("Silakan login sebagai Admin.", "error");
    bukaModalLogin();
    return;
  }
  if (!confirm("⚠️ Ini akan MENGUNCI SEMUA kegiatan RAKS yang masih berstatus DRAFT menjadi FINAL sekaligus. Lanjutkan?")) return;
  callAPI('kunciSemuaKegiatan').then(response => {
    toast(response, "success");
    kegiatanCache.clear();
    loadDaftarKegiatan();
  }).catch(err => toast("Gagal: " + err.message, "error"));
}

function bukaSemuaUI() {
  if (!isLoggedIn || !currentUser || currentUser.role !== 'admin') {
    toast("Silakan login sebagai Admin.", "error");
    bukaModalLogin();
    return;
  }
  if (!confirm("⚠️ Ini akan MEMBUKA KUNCI SEMUA kegiatan RAKS yang berstatus FINAL menjadi DRAFT kembali. Lanjutkan?")) return;
  callAPI('bukaSemuaKegiatan').then(response => {
    toast(response, "success");
    kegiatanCache.clear();
    loadDaftarKegiatan();
  }).catch(err => toast("Gagal: " + err.message, "error"));
}

async function loadPengaturanAkses() {
  try {
    pengaturanAksesCache = await callAPI('getPengaturanAkses');
  } catch (e) {
    pengaturanAksesCache = { form: true, daftar: true, rekap: true, sumberdana: true, kalender: true, realisasi: true };
  }
  terapkanPengaturanAksesUI();
  isiFormPengaturanAksesAdmin();
}

// Sembunyikan tab yang dinonaktifkan admin dari pengguna biasa.
// Admin yang sedang login TETAP melihat semua tab apapun pengaturannya.
function terapkanPengaturanAksesUI() {
  if (!pengaturanAksesCache) return;
  DAFTAR_TAB_KEY.forEach(key => {
    const btn = document.getElementById('tab-' + key);
    if (!btn) return;
    const boleh = isLoggedIn || pengaturanAksesCache[key] !== false;
    btn.classList.toggle('hidden', !boleh);
  });
  const tabAktif = document.querySelector('#navTabs .tab-btn.active');
  if (tabAktif && tabAktif.classList.contains('hidden')) {
    const tabTersedia = DAFTAR_TAB_KEY.find(key => {
      const el = document.getElementById('tab-' + key);
      return el && !el.classList.contains('hidden');
    });
    if (tabTersedia) gantiHalaman(tabTersedia);
  }
}

function isiFormPengaturanAksesAdmin() {
  if (!pengaturanAksesCache) return;
  DAFTAR_TAB_KEY.forEach(key => {
    const chk = document.getElementById('chkAkses-' + key);
    if (chk) chk.checked = pengaturanAksesCache[key] !== false;
  });
}

function simpanPengaturanAksesUI() {
  if (!isLoggedIn || !currentUser || currentUser.role !== 'admin') {
    toast("Silakan login sebagai Admin.", "error");
    bukaModalLogin();
    return;
  }
  const pengaturan = {};
  DAFTAR_TAB_KEY.forEach(key => { pengaturan[key] = document.getElementById('chkAkses-' + key).checked; });

  callAPI('simpanPengaturanAkses', { pengaturan: pengaturan }).then(hasil => {
    pengaturanAksesCache = hasil;
    toast("Pengaturan akses tab berhasil disimpan.", "success");
    terapkanPengaturanAksesUI();
  }).catch(err => toast("Gagal menyimpan: " + err.message, "error"));
}

// =========================================================================
// PANEL ADMIN — MANAJEMEN USER
// =========================================================================
function toggleUnitField() {
  const role = document.getElementById('newRole').value;
  document.getElementById('unitFieldWrapper').style.display = role === 'waka' ? '' : 'none';
}

function loadUsers() {
  if (!isLoggedIn || !currentUser || currentUser.role !== 'admin') return Promise.resolve();
  return callAPI('listUsers').then(data => {
    const tbody = document.getElementById('bodyTabelUsers');
    if (!data || data.length === 0) { tbody.innerHTML = '<tr class="table-loading-row"><td colspan="6">Belum ada data user.</td></tr>'; return; }
    tbody.innerHTML = data.map(u => {
      const statusBadge = u.status === 'aktif'
        ? '<span class="badge badge-hijau">Aktif</span>'
        : '<span class="badge badge-merah">Nonaktif</span>';
      const roleLabel = u.role === 'admin' ? '👑 Admin' : u.role === 'kepsek' ? '🏫 Kepsek' : '📋 Waka';
      return `<tr>
        <td class="mono">${esc_(u.username)}</td>
        <td>${esc_(u.nama)}</td>
        <td>${roleLabel}</td>
        <td>${esc_(u.unit || '-')}</td>
        <td class="center">${statusBadge}</td>
        <td class="center">
          <div class="row-actions" style="justify-content:center">
            <button onclick="editUserUI('${esc_(u.username)}', '${esc_(u.nama)}', '${esc_(u.role)}', '${esc_(u.unit || '')}', '${esc_(u.status)}')" title="Edit">✏️</button>
            <button onclick="resetPasswordUI('${esc_(u.username)}')" title="Reset Password">🔑</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }).catch(err => toast("Gagal memuat data user: " + err.message, "error"));
}

function createUserUI() {
  if (!isLoggedIn || currentUser.role !== 'admin') return;
  const payload = {
    username: document.getElementById('newUsername').value.trim(),
    password: document.getElementById('newPassword').value,
    nama: document.getElementById('newNama').value.trim(),
    role: document.getElementById('newRole').value,
    unit: document.getElementById('newUnit').value
  };
  if (!payload.username || !payload.password || !payload.nama) {
    toast("Username, password, dan nama wajib diisi.", "error"); return;
  }
  const btn = document.getElementById('btnCreateUser');
  btn.disabled = true;
  callAPI('createUser', payload).then(msg => {
    toast(msg, "success");
    document.getElementById('formUser').reset();
    document.getElementById('unitFieldWrapper').style.display = 'none';
    loadUsers();
  }).catch(err => toast("Gagal membuat user: " + err.message, "error")).finally(() => { btn.disabled = false; });
}

function editUserUI(username, nama, role, unit, status) {
  document.getElementById('editUsername').value = username;
  document.getElementById('editNama').value = nama;
  document.getElementById('editRole').value = role;
  document.getElementById('editUnit').value = unit;
  document.getElementById('editStatus').value = status;
  document.getElementById('editUnitWrapper').style.display = role === 'waka' ? '' : 'none';
  openModal('modalEditUser');
}

function toggleEditUnitField() {
  const role = document.getElementById('editRole').value;
  document.getElementById('editUnitWrapper').style.display = role === 'waka' ? '' : 'none';
}

function updateUserUI() {
  if (!isLoggedIn || currentUser.role !== 'admin') return;
  const payload = {
    username: document.getElementById('editUsername').value,
    nama: document.getElementById('editNama').value.trim(),
    role: document.getElementById('editRole').value,
    unit: document.getElementById('editUnit').value,
    status: document.getElementById('editStatus').value
  };
  const btn = document.getElementById('btnUpdateUser');
  btn.disabled = true;
  callAPI('updateUser', payload).then(msg => {
    toast(msg, "success");
    closeModal('modalEditUser');
    loadUsers();
  }).catch(err => toast("Gagal update user: " + err.message, "error")).finally(() => { btn.disabled = false; });
}

function resetPasswordUI(username) {
  const newPass = prompt("Masukkan password baru untuk '" + username + "' (minimal 6 karakter):");
  if (!newPass) return;
  if (newPass.length < 6) { toast("Password minimal 6 karakter.", "error"); return; }
  callAPI('updateUser', { username: username, newPassword: newPass }).then(msg => {
    toast("Password untuk '" + username + "' berhasil direset.", "success");
  }).catch(err => toast("Gagal reset password: " + err.message, "error"));
}

// =========================================================================
// UTILITY
// =========================================================================
function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka || 0);
}
