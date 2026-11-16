const SUPABASE_URL = 'https://ktkvgyicasrdzxmrafga.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZLo2mb2b_lCw9kN6za4sw_LY1XTdTr';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = JSON.parse(localStorage.getItem('shop_current_user') || 'null');
let currentShopId = 1;

// Initialize Session on Load
window.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    document.getElementById('login-overlay').classList.add('hidden');
    applyUserPermissions();
  }
});

// Login Form Handler
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
  applyUserPermissions();
});

window.logout = function() {
  localStorage.removeItem('shop_current_user');
  location.reload();
};

function applyUserPermissions() {
  const badge = document.getElementById('user-badge');
  const shopSelector = document.getElementById('shop-selector');
  const shopWrapper = document.getElementById('shop-switcher-wrapper');
  const syncContainer = document.getElementById('price-sync-container');

  if (currentUser.role === 'admin') {
    badge.textContent = 'Admin (All Access)';
    badge.className = 'text-xs px-2 py-0.5 rounded bg-emerald-600 font-medium text-white';
    shopSelector.disabled = false;
    shopWrapper.style.display = 'flex';
    syncContainer.style.display = 'flex';
    currentShopId = parseInt(shopSelector.value, 10);
  } else {
    badge.textContent = `Shopkeeper (${currentUser.shop_id === 1 ? 'Makumi' : 'God\'s Grace'})`;
    badge.className = 'text-xs px-2 py-0.5 rounded bg-blue-600 font-medium text-white';
    currentShopId = currentUser.shop_id;
    shopSelector.value = currentShopId;
    shopWrapper.style.display = 'none'; // Lock shopkeeper to their assigned shop
    syncContainer.style.display = 'none'; // Only Admin can control price syncing
  }
}

document.getElementById('shop-selector').addEventListener('change', (e) => {
  if (currentUser.role === 'admin') {
    currentShopId = parseInt(e.target.value, 10);
    cart = [];
    renderCart();
  }
});

let cart = [];
let html5QrCode = null;
let isScanning = false;

window.switchTab = function(tabName) {
  ['sell', 'stock', 'expenses', 'reports'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  
  if (tabName === 'stock') loadInventory();
  if (tabName === 'expenses') loadExpenses();
  if (tabName === 'reports') loadReportsAndAnalytics();
};

// Stock Intake with Notifications & Price Sync Control
document.getElementById('stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const barcode = document.getElementById('item-code').value.trim() || null;
  const buy_price = parseFloat(document.getElementById('item-buy').value);
  const sell_price = parseFloat(document.getElementById('item-sell').value);
  const qty = parseInt(document.getElementById('item-qty').value, 10);
  
  // Only Admin controls price sync setting; shopkeepers inherit global or default sync
  const sync_price = currentUser.role === 'admin' ? document.getElementById('sync-price-check').checked : true;

  let { data: product } = await _supabase
    .from('products')
    .select('*')
    .or(`name.ilike.${name}${barcode ? `,barcode.eq.${barcode}` : ''}`)
    .maybeSingle();

  let productId;
  if (product) {
    productId = product.id;
    if (currentUser.role === 'admin' && sync_price) {
      await _supabase.from('products').update({
        global_buy_price: buy_price,
        global_sell_price: sell_price,
        sync_price: true,
        barcode: barcode || product.barcode
      }).eq('id', productId);
    }
  } else {
    const { data: newProd, error: prodErr } = await _supabase.from('products').insert([{
      name, barcode, sync_price, global_buy_price: buy_price, global_sell_price: sell_price
    }]).select().single();
    if (prodErr) { alert('Error: ' + prodErr.message); return; }
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

  // Log stock addition for notifications
  await _supabase.from('stock_logs').insert([{
    shop_id: currentShopId,
    product_name: name,
    qty_added: qty,
    timestamp: new Date().toISOString()
  }]);

  e.target.reset();
  loadInventory();
  alert('Stock saved successfully!');
});

async function loadInventory() {
  const { data: inventory } = await _supabase
    .from('shop_inventory')
    .select('*, products(*)')
    .eq('shop_id', currentShopId);

  const list = document.getElementById('inventory-list');
  if (!inventory || inventory.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No items in stock.</p>';
    return;
  }

  list.innerHTML = inventory.map(inv => {
    const p = inv.products;
    const sell = p.sync_price ? p.global_sell_price : (inv.local_sell_price ?? p.global_sell_price);
    const buy = p.sync_price ? p.global_buy_price : (inv.local_buy_price ?? p.global_buy_price);
    return `
      <div class="py-2.5 flex justify-between items-center">
        <div>
          <p class="font-medium">${p.name} ${inv.stock === 0 ? '<span class="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold">Out of Stock</span>' : ''}</p>
          <p class="text-xs text-slate-500">Sell: ${sell.toFixed(2)} | Profit: ${(sell - buy).toFixed(2)}</p>
        </div>
        <span class="font-bold px-2.5 py-1 rounded-lg ${inv.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-slate-100'}">
          ${inv.stock} left
        </span>
      </div>
    `;
  }).join('');
}

// Search & Cart
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
    return `
      <button onclick="addItemToCart(${p.id}, ${inv.stock})" class="w-full text-left py-2 px-1 hover:bg-slate-50 flex justify-between items-center">
        <span>${p.name} <small class="text-slate-400">(${inv.stock} in stock)</small></span>
        <span class="font-semibold">${sell.toFixed(2)}</span>
      </button>
    `;
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
    document.getElementById('cart-profit').textContent = '0.00';
    return;
  }
  let total = 0, profit = 0;
  cartList.innerHTML = cart.map((item, idx) => {
    total += item.sellPrice * item.qty;
    profit += (item.sellPrice - item.buyPrice) * item.qty;
    return `
      <div class="py-2 flex justify-between items-center">
        <div><p class="font-medium">${item.name} x${item.qty}</p></div>
        <div class="flex items-center gap-3">
          <span class="font-semibold">${(item.sellPrice * item.qty).toFixed(2)}</span>
          <button onclick="removeFromCart(${idx})" class="text-red-500 font-bold px-2">×</button>
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('cart-total').textContent = total.toFixed(2);
  document.getElementById('cart-profit').textContent = profit.toFixed(2);
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

// Expenses
document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);
  await _supabase.from('expenses').insert([{ shop_id: currentShopId, timestamp: new Date().toISOString(), description, amount }]);
  e.target.reset();
  loadExpenses();
  alert('Expense recorded!');
});

async function loadExpenses() {
  const { data: expenses } = await _supabase.from('expenses').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });
  const list = document.getElementById('expenses-list');
  if (!expenses || expenses.length === 0) { list.innerHTML = '<p class="text-slate-400 py-2">No expenses logged.</p>'; return; }
  list.innerHTML = expenses.map(e => `
    <div class="py-2.5 flex justify-between items-center">
      <div><p class="font-medium">${e.description}</p><p class="text-xs text-slate-400">${new Date(e.timestamp).toLocaleTimeString()}</p></div>
      <span class="font-bold text-red-600">-${e.amount.toFixed(2)}</span>
    </div>
  `).join('');
}

// Reports & Advanced Analytics
async function loadReportsAndAnalytics() {
  const { data: sales } = await _supabase.from('sales').select('*').eq('shop_id', currentShopId).order('id', { ascending: false });
  const { data: inventory } = await _supabase.from('shop_inventory').select('*, products(*)').eq('shop_id', currentShopId);
  const { data: logs } = await _supabase.from('stock_logs').select('*').eq('shop_id', currentShopId).order('id', { ascending: false }).limit(5);

  let cashTotal = 0, mpesaTotal = 0, totalRev = 0, totalProf = 0;
  const itemSalesCounts = {};
  const itemProfitCounts = {};

  if (sales) {
    sales.forEach(s => {
      totalRev += s.total_amount;
      totalProf += s.total_profit;
      if (s.payment_method === 'Cash') cashTotal += s.total_amount;
      if (s.payment_method === 'M-Pesa') mpesaTotal += s.total_amount;

      s.items.forEach(i => {
        itemSalesCounts[i.name] = (itemSalesCounts[i.name] || 0) + i.qty;
        const profit = (i.sellPrice - i.buyPrice) * i.qty;
        itemProfitCounts[i.name] = (itemProfitCounts[i.name] || 0) + profit;
      });
    });
  }

  document.getElementById('cash-revenue').textContent = cashTotal.toFixed(2);
  document.getElementById('mpesa-revenue').textContent = mpesaTotal.toFixed(2);
  document.getElementById('total-revenue').textContent = totalRev.toFixed(2);
  document.getElementById('total-profit').textContent = totalProf.toFixed(2);

  // Compute Most Sold, Least Sold, Greatest Profit
  let mostSold = 'N/A', maxProfitItem = 'N/A', leastSold = 'N/A';
  const soldEntries = Object.entries(itemSalesCounts);
  const profitEntries = Object.entries(itemProfitCounts);

  if (soldEntries.length > 0) {
    soldEntries.sort((a, b) => b[1] - a[1]);
    mostSold = `${soldEntries[0][0]} (${soldEntries[0][1]} sold)`;
    leastSold = `${soldEntries[soldEntries.length - 1][0]} (${soldEntries[soldEntries.length - 1][1]} sold)`;
  }
  if (profitEntries.length > 0) {
    profitEntries.sort((a, b) => b[1] - a[1]);
    maxProfitItem = `${profitEntries[0][0]} (+${profitEntries[0][1].toFixed(2)})`;
  }

  let outOfStockCount = 0;
  if (inventory) {
    inventory.forEach(inv => { if (inv.stock === 0) outOfStockCount++; });
  }

  document.getElementById('stat-most-sold').textContent = mostSold;
  document.getElementById('stat-max-profit').textContent = maxProfitItem;
  document.getElementById('stat-least-sold').textContent = leastSold;
  document.getElementById('stat-out-stock').textContent = `${outOfStockCount} items`;

  // Stock Notification Logs Feed
  const notifList = document.getElementById('stock-notifications-list');
  if (!logs || logs.length === 0) {
    notifList.innerHTML = '<p class="text-slate-400 py-1">No recent stock additions.</p>';
  } else {
    notifList.innerHTML = logs.map(l => `
      <div class="py-1.5 flex justify-between">
        <span>Restocked: <strong>${l.product_name}</strong> (+${l.qty_added})</span>
        <span class="text-slate-400">${new Date(l.timestamp).toLocaleTimeString()}</span>
      </div>
    `).join('');
  }

  // History Ledger
  const historyDiv = document.getElementById('sales-history');
  if (!sales || sales.length === 0) {
    historyDiv.innerHTML = '<p class="text-slate-400 py-2">No sales recorded.</p>';
    return;
  }
  historyDiv.innerHTML = sales.map(s => {
    const summary = s.items.map(i => `${i.name} (x${i.qty})`).join(', ');
    return `
      <div class="py-2.5 flex justify-between items-start border-b border-slate-50 text-xs">
        <div>
          <p class="font-medium">${summary}</p>
          <p class="text-slate-400">${new Date(s.timestamp).toLocaleString()} • <strong>${s.payment_method}</strong></p>
        </div>
        <div class="text-right">
          <p class="font-bold">${s.total_amount.toFixed(2)}</p>
          <p class="text-emerald-600">+${s.total_profit.toFixed(2)} profit</p>
        </div>
      </div>
    `;
  }).join('');
}

// Scanner setup
document.getElementById('toggle-scan-btn').addEventListener('click', () => {
  const readerDiv = document.getElementById('reader');
  if (isScanning) {
    html5QrCode.stop().then(() => { readerDiv.classList.add('hidden'); isScanning = false; });
    return;
  }
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

// CSV Export
document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const { data: sales } = await _supabase.from('sales').select('*').eq('shop_id', currentShopId);
  let csv = 'Date,Payment Method,Items,Total Sale,Net Profit\n';
  sales.forEach(s => {
    const itemsStr = s.items.map(i => `${i.name} x${i.qty}`).join(' | ');
    csv += `"${s.timestamp}","${s.payment_method}","${itemsStr}",${s.total_amount},${s.total_profit}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shop-${currentShopId}-sales.csv`;
  a.click();
});