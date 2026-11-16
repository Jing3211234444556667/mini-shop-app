const SUPABASE_URL = 'https://ktkvgyicasrdzxmrafga.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZLo2mb2b_lCw9kN6za4sw_LY1XTdTr';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = JSON.parse(localStorage.getItem('shop_current_user') || 'null');
let currentShopId = 1;
let cart = []; // Holds FIFO batch lines: { batchId, productId, name, qty, buyPrice, sellPrice }
let html5QrCode = null;
let isScanning = false;

window.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    document.getElementById('login-overlay').classList.add('hidden');
    initializeRoleView();
  }
});

// Login Handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value.trim();

  const { data: user, error } = await _supabase
    .from('app_users')
    .select('*')
    .eq('username', u)
    .eq('password', p)
    .maybeSingle();

  if (error || !user) {
    alert('Invalid username or password.');
    return;
  }

  currentUser = user;
  localStorage.setItem('shop_current_user', JSON.stringify(user));
  document.getElementById('login-overlay').classList.add('hidden');
  initializeRoleView();
});

window.logout = function() {
  localStorage.removeItem('shop_current_user');
  location.reload();
};

function initializeRoleView() {
  const badge = document.getElementById('user-badge');
  const shopWrapper = document.getElementById('shop-switcher-wrapper');
  const shopSelector = document.getElementById('shop-selector');

  if (currentUser.role === 'admin') {
    document.getElementById('admin-view').classList.remove('hidden');
    document.getElementById('shopkeeper-view').classList.add('hidden');
    document.getElementById('app-title').textContent = 'Admin Manager Portal';
    badge.textContent = 'Admin';
    badge.className = 'text-xs px-2 py-0.5 rounded bg-emerald-600 font-medium text-white';
    shopWrapper.classList.remove('hidden');
    currentShopId = parseInt(shopSelector.value, 10);
    loadAdminInventory();
  } else {
    document.getElementById('shopkeeper-view').classList.remove('hidden');
    document.getElementById('admin-view').classList.add('hidden');
    const shopName = currentUser.shop_id === 1 ? 'Makumi Kihanya Traders' : 'God\'s Grace Shop';
    document.getElementById('app-title').textContent = shopName;
    badge.textContent = 'Shopkeeper';
    badge.className = 'text-xs px-2 py-0.5 rounded bg-blue-600 font-medium text-white';
    shopWrapper.classList.add('hidden');
    currentShopId = currentUser.shop_id;
  }
}

document.getElementById('shop-selector').addEventListener('change', (e) => {
  if (currentUser.role === 'admin') {
    currentShopId = parseInt(e.target.value, 10);
    if (!document.getElementById('admin-tab-stock').classList.contains('hidden')) loadAdminInventory();
    if (!document.getElementById('admin-tab-finance').classList.contains('hidden')) loadAdminFinances();
    if (!document.getElementById('admin-tab-reports').classList.contains('hidden')) loadAdminReports();
  }
});

// =========================================================
// ADMIN NAVIGATION & FIFO BATCH MANAGEMENT
// =========================================================
window.switchAdminTab = function(tabId) {
  ['admin-tab-stock', 'admin-tab-finance', 'admin-tab-reports'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById(tabId).classList.remove('hidden');

  if (tabId === 'admin-tab-stock') loadAdminInventory();
  if (tabId === 'admin-tab-finance') loadAdminFinances();
  if (tabId === 'admin-tab-reports') loadAdminReports();
};

// Admin Add Stock (Creates a new FIFO batch without overwriting old prices)
document.getElementById('admin-stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const barcode = document.getElementById('item-code').value.trim() || null;
  const buy_price = parseFloat(document.getElementById('item-buy').value);
  const sell_price = parseFloat(document.getElementById('item-sell').value);
  const qty = parseInt(document.getElementById('item-qty').value, 10);
  const sync_price = document.getElementById('sync-price-check').checked;

  // 1. Find or create global product entry
  let { data: product } = await _supabase
    .from('products')
    .select('*')
    .or(`name.ilike.${name}${barcode ? `,barcode.eq.${barcode}` : ''}`)
    .maybeSingle();

  let productId;
  if (product) {
    productId = product.id;
    if (sync_price) {
      await _supabase.from('products').update({
        global_buy_price: buy_price,
        global_sell_price: sell_price,
        sync_price: true,
        barcode: barcode || product.barcode
      }).eq('id', productId);
    }
  } else {
    const { data: newProd, error } = await _supabase.from('products').insert([{
      name, barcode, sync_price, global_buy_price: buy_price, global_sell_price: sell_price
    }]).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    productId = newProd.id;
  }

  // 2. Insert a brand new FIFO Stock Batch for this shop
  const { error: batchErr } = await _supabase.from('stock_batches').insert([{
    shop_id: currentShopId,
    product_id: productId,
    buy_price: buy_price,
    sell_price: sell_price,
    initial_qty: qty,
    remaining_qty: qty
  }]);

  if (batchErr) {
    alert('Error saving batch: ' + batchErr.message);
    return;
  }

  // 3. Log activity notification
  await _supabase.from('stock_logs').insert([{
    shop_id: currentShopId, product_name: name, qty_added: qty, timestamp: new Date().toISOString()
  }]);

  e.target.reset();
  loadAdminInventory();
  alert(`Added batch of ${qty} x ${name} @ ${sell_price} (Old batches remain at their original prices until sold out!)`);
});

// Admin Load Active FIFO Batches
async function loadAdminInventory() {
  const { data: batches } = await _supabase
    .from('stock_batches')
    .select('*, products(*)')
    .eq('shop_id', currentShopId)
    .gt('remaining_qty', 0)
    .order('created_at', { ascending: true });

  const list = document.getElementById('admin-inventory-list');
  if (!batches || batches.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No active stock batches in this shop.</p>';
    return;
  }

  list.innerHTML = batches.map((b, index) => {
    const dateAdded = new Date(b.created_at).toLocaleDateString();
    return `
      <div class="py-2.5 flex justify-between items-center">
        <div>
          <p class="font-medium">${b.products.name} <span class="text-xs bg-slate-200 px-1.5 py-0.5 rounded font-semibold">${b.remaining_qty} left</span></p>
          <p class="text-xs text-slate-500">Sell: <strong>${b.sell_price}</strong> | Buy: ${b.buy_price} • Added: ${dateAdded}</p>
        </div>
        <button onclick="removeBatchItem(${b.id})" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold px-2.5 py-1.5 rounded-lg">
          Remove
        </button>
      </div>
    `;
  }).join('');
}

window.removeBatchItem = async function(batchId) {
  if (!confirm('Remove this stock batch from this shop?')) return;
  await _supabase.from('stock_batches').delete().eq('id', batchId);
  loadAdminInventory();
};

// Admin Allocations & Expenses
document.getElementById('allocation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const purpose = document.getElementById('alloc-purpose').value.trim();
  const amount = parseFloat(document.getElementById('alloc-amount').value);
  await _supabase.from('allocations').insert([{
    shop_id: currentShopId, purpose, amount, timestamp: new Date().toISOString()
  }]);
  e.target.reset();
  loadAdminFinances();
  alert('Funds allocated to shop!');
});

document.getElementById('admin-expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('admin-exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('admin-exp-amount').value);
  await _supabase.from('expenses').insert([{
    shop_id: currentShopId, description, amount, timestamp: new Date().toISOString()
  }]);
  e.target.reset();
  loadAdminFinances();
  alert('Expense recorded!');
});

async function loadAdminFinances() {
  const { data: allocs } = await _supabase.from('allocations').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });
  const { data: exps } = await _supabase.from('expenses').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });

  document.getElementById('admin-allocations-list').innerHTML = (!allocs || allocs.length === 0)
    ? '<p class="text-slate-400">No funds allocated yet.</p>'
    : allocs.map(a => `<div class="py-1.5 flex justify-between"><span>${a.purpose} (${new Date(a.timestamp).toLocaleDateString()})</span><span class="font-bold text-emerald-700">+${a.amount.toFixed(2)}</span></div>`).join('');

  document.getElementById('admin-expenses-list').innerHTML = (!exps || exps.length === 0)
    ? '<p class="text-slate-400">No expenses logged.</p>'
    : exps.map(e => `<div class="py-1.5 flex justify-between"><span>${e.description} (${new Date(e.timestamp).toLocaleDateString()})</span><span class="font-bold text-red-600">-${e.amount.toFixed(2)}</span></div>`).join('');
}

// Admin Executive Reports
async function loadAdminReports() {
  const { data: sales } = await _supabase.from('sales').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });
  const { data: batches } = await _supabase.from('stock_batches').select('*, products(*)').eq('shop_id', currentShopId);
  const { data: logs } = await _supabase.from('stock_logs').select('*').eq('shop_id', currentShopId).order('id', { ascending: false }).limit(8);

  let cashTotal = 0, mpesaTotal = 0, totalRev = 0, totalProf = 0;
  const itemSalesCounts = {}, itemProfitCounts = {};

  if (sales) {
    sales.forEach(s => {
      totalRev += s.total_amount;
      totalProf += s.total_profit;
      if (s.payment_method === 'Cash') cashTotal += s.total_amount;
      if (s.payment_method === 'M-Pesa') mpesaTotal += s.total_amount;

      s.items.forEach(i => {
        itemSalesCounts[i.name] = (itemSalesCounts[i.name] || 0) + i.qty;
        itemProfitCounts[i.name] = (itemProfitCounts[i.name] || 0) + ((i.sellPrice - i.buyPrice) * i.qty);
      });
    });
  }

  document.getElementById('cash-revenue').textContent = cashTotal.toFixed(2);
  document.getElementById('mpesa-revenue').textContent = mpesaTotal.toFixed(2);
  document.getElementById('total-revenue').textContent = totalRev.toFixed(2);
  document.getElementById('total-profit').textContent = totalProf.toFixed(2);

  const soldEntries = Object.entries(itemSalesCounts).sort((a, b) => b[1] - a[1]);
  const profitEntries = Object.entries(itemProfitCounts).sort((a, b) => b[1] - a[1]);

  document.getElementById('stat-most-sold').textContent = soldEntries.length ? `${soldEntries[0][0]} (${soldEntries[0][1]})` : 'N/A';
  document.getElementById('stat-least-sold').textContent = soldEntries.length ? `${soldEntries[soldEntries.length - 1][0]} (${soldEntries[soldEntries.length - 1][1]})` : 'N/A';
  document.getElementById('stat-max-profit').textContent = profitEntries.length ? `${profitEntries[0][0]} (+${profitEntries[0][1].toFixed(2)})` : 'N/A';

  // Aggregate remaining stock per product
  const productTotals = {};
  if (batches) {
    batches.forEach(b => {
      const pName = b.products.name;
      productTotals[pName] = (productTotals[pName] || 0) + b.remaining_qty;
    });
  }
  let outCount = 0, inCount = 0;
  Object.values(productTotals).forEach(total => { total === 0 ? outCount++ : inCount++; });

  document.getElementById('stat-out-stock').textContent = `${outCount} items`;
  document.getElementById('stat-in-stock').textContent = `${inCount} items`;

  document.getElementById('stock-notifications-list').innerHTML = (!logs || logs.length === 0)
    ? '<p class="text-slate-400">No recent stock additions.</p>'
    : logs.map(l => `<div class="py-1.5 flex justify-between"><span>Added <strong>${l.product_name}</strong> (+${l.qty_added})</span><span class="text-slate-400">${new Date(l.timestamp).toLocaleString()}</span></div>`).join('');

  document.getElementById('sales-history').innerHTML = (!sales || sales.length === 0)
    ? '<p class="text-slate-400">No sales recorded yet.</p>'
    : sales.map(s => {
      const summary = s.items.map(i => `${i.name} (x${i.qty} @ ${i.sellPrice})`).join(', ');
      return `<div class="py-2 flex justify-between border-b border-slate-50"><div><p class="font-medium">${summary}</p><p class="text-slate-400">${new Date(s.timestamp).toLocaleString()} • ${s.payment_method}</p></div><div class="text-right"><p class="font-bold">${s.total_amount.toFixed(2)}</p><p class="text-emerald-600">+${s.total_profit.toFixed(2)}</p></div></div>`;
    }).join('');
}

// =========================================================
// SHOPKEEPER POS & FIFO SELLING LOGIC
// =========================================================
window.switchSkTab = function(tabId) {
  ['sell', 'sk-stock', 'sk-expenses', 'sk-reports'].forEach(id => {
    document.getElementById(`tab-${id}`).classList.add('hidden');
  });
  document.getElementById(`tab-${tabId}`).classList.remove('hidden');

  if (tabId === 'sk-stock') loadSkInventory();
  if (tabId === 'sk-expenses') loadSkExpenses();
  if (tabId === 'sk-reports') loadSkReports();
};

document.getElementById('search-input').addEventListener('input', async (e) => {
  const query = e.target.value.trim().toLowerCase();
  const resultsBox = document.getElementById('search-results');
  if (!query) { resultsBox.innerHTML = ''; return; }

  const { data: matches } = await _supabase.from('products').select('*').or(`name.ilike.%${query}%,barcode.ilike.%${query}%`);
  if (!matches || matches.length === 0) { resultsBox.innerHTML = '<p class="text-xs text-slate-400 p-2">No items found</p>'; return; }

  const productIds = matches.map(m => m.id);
  const { data: batches } = await _supabase
    .from('stock_batches')
    .select('*')
    .eq('shop_id', currentShopId)
    .in('product_id', productIds)
    .gt('remaining_qty', 0)
    .order('created_at', { ascending: true });

  resultsBox.innerHTML = matches.map(p => {
    const prodBatches = (batches || []).filter(b => b.product_id === p.id);
    const totalStock = prodBatches.reduce((sum, b) => sum + b.remaining_qty, 0);
    // Display the price of the oldest active FIFO batch
    const currentPrice = prodBatches.length > 0 ? prodBatches[0].sell_price : p.global_sell_price;

    return `<button onclick="addOneFromFIFO(${p.id})" class="w-full text-left py-2 px-1 hover:bg-slate-50 flex justify-between items-center">
      <span>${p.name} <small class="text-slate-400">(${totalStock} left)</small></span>
      <span class="font-semibold">${currentPrice.toFixed(2)}</span>
    </button>`;
  }).join('');
});

// Adds 1 unit from the oldest available FIFO batch that isn't already maxed out in cart
window.addOneFromFIFO = async function(productId) {
  const { data: product } = await _supabase.from('products').select('*').eq('id', productId).single();
  const { data: batches } = await _supabase
    .from('stock_batches')
    .select('*')
    .eq('shop_id', currentShopId)
    .eq('product_id', productId)
    .gt('remaining_qty', 0)
    .order('created_at', { ascending: true });

  if (!batches || batches.length === 0) {
    alert('Out of stock in this shop!');
    return;
  }

  // Find the oldest batch that still has unallocated units left
  let targetBatch = null;
  for (const b of batches) {
    const inCartForBatch = cart.find(c => c.batchId === b.id);
    const usedQty = inCartForBatch ? inCartForBatch.qty : 0;
    if (usedQty < b.remaining_qty) {
      targetBatch = b;
      break;
    }
  }

  if (!targetBatch) {
    alert('No more stock available across batches!');
    return;
  }

  const existingLine = cart.find(c => c.batchId === targetBatch.id);
  if (existingLine) {
    existingLine.qty += 1;
  } else {
    cart.push({
      batchId: targetBatch.id,
      productId: product.id,
      name: product.name,
      qty: 1,
      buyPrice: targetBatch.buy_price,
      sellPrice: targetBatch.sell_price
    });
  }

  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  renderCart();
};

window.removeFromCart = function(index) { cart.splice(index, 1); renderCart(); };

function renderCart() {
  const cartList = document.getElementById('cart-list');
  if (cart.length === 0) {
    cartList.innerHTML = '<p class="text-slate-400 py-2">No items added yet.</p>';
    document.getElementById('cart-total').textContent = '0.00';
    return;
  }
  let total = 0;
  cartList.innerHTML = cart.map((item, idx) => {
    total += item.sellPrice * item.qty;
    return `<div class="py-2 flex justify-between items-center">
      <div>
        <p class="font-medium">${item.name} x${item.qty}</p>
        <p class="text-xs text-slate-400">@ ${item.sellPrice.toFixed(2)} (Batch #${item.batchId})</p>
      </div>
      <div class="flex items-center gap-3">
        <span class="font-semibold">${(item.sellPrice * item.qty).toFixed(2)}</span>
        <button onclick="removeFromCart(${idx})" class="text-red-500 font-bold px-2">×</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('cart-total').textContent = total.toFixed(2);
}

document.getElementById('complete-sale-btn').addEventListener('click', async () => {
  if (cart.length === 0) return;
  const payment_method = document.querySelector('input[name="payment-method"]:checked').value;
  let totalAmount = 0, totalProfit = 0;

  for (const line of cart) {
    totalAmount += line.sellPrice * line.qty;
    totalProfit += (line.sellPrice - line.buyPrice) * line.qty;

    const { data: batch } = await _supabase
      .from('stock_batches')
      .select('remaining_qty')
      .eq('id', line.batchId)
      .single();

    await _supabase
      .from('stock_batches')
      .update({ remaining_qty: Math.max(0, batch.remaining_qty - line.qty) })
      .eq('id', line.batchId);
  }

  await _supabase.from('sales').insert([{
    shop_id: currentShopId, timestamp: new Date().toISOString(),
    total_amount: totalAmount, total_profit: totalProfit, payment_method,
    items: cart.map(c => ({ name: c.name, qty: c.qty, sellPrice: c.sellPrice, buyPrice: c.buyPrice }))
  }]);

  cart = [];
  renderCart();
  alert(`Sale completed via ${payment_method}!`);
});

async function loadSkInventory() {
  const { data: batches } = await _supabase
    .from('stock_batches')
    .select('*, products(*)')
    .eq('shop_id', currentShopId)
    .gt('remaining_qty', 0)
    .order('created_at', { ascending: true });

  const list = document.getElementById('sk-inventory-list');
  if (!batches || batches.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No items in stock.</p>';
    return;
  }

  list.innerHTML = batches.map(b => `
    <div class="py-2 flex justify-between items-center">
      <div>
        <p class="font-medium">${b.products.name}</p>
        <p class="text-xs text-slate-400">Batch Price: ${b.sell_price.toFixed(2)}</p>
      </div>
      <span class="font-bold">${b.remaining_qty} left</span>
    </div>
  `).join('');
}

document.getElementById('sk-expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('sk-exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('sk-exp-amount').value);
  await _supabase.from('expenses').insert([{ shop_id: currentShopId, timestamp: new Date().toISOString(), description, amount }]);
  e.target.reset();
  loadSkExpenses();
  alert('Expense recorded!');
});

async function loadSkExpenses() {
  const { data: exps } = await _supabase.from('expenses').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });
  document.getElementById('sk-expenses-list').innerHTML = (!exps || exps.length === 0)
    ? '<p class="text-slate-400 py-2">No expenses logged.</p>'
    : exps.map(e => `<div class="py-2 flex justify-between"><span>${e.description}</span><span class="font-bold text-red-600">-${e.amount.toFixed(2)}</span></div>`).join('');
}

async function loadSkReports() {
  const { data: sales } = await _supabase.from('sales').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });
  let cash = 0, mpesa = 0;
  if (sales) sales.forEach(s => { s.payment_method === 'Cash' ? cash += s.total_amount : mpesa += s.total_amount; });
  document.getElementById('sk-cash-rev').textContent = cash.toFixed(2);
  document.getElementById('sk-mpesa-rev').textContent = mpesa.toFixed(2);
  document.getElementById('sk-sales-history').innerHTML = (!sales || sales.length === 0)
    ? '<p class="text-slate-400 py-2">No sales yet.</p>'
    : sales.map(s => `<div class="py-2 flex justify-between"><span>${s.items.map(i => `${i.name} x${i.qty}`).join(', ')} (${s.payment_method})</span><span class="font-bold">${s.total_amount.toFixed(2)}</span></div>`).join('');
}

// Scanners & CSV Export
document.getElementById('toggle-scan-btn').addEventListener('click', () => {
  const readerDiv = document.getElementById('reader');
  if (isScanning) { html5QrCode.stop().then(() => { readerDiv.classList.add('hidden'); isScanning = false; }); return; }
  readerDiv.classList.remove('hidden');
  html5QrCode = new Html5Qrcode('reader');
  html5QrCode.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, async (decodedText) => {
    const { data: product } = await _supabase.from('products').select('*').eq('barcode', decodedText).single();
    if (product) {
      addOneFromFIFO(product.id);
      html5QrCode.stop().then(() => { readerDiv.classList.add('hidden'); isScanning = false; });
    } else { alert('Barcode not found.'); }
  }).then(() => { isScanning = true; });
});

document.getElementById('scan-stock-code-btn').addEventListener('click', () => {
  const stockReader = document.getElementById('stock-reader');
  stockReader.classList.remove('hidden');
  const scanner = new Html5Qrcode('stock-reader');
  scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 200 }, (decodedText) => {
    document.getElementById('item-code').value = decodedText;
    scanner.stop().then(() => stockReader.classList.add('hidden'));
  });
});

document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const { data: sales } = await _supabase.from('sales').select('*').eq('shop_id', currentShopId);
  let csv = 'Date,Payment Method,Items,Total Sale,Net Profit\n';
  sales.forEach(s => { csv += `"${s.timestamp}","${s.payment_method}","${s.items.map(i => `${i.name} x${i.qty}`).join(' | ')}",${s.total_amount},${s.total_profit}\n`; });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shop-${currentShopId}-report.csv`;
  a.click();
});