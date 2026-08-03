// =========================================================================
// KONFIGURASI API — WAJIB DIISI SEBELUM DIPAKAI
// =========================================================================
const API_URL = "https://script.google.com/macros/s/GANTI_DENGAN_DEPLOYMENT_ID/exec";
const API_KEY = "GANTI_DENGAN_API_KEY_ANDA"; // harus sama persis dengan Script Properties API_KEY

async function callAPI(action, payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari CORS preflight ke Apps Script
    body: JSON.stringify({ action: action, apiKey: API_KEY, payload: payload || {} })
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Terjadi kesalahan pada server');
  return json.data;
}

function mintaPinAdmin() {
  return prompt("Masukkan PIN Admin untuk melanjutkan aksi ini:");
}

function formatRupiah(angka) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka || 0);
}

// ==========================================
// TOAST NOTIFIKASI
// ==========================================
function toast(pesan, tipe) {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast' + (tipe === 'error' ? ' error' : tipe === 'success' ? ' success' : '');
  el.textContent = pesan;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ==========================================
// SIDEBAR MOBILE
// ==========================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('navBackdrop').classList.toggle('hidden');
}

// ==========================================
// NAVIGASI TAB
// ==========================================
function gantiHalaman(halaman) {
  ['form', 'rekap', 'daftar', 'sumberdana', 'kalender', 'realisasi'].forEach(id => {
    document.getElementById('halaman-' + id).classList.add('hidden');
    document.getElementById('tab-' + id).classList.remove('active');
  });
  document.getElementById('halaman-' + halaman).classList.remove('hidden');
  document.getElementById('tab-' + halaman).classList.add('active');

  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('navBackdrop').classList.add('hidden');

  if (halaman === 'realisasi') { loadRingkasanAnggaran(); loadRiwayatRealisasi(); loadKegiatanFinalUntukRealisasi(); }
}

// ==========================================
// MODAL
// ==========================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ==========================================
// INISIALISASI
// ==========================================
let fp;
let chartSNPInstance = null;
let chartUnitInstance = null;

window.onload = function () {
  initFlatpickr();
  initCalendar();
  loadDaftarGuru();
  loadDataDashboard();
  loadDaftarKegiatan();
  loadSumberDana();
  loadDataKalender();
  hitungDana();
  tambahBaris(true); // baris pertama form rincian
};

// ==========================================
// FORM INPUT RAK
// ==========================================
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
}

// ==========================================
// INTEGRASI BACKEND — REFERENSI
// ==========================================
function loadDaftarGuru() {
  callAPI('getDaftarGuru').then(data => {
    let options = '';
    data.forEach(nama => { options += `<option value="${nama}">`; });
    document.getElementById('listGuru').innerHTML = options;
  }).catch(err => console.error(err));
}

// ==========================================
// DASHBOARD
// ==========================================
function loadDataDashboard() {
  callAPI('getDataDashboard').then(data => {
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
                 datasets: [{ label: 'Anggaran (Rp)', data: data.snp, backgroundColor: '#E5232B', borderRadius: 4 }] },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }

    const canvasUnit = document.getElementById('grafikUnit');
    if (canvasUnit && data.unit) {
      if (chartUnitInstance) chartUnitInstance.destroy();
      chartUnitInstance = new Chart(canvasUnit.getContext('2d'), {
        type: 'bar',
        data: { labels: Object.keys(data.unit),
                 datasets: [{ label: 'Total Anggaran', data: Object.values(data.unit), backgroundColor: ['#1A1A1A', '#E5232B', '#F2A93B', '#5B3FBE', '#0F9D53'], borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }
  }).catch(err => toast("Gagal memuat dashboard: " + err.message, "error"));
}

// ==========================================
// DAFTAR KEGIATAN
// ==========================================
function loadDaftarKegiatan() {
  const tbody = document.getElementById('bodyDaftarKegiatan');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="table-loading-row"><td colspan="11">Memuat data dari server...</td></tr>';

  callAPI('getDaftarKegiatan').then(data => {
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr class="table-loading-row"><td colspan="11">Belum ada data anggaran yang diinput.</td></tr>';
      return;
    }
    let barisHTML = '';
    data.forEach((item, index) => {
      const isFinal = item.status === 'FINAL';
      const badgeStatus = isFinal ? '<span class="badge badge-ungu">🔒 FINAL</span>' : '<span class="badge">DRAFT</span>';
      const tombolEdit = isFinal
        ? `<button disabled data-tooltip="Terkunci">📝</button>`
        : `<button onclick="editKegiatan('${item.id}', this)" data-tooltip="Edit">📝</button>`;
      const tombolHapus = isFinal
        ? `<button disabled data-tooltip="Terkunci">🗑️</button>`
        : `<button onclick="hapusKegiatan('${item.id}')" data-tooltip="Hapus">🗑️</button>`;
      const tombolKunci = isFinal
        ? `<button onclick="bukaKunciKegiatanUI('${item.id}')" data-tooltip="Buka Kunci">🔓</button>`
        : `<button onclick="kunciKegiatanUI('${item.id}')" data-tooltip="Kunci RAKS">🔒</button>`;

      barisHTML += `
        <tr>
          <td class="center">${index + 1}</td>
          <td class="mono">${item.waktu}</td>
          <td>${item.program}</td>
          <td>${item.nama}</td>
          <td class="num">${formatRupiah(item.danaBOS)}</td>
          <td class="num">${formatRupiah(item.danaIKT)}</td>
          <td class="num" style="font-weight:700;color:#0F9D53">${formatRupiah(item.total)}</td>
          <td>${item.pj}</td>
          <td class="center">${item.snp}</td>
          <td>${item.unit}</td>
          <td class="center">${badgeStatus}</td>
        </tr>
        <tr>
          <td colspan="11" style="padding:0;border-bottom:2px solid var(--border);">
            <div class="row-actions" style="justify-content:flex-end;padding:2px 12px 8px;">
              <button onclick="lihatDetail('${item.id}')" data-tooltip="Detail">🔍</button>
              ${tombolEdit} ${tombolHapus} ${tombolKunci}
            </div>
          </td>
        </tr>`;
    });
    tbody.innerHTML = barisHTML;
  }).catch(err => { tbody.innerHTML = `<tr class="table-loading-row"><td colspan="11" style="color:var(--red-dark)">Gagal memuat: ${err.message}</td></tr>`; });
}
// NOTE: struktur 2-baris (data + aksi) dipakai supaya kolom Aksi tetap ringkas di layar kecil.
// Jika ingin 1 baris per data, pindahkan div.row-actions ke <td> terakhir baris pertama dan hapus baris kedua.

// ==========================================
// SIMPAN / EDIT / HAPUS
// ==========================================
let currentEditId = null;

function editKegiatan(idKegiatan, btnElement) {
  const btnEdit = btnElement;
  let originalText = "📝";
  if (btnEdit) { originalText = btnEdit.innerText; btnEdit.innerText = "⏳"; btnEdit.disabled = true; }

  callAPI('getKegiatanById', { idKegiatan: idKegiatan }).then(data => {
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
          <td><input type="text" class="cell-input komponen" value="${item.komponen || ''}" required></td>
          <td><input type="number" class="cell-input volume" style="width:70px" value="${item.volume || 0}" oninput="hitungTotal()" required></td>
          <td><input type="text" class="cell-input satuan" style="width:90px" value="${item.satuan || ''}" required></td>
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
    if (btnEdit) { btnEdit.innerText = originalText; btnEdit.disabled = false; }
  }).catch(err => { toast("Gagal memuat data: " + err.message, "error"); if (btnEdit) { btnEdit.innerText = originalText; btnEdit.disabled = false; } });
}

function simpanData() {
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
    batalForm();
    loadDataDashboard();
    loadDaftarKegiatan();
    gantiHalaman('daftar');
  }).catch(err => toast("Gagal menyimpan: " + err.message, "error")).finally(() => { btn.disabled = false; });
}

function hapusKegiatan(idKegiatan) {
  if (!confirm("⚠️ Apakah Anda yakin ingin menghapus kegiatan ini beserta seluruh rincian anggarannya? Tindakan ini permanen.")) return;
  callAPI('hapusDataKegiatan', { idKegiatan: idKegiatan }).then(response => {
    toast(response, "success");
    loadDataDashboard();
    loadDaftarKegiatan();
  }).catch(err => toast("Terjadi kesalahan: " + err.message, "error"));
}

// ==========================================
// PENGUNCIAN RAKS
// ==========================================
function kunciKegiatanUI(idKegiatan) {
  if (!confirm("Kunci RAKS ini sebagai FINAL? Setelah dikunci, data TIDAK BISA diedit/dihapus kecuali dibuka kembali oleh admin.")) return;
  const pin = mintaPinAdmin();
  if (pin === null) return;
  callAPI('kunciKegiatan', { idKegiatan: idKegiatan, adminPin: pin }).then(response => {
    toast(response, "success");
    loadDaftarKegiatan();
  }).catch(err => toast("Gagal mengunci: " + err.message, "error"));
}

function bukaKunciKegiatanUI(idKegiatan) {
  const pin = mintaPinAdmin();
  if (pin === null) return;
  callAPI('bukaKembaliKegiatan', { idKegiatan: idKegiatan, adminPin: pin }).then(response => {
    toast(response, "success");
    loadDaftarKegiatan();
  }).catch(err => toast("Gagal membuka kunci: " + err.message, "error"));
}

// ==========================================
// SUMBER DANA
// ==========================================
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
  callAPI('getSumberDana').then(data => {
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

// ==========================================
// DETAIL MODAL
// ==========================================
function lihatDetail(idKegiatan) {
  document.getElementById('detNama').innerText = "Memuat data...";
  document.getElementById('detRincianBody').innerHTML = '<tr><td colspan="7" class="center">Sedang menarik data...</td></tr>';
  openModal('modalDetail');

  callAPI('getKegiatanById', { idKegiatan: idKegiatan }).then(data => {
    document.getElementById('detId').innerText = data.identitas.id;
    document.getElementById('detNama').innerText = data.identitas.kegiatan;
    document.getElementById('detProgram').innerText = data.identitas.program;
    document.getElementById('detUnit').innerText = data.identitas.unit;
    document.getElementById('detPj').innerText = data.identitas.pj;
    document.getElementById('detWaktu').innerText = data.identitas.pelaksanaan;
    document.getElementById('detIndikator').innerText = data.identitas.indikator;
    document.getElementById('detTarget').innerText = data.identitas.target;
    document.getElementById('detStatus').innerHTML = data.identitas.status === 'FINAL'
      ? '<span class="badge badge-ungu">🔒 FINAL' + (data.identitas.tanggalDikunci ? ' — ' + data.identitas.tanggalDikunci : '') + '</span>'
      : '<span class="badge">DRAFT</span>';

    let tbodyHTML = "", grandTotal = 0;
    if (data.rincian.length === 0) {
      tbodyHTML = '<tr><td colspan="7" class="center">Tidak ada rincian anggaran.</td></tr>';
    } else {
      data.rincian.forEach(item => {
        grandTotal += item.jumlah;
        tbodyHTML += `<tr><td>${item.komponen}</td><td class="center">${item.volume}</td><td class="center">${item.satuan}</td>
          <td class="num">${formatRupiah(item.harga)}</td><td class="num" style="font-weight:700">${formatRupiah(item.jumlah)}</td>
          <td class="center">${item.snp}</td><td class="center"><span class="badge ${item.sumber === 'BOS' ? 'badge-ungu' : 'badge-hijau'}">${item.sumber}</span></td></tr>`;
      });
    }
    document.getElementById('detRincianBody').innerHTML = tbodyHTML;
    document.getElementById('detGrandTotal').innerText = formatRupiah(grandTotal);
  }).catch(err => toast("Gagal memuat detail: " + err.message, "error"));
}

// ==========================================
// KALENDER
// ==========================================
let calendar;
let semuaDataKalender = [];

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
  callAPI('getDataKalender').then(events => {
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

// ==========================================
// EXPORT EXCEL
// ==========================================
function downloadExcelDetail() {
  const unit = document.getElementById('detUnit').innerText;
  const program = document.getElementById('detProgram').innerText;
  const kegiatan = document.getElementById('detNama').innerText;
  const waktu = document.getElementById('detWaktu').innerText;
  const indikator = document.getElementById('detIndikator').innerText;
  const target = document.getElementById('detTarget').innerText;
  const pj = document.getElementById('detPj').innerText;
  const totalAnggaran = document.getElementById('detGrandTotal').innerText;

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
    row.querySelectorAll('td').forEach(cell => rowData.push(cell.innerText.trim()));
    if (rowData.length > 0) excelData.push(rowData);
  });

  const ws = XLSX.utils.aoa_to_sheet(excelData);
  const wb = XLSX.utils.book_new();
  ws['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 35 }, { wch: 20 }, { wch: 20 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, "Rincian Anggaran");
  let safeName = kegiatan.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  XLSX.writeFile(wb, "RAKS_" + unit + "_" + safeName + ".xlsx");
}

function downloadExcelSemuaKegiatan() {
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

// ==========================================
// REALISASI ANGGARAN
// ==========================================
let daftarRingkasanCache = [];

function loadKegiatanFinalUntukRealisasi() {
  callAPI('getDaftarKegiatan').then(data => {
    const select = document.getElementById('realKegiatanId');
    const finalOnly = (data || []).filter(k => k.status === 'FINAL');
    if (finalOnly.length === 0) {
      select.innerHTML = '<option value="">-- Belum ada RAKS berstatus FINAL --</option>';
      return;
    }
    select.innerHTML = finalOnly.map(k => `<option value="${k.id}">${k.nama} (${k.unit})</option>`).join('');
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
      Sisa: <strong style="color:#0F9D53">${formatRupiah(ring.sisaAnggaran)}</strong>`;
  } else {
    info.innerText = '';
  }
}

function ajukanRealisasiUI() {
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
  }).catch(err => toast("Gagal mengajukan: " + err.message, "error"));
}

function loadRingkasanAnggaran() {
  callAPI('getRingkasanAnggaran').then(data => {
    daftarRingkasanCache = data || [];
    const tbody = document.getElementById('bodyRingkasanAnggaran');
    if (!data || data.length === 0) { tbody.innerHTML = '<tr class="table-loading-row"><td colspan="6">Belum ada data.</td></tr>'; return; }

    tbody.innerHTML = data.map(r => {
      if (!r.identitas) return '';
      const persenDisetujui = r.totalAnggaran > 0 ? Math.min(100, (r.realisasiDisetujui / r.totalAnggaran) * 100) : 0;
      const persenPending = r.totalAnggaran > 0 ? Math.min(100 - persenDisetujui, (r.realisasiPending / r.totalAnggaran) * 100) : 0;
      return `<tr>
        <td>${r.identitas.nama}<br><span style="font-size:11px;color:var(--gray)">${r.identitas.unit}</span></td>
        <td class="num">${formatRupiah(r.totalAnggaran)}</td>
        <td class="num" style="color:#0F9D53">${formatRupiah(r.realisasiDisetujui)}</td>
        <td class="num" style="color:#B9770E">${formatRupiah(r.realisasiPending)}</td>
        <td class="num" style="font-weight:700">${formatRupiah(r.sisaAnggaran)}</td>
        <td style="min-width:140px">
          <div class="status-bar">
            <div class="status-bar-segment seg-hijau" style="width:${persenDisetujui}%"></div>
            <div class="status-bar-segment seg-amber" style="width:${persenPending}%"></div>
          </div>
        </td>
      </tr>`;
    }).join('');
  }).catch(err => console.error(err));
}

function loadRiwayatRealisasi() {
  callAPI('getAllRealisasi').then(data => {
    const tbody = document.getElementById('bodyRiwayatRealisasi');
    if (!data || data.length === 0) { tbody.innerHTML = '<tr class="table-loading-row"><td colspan="8">Belum ada pengajuan.</td></tr>'; return; }

    tbody.innerHTML = data.map(r => {
      let badgeClass = 'badge';
      if (r.status === 'Disetujui') badgeClass = 'badge badge-hijau';
      else if (r.status === 'Diajukan') badgeClass = 'badge badge-amber';
      else if (r.status === 'Ditolak') badgeClass = 'badge badge-merah';

      const aksi = r.status === 'Diajukan'
        ? `<div class="row-actions" style="justify-content:center">
             <button onclick="setujuiRealisasiUI('${r.idRealisasi}')" data-tooltip="Setujui" style="color:#0F9D53">✔️</button>
             <button onclick="tolakRealisasiUI('${r.idRealisasi}')" data-tooltip="Tolak" style="color:var(--red-dark)">✖️</button>
           </div>`
        : (r.status === 'Ditolak' ? `<span style="font-size:11px;color:var(--gray)">Alasan: ${r.alasan || '-'}</span>` : '—');

      return `<tr>
        <td class="mono">${r.idRealisasi}</td><td class="mono">${r.idKegiatan}</td><td>${r.tanggalPenggunaan}</td><td>${r.komponen}</td>
        <td class="num">${formatRupiah(r.jumlah)}</td><td>${r.diajukanOleh}</td>
        <td class="center"><span class="${badgeClass}">${r.status}</span></td>
        <td class="center">${aksi}</td>
      </tr>`;
    }).join('');
  }).catch(err => console.error(err));
}

function setujuiRealisasiUI(idRealisasi) {
  const pin = mintaPinAdmin();
  if (pin === null) return;
  callAPI('setujuiRealisasi', { idRealisasi: idRealisasi, adminPin: pin }).then(response => {
    toast(response, "success");
    loadRingkasanAnggaran();
    loadRiwayatRealisasi();
  }).catch(err => toast("Gagal: " + err.message, "error"));
}

function tolakRealisasiUI(idRealisasi) {
  const pin = mintaPinAdmin();
  if (pin === null) return;
  const alasan = prompt("Alasan penolakan:") || "-";
  callAPI('tolakRealisasi', { idRealisasi: idRealisasi, adminPin: pin, alasan: alasan }).then(response => {
    toast(response, "success");
    loadRingkasanAnggaran();
    loadRiwayatRealisasi();
  }).catch(err => toast("Gagal: " + err.message, "error"));
}
