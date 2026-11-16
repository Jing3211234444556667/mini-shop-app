const SUPABASE_URL = 'https://ktkvgyicasrdzxmrafga.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZLo2mb2b_lCw9kN6za4sw_LY1XTdTr';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = JSON.parse(localStorage.getItem('shop_current_user') || 'null');
let currentShopId = 1;
let cart = [];
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
    // Show Admin Portal Only (Hide POS)
    document.getElementById('admin-view').classList.remove('hidden');
    document.getElementById('shopkeeper-view').classList.add('hidden');
    document.getElementById('app-title').textContent = 'Admin Manager Portal';
    badge.textContent = 'Admin';
    badge.className = 'text-xs px-2 py-0.5 rounded bg-emerald-600 font-medium text-white';
    shopWrapper.classList.remove('hidden');
    currentShopId = parseInt(shopSelector.value, 10);
    loadAdminInventory();
  } else {
    // Show Shopkeeper POS View Only
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

// Admin Shop Switcher Event
document.getElementById('shop-selector').addEventListener('change', (e) => {
  if (currentUser.role === 'admin') {
    currentShopId = parseInt(e.target.value, 10);
    // Refresh whichever Admin tab is currently open
    if (!document.getElementById('admin-tab-stock').classList.contains('hidden')) loadAdminInventory();
    if (!document.getElementById('admin-tab-finance').classList.contains('hidden')) loadAdminFinances();
    if (!document.getElementById('admin-tab-reports').classList.contains('hidden')) loadAdminReports();
  }
});

// =========================================================
// ADMIN NAVIGATION & FUNCTIONS
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

// Admin Add / Update Stock
document.getElementById('admin-stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const barcode = document.getElementById('item-code').value.trim() || null;
  const buy_price = parseFloat(document.getElementById('item-buy').value);
  const sell_price = parseFloat(document.getElementById('item-sell').value);
  const qty = parseInt(document.getElementById('item-qty').value, 10);
  const sync_price = document.getElementById('sync-price-check').checked;

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
    } else {
      await _supabase.from('products').update({ sync_price: false }).eq('id', productId);
    }
  } else {
    const { data: newProd, error } = await _supabase.from('products').insert([{
      name, barcode, sync_price, global_buy_price: buy_price, global_sell_price: sell_price
    }]).select().single();
    if (error) { alert('Error: ' + error.message); return; }
    productId = newProd.id;
  }

  const { data: shopInv } = await _supabase
    .from('shop_inventory')
    .select('*')
    .eq('shop_id', currentShopId)
    .eq('product_id', productId)
    .maybeSingle();

  if (shopInv) {
    await _supabase.from('shop_inventory').update({
      stock: shopInv.stock + qty,
      local_buy_price: sync_price ? null : buy_price,
      local_sell_price: sync_price ? null : sell_price
    }).eq('id', shopInv.id);
  } else {
    await _supabase.from('shop_inventory').insert([{
      shop_id: currentShopId, product_id: productId, stock: qty,
      local_buy_price: sync_price ? null : buy_price, local_sell_price: sync_price ? null : sell_price
    }]);
  }

  await _supabase.from('stock_logs').insert([{
    shop_id: currentShopId, product_name: name, qty_added: qty, timestamp: new Date().toISOString()
  }]);

  e.target.reset();
  loadAdminInventory();
  alert('Stock updated successfully!');
});

// Admin Load & Remove Stock Items
async function loadAdminInventory() {
  const { data: inventory } = await _supabase
    .from('shop_inventory')
    .select('*, products(*)')
    .eq('shop_id', currentShopId);

  const list = document.getElementById('admin-inventory-list');
  if (!inventory || inventory.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No items in stock for this shop.</p>';
    return;
  }

  list.innerHTML = inventory.map(inv => {
    const p = inv.products;
    const sell = p.sync_price ? p.global_sell_price : (inv.local_sell_price ?? p.global_sell_price);
    const buy = p.sync_price ? p.global_buy_price : (inv.local_buy_price ?? p.global_buy_price);
    return `
      <div class="py-2.5 flex justify-between items-center">
        <div>
          <p class="font-medium">${p.name} <span class="text-xs text-slate-400">(${inv.stock} left)</span></p>
          <p class="text-xs text-slate-500">Buy: ${buy} | Sell: ${sell} ${p.sync_price ? '• Synced' : '• Local Price'}</p>
        </div>
        <button onclick="removeStockItem(${inv.id})" class="bg-red-100 text-red-700 hover:bg-red-200 text-xs font-bold px-2.5 py-1.5 rounded-lg">
          Remove
        </button>
      </div>
    `;
  }).join('');
}

window.removeStockItem = async function(inventoryId) {
  if (!confirm('Remove this item from this shop\'s inventory?')) return;
  await _supabase.from('shop_inventory').delete().eq('id', inventoryId);
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
  const { data: inventory } = await _supabase.from('shop_inventory').select('*, products(*)').eq('shop_id', currentShopId);
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

  let outCount = 0, inCount = 0;
  if (inventory) inventory.forEach(inv => { inv.stock === 0 ? outCount++ : inCount++; });
  document.getElementById('stat-out-stock').textContent = `${outCount} items`;
  document.getElementById('stat-in-stock').textContent = `${inCount} items`;

  document.getElementById('stock-notifications-list').innerHTML = (!logs || logs.length === 0)
    ? '<p class="text-slate-400">No recent stock additions.</p>'
    : logs.map(l => `<div class="py-1.5 flex justify-between"><span>Added <strong>${l.product_name}</strong> (+${l.qty_added})</span><span class="text-slate-400">${new Date(l.timestamp).toLocaleString()}</span></div>`).join('');

  document.getElementById('sales-history').innerHTML = (!sales || sales.length === 0)
    ? '<p class="text-slate-400">No sales recorded yet.</p>'
    : sales.map(s => {
      const summary = s.items.map(i => `${i.name} (x${i.qty})`).join(', ');
      return `<div class="py-2 flex justify-between border-b border-slate-50"><div><p class="font-medium">${summary}</p><p class="text-slate-400">${new Date(s.timestamp).toLocaleString()} • ${s.payment_method}</p></div><div class="text-right"><p class="font-bold">${s.total_amount.toFixed(2)}</p><p class="text-emerald-600">+${s.total_profit.toFixed(2)}</p></div></div>`;
    }).join('');
}

// =========================================================
// SHOPKEEPER POS & FUNCTIONS
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
  const { data: inventories } = await _supabase.from('shop_inventory').select('*').eq('shop_id', currentShopId).in('product_id', productIds);
  const invMap = {};
  if (inventories) inventories.forEach(inv => { invMap[inv.product_id] = inv; });

  resultsBox.innerHTML = matches.map(p => {
    const inv = invMap[p.id] || { stock: 0 };
    const sell = p.sync_price ? p.global_sell_price : (inv.local_sell_price ?? p.global_sell_price);
    return `<button onclick="addItemToCart(${p.id}, ${inv.stock})" class="w-full text-left py-2 px-1 hover:bg-slate-50 flex justify-between items-center"><span>${p.name} <small class="text-slate-400">(${inv.stock} left)</small></span><span class="font-semibold">${sell.toFixed(2)}</span></button>`;
  }).join('');
});

window.addItemToCart = async function(productId, currentStock) {
  if (currentStock <= 0) { alert('Out of stock!'); return; }
  const { data: product } = await _supabase.from('products').select('*').eq('id', productId).single();
  const { data: shopInv } = await _supabase.from('shop_inventory').select('*').eq('shop_id', currentShopId).eq('product_id', productId).single();

  const sellPrice = product.sync_price ? product.global_sell_price : (shopInv.local_sell_price ?? product.global_sell_price);
  const buyPrice = product.sync_price ? product.global_buy_price : (shopInv.local_buy_price ?? product.global_buy_price);

  const existing = cart.find(c => c.productId === productId);
  if (existing) {
    if (existing.qty + 1 > currentStock) { alert('Not enough stock.'); return; }
    existing.qty += 1;
  } else {
    cart.push({ productId, name: product.name, sellPrice, buyPrice, stock: currentStock, qty: 1 });
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
    return `<div class="py-2 flex justify-between items-center"><div><p class="font-medium">${item.name} x${item.qty}</p></div><div class="flex items-center gap-3"><span class="font-semibold">${(item.sellPrice * item.qty).toFixed(2)}</span><button onclick="removeFromCart(${idx})" class="text-red-500 font-bold px-2">×</button></div></div>`;
  }).join('');
  document.getElementById('cart-total').textContent = total.toFixed(2);
}

document.getElementById('complete-sale-btn').addEventListener('click', async () => {
  if (cart.length === 0) return;
  const payment_method = document.querySelector('input[name="payment-method"]:checked').value;
  let totalAmount = 0, totalProfit = 0;

  for (const item of cart) {
    totalAmount += item.sellPrice * item.qty;
    totalProfit += (item.sellPrice - item.buyPrice) * item.qty;
    const { data: shopInv } = await _supabase.from('shop_inventory').select('*').eq('shop_id', currentShopId).eq('product_id', item.productId).single();
    await _supabase.from('shop_inventory').update({ stock: shopInv.stock - item.qty }).eq('id', shopInv.id);
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
  const { data: inventory } = await _supabase.from('shop_inventory').select('*, products(*)').eq('shop_id', currentShopId);
  const list = document.getElementById('sk-inventory-list');
  list.innerHTML = (!inventory || inventory.length === 0)
    ? '<p class="text-slate-400 py-2">No items in stock.</p>'
    : inventory.map(inv => `<div class="py-2 flex justify-between"><span>${inv.products.name}</span><span class="font-bold ${inv.stock === 0 ? 'text-red-600' : ''}">${inv.stock} left</span></div>`).join('');
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
      const { data: shopInv } = await _supabase.from('shop_inventory').select('*').eq('shop_id', currentShopId).eq('product_id', product.id).maybeSingle();
      addItemToCart(product.id, shopInv ? shopInv.stock : 0);
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