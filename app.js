const SUPABASE_URL = 'https://ktkvgyicasrdzxmrafga.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZLo2mb2b_lCw9kN6za4sw_LY1XTdTr';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentShopId = parseInt(localStorage.getItem('active_shop_id') || '1', 10);
document.getElementById('shop-selector').value = currentShopId;

document.getElementById('shop-selector').addEventListener('change', (e) => {
  currentShopId = parseInt(e.target.value, 10);
  localStorage.setItem('active_shop_id', currentShopId);
  cart = [];
  renderCart();
  alert(`Switched active shop!`);
  const activeTab = document.querySelector('section:not(.hidden), main:not(.hidden)').id;
  if (activeTab === 'tab-stock') loadInventory();
  if (activeTab === 'tab-expenses') loadExpenses();
  if (activeTab === 'tab-records') loadRecords();
});

let cart = [];
let html5QrCode = null;
let isScanning = false;

window.switchTab = function(tabName) {
  ['sell', 'stock', 'expenses', 'records'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  
  if (tabName === 'stock') loadInventory();
  if (tabName === 'expenses') loadExpenses();
  if (tabName === 'records') loadRecords();
};

// 1. Stock Intake / Update with Price Sync Option
document.getElementById('stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const barcode = document.getElementById('item-code').value.trim() || null;
  const buy_price = parseFloat(document.getElementById('item-buy').value);
  const sell_price = parseFloat(document.getElementById('item-sell').value);
  const qty = parseInt(document.getElementById('item-qty').value, 10);
  const sync_price = document.getElementById('sync-price-check').checked;

  // Check if global product exists
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
    // Create new global product
    const { data: newProd, error: prodErr } = await _supabase.from('products').insert([{
      name,
      barcode,
      sync_price,
      global_buy_price: buy_price,
      global_sell_price: sell_price
    }]).select().single();

    if (prodErr) {
      alert('Error creating product: ' + prodErr.message);
      return;
    }
    productId = newProd.id;
  }

  // Check shop inventory record for this shop
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
      shop_id: currentShopId,
      product_id: productId,
      stock: qty,
      local_buy_price: sync_price ? null : buy_price,
      local_sell_price: sync_price ? null : sell_price
    }]);
  }

  e.target.reset();
  loadInventory();
  alert('Stock saved successfully for this shop!');
});

async function loadInventory() {
  const { data: inventory } = await _supabase
    .from('shop_inventory')
    .select('*, products(*)')
    .eq('shop_id', currentShopId);

  const list = document.getElementById('inventory-list');
  if (!inventory || inventory.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No items in stock for this shop.</p>';
    return;
  }

  list.innerHTML = inventory.map(inv => {
    const p = inv.products;
    const sell = p.sync_price ? p.global_sell_price : (inv.local_sell_price ?? p.global_sell_price);
    const buy = p.sync_price ? p.global_buy_price : (inv.local_buy_price ?? p.global_buy_price);
    const profit = sell - buy;

    return `
      <div class="py-2.5 flex justify-between items-center">
        <div>
          <p class="font-medium">${p.name} ${p.barcode ? `<span class="text-xs bg-slate-200 px-1.5 py-0.5 rounded">${p.barcode}</span>` : ''}</p>
          <p class="text-xs text-slate-500">Sell: ${sell.toFixed(2)} | Profit: ${profit.toFixed(2)} ${p.sync_price ? '(Synced Price)' : '(Custom Price)'}</p>
        </div>
        <span class="font-bold px-2.5 py-1 rounded-lg ${inv.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-slate-100'}">
          ${inv.stock} left
        </span>
      </div>
    `;
  }).join('');
}

// 2. Search & Cart (Using Shop Inventory)
document.getElementById('search-input').addEventListener('input', async (e) => {
  const query = e.target.value.trim().toLowerCase();
  const resultsBox = document.getElementById('search-results');
  if (!query) {
    resultsBox.innerHTML = '';
    return;
  }

  // Search global products
  const { data: matches } = await _supabase
    .from('products')
    .select('*')
    .or(`name.ilike.%${query}%,barcode.ilike.%${query}%`);

  if (!matches || matches.length === 0) {
    resultsBox.innerHTML = '<p class="text-xs text-slate-400 p-2">No items found</p>';
    return;
  }

  // Fetch shop inventory for these matches
  const productIds = matches.map(m => m.id);
  const { data: inventories } = await _supabase
    .from('shop_inventory')
    .select('*')
    .eq('shop_id', currentShopId)
    .in('product_id', productIds);

  const invMap = {};
  if (inventories) inventories.forEach(inv => { invMap[inv.product_id] = inv; });

  resultsBox.innerHTML = matches.map(p => {
    const inv = invMap[p.id] || { stock: 0 };
    const sell = p.sync_price ? p.global_sell_price : (inv.local_sell_price ?? p.global_sell_price);
    return `
      <button onclick="addItemToCart(${p.id}, ${inv.stock})" class="w-full text-left py-2 px-1 hover:bg-slate-50 flex justify-between items-center">
        <span>${p.name} <small class="text-slate-400">(${inv.stock} in this shop)</small></span>
        <span class="font-semibold">${sell.toFixed(2)}</span>
      </button>
    `;
  }).join('');
});

window.addItemToCart = async function(productId, currentStock) {
  if (currentStock <= 0) {
    alert('Item is out of stock in this shop! Please restock it first.');
    return;
  }

  const { data: product } = await _supabase.from('products').select('*').eq('id', productId).single();
  const { data: shopInv } = await _supabase.from('shop_inventory').select('*').eq('shop_id', currentShopId).eq('product_id', productId).single();

  const sellPrice = product.sync_price ? product.global_sell_price : (shopInv.local_sell_price ?? product.global_sell_price);
  const buyPrice = product.sync_price ? product.global_buy_price : (shopInv.local_buy_price ?? product.global_buy_price);

  const existing = cart.find(c => c.productId === productId);
  if (existing) {
    if (existing.qty + 1 > currentStock) {
      alert('Not enough stock available in this shop.');
      return;
    }
    existing.qty += 1;
  } else {
    cart.push({
      productId,
      name: product.name,
      sellPrice,
      buyPrice,
      stock: currentStock,
      qty: 1
    });
  }

  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  renderCart();
};

window.removeFromCart = function(index) {
  cart.splice(index, 1);
  renderCart();
};

function renderCart() {
  const cartList = document.getElementById('cart-list');
  if (cart.length === 0) {
    cartList.innerHTML = '<p class="text-slate-400 py-2">No items added yet.</p>';
    document.getElementById('cart-total').textContent = '0.00';
    document.getElementById('cart-profit').textContent = '0.00';
    return;
  }

  let total = 0;
  let profit = 0;

  cartList.innerHTML = cart.map((item, idx) => {
    const lineTotal = item.sellPrice * item.qty;
    const lineProfit = (item.sellPrice - item.buyPrice) * item.qty;
    total += lineTotal;
    profit += lineProfit;
    return `
      <div class="py-2 flex justify-between items-center">
        <div>
          <p class="font-medium">${item.name} x${item.qty}</p>
          <p class="text-xs text-slate-400">@ ${item.sellPrice.toFixed(2)}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-semibold">${lineTotal.toFixed(2)}</span>
          <button onclick="removeFromCart(${idx})" class="text-red-500 font-bold px-2">×</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('cart-total').textContent = total.toFixed(2);
  document.getElementById('cart-profit').textContent = profit.toFixed(2);
}

// 3. Complete Sale for Active Shop
document.getElementById('complete-sale-btn').addEventListener('click', async () => {
  if (cart.length === 0) return;

  const payment_method = document.querySelector('input[name="payment-method"]:checked').value;
  let totalAmount = 0;
  let totalProfit = 0;

  for (const item of cart) {
    totalAmount += item.sellPrice * item.qty;
    totalProfit += (item.sellPrice - item.buyPrice) * item.qty;

    // Fetch current inventory record for this shop
    const { data: shopInv } = await _supabase
      .from('shop_inventory')
      .select('*')
      .eq('shop_id', currentShopId)
      .eq('product_id', item.productId)
      .single();

    // Deduct stock strictly for this shop
    await _supabase
      .from('shop_inventory')
      .update({ stock: shopInv.stock - item.qty })
      .eq('id', shopInv.id);
  }

  const { error } = await _supabase.from('sales').insert([{
    shop_id: currentShopId,
    timestamp: new Date().toISOString(),
    total_amount: totalAmount,
    total_profit: totalProfit,
    payment_method,
    items: cart.map(c => ({ name: c.name, qty: c.qty, sellPrice: c.sellPrice }))
  }]);

  if (error) {
    alert('Error recording sale: ' + error.message);
    return;
  }

  cart = [];
  renderCart();
  alert(`Sale recorded via ${payment_method} for current shop!`);
});

// 4. Expenses for Active Shop
document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);

  const { error } = await _supabase.from('expenses').insert([{
    shop_id: currentShopId,
    timestamp: new Date().toISOString(),
    description,
    amount
  }]);

  if (error) alert('Error saving expense: ' + error.message);
  else {
    alert('Expense recorded!');
    e.target.reset();
    loadExpenses();
  }
});

async function loadExpenses() {
  const { data: expenses } = await _supabase
    .from('expenses')
    .select('*')
    .eq('shop_id', currentShopId)
    .order('id', { ascending: false });

  const list = document.getElementById('expenses-list');
  if (!expenses || expenses.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No expenses logged for this shop today.</p>';
    return;
  }

  list.innerHTML = expenses.map(e => `
    <div class="py-2.5 flex justify-between items-center">
      <div>
        <p class="font-medium">${e.description}</p>
        <p class="text-xs text-slate-400">${new Date(e.timestamp).toLocaleTimeString()}</p>
      </div>
      <span class="font-bold text-red-600">-${e.amount.toFixed(2)}</span>
    </div>
  `).join('');
}

// 5. Reports for Active Shop
async function loadRecords() {
  const { data: sales } = await _supabase
    .from('sales')
    .select('*')
    .eq('shop_id', currentShopId)
    .order('id', { ascending: false });
  
  let cashTotal = 0;
  let mpesaTotal = 0;
  let totalRev = 0;
  let totalProf = 0;

  if (sales) {
    sales.forEach(s => {
      totalRev += s.total_amount;
      totalProf += s.total_profit;
      if (s.payment_method === 'Cash') cashTotal += s.total_amount;
      if (s.payment_method === 'M-Pesa') mpesaTotal += s.total_amount;
    });
  }

  document.getElementById('cash-revenue').textContent = cashTotal.toFixed(2);
  document.getElementById('mpesa-revenue').textContent = mpesaTotal.toFixed(2);
  document.getElementById('total-revenue').textContent = totalRev.toFixed(2);
  document.getElementById('total-profit').textContent = totalProf.toFixed(2);

  const historyDiv = document.getElementById('sales-history');
  if (!sales || sales.length === 0) {
    historyDiv.innerHTML = '<p class="text-slate-400 py-2">No sales recorded for this shop yet.</p>';
    return;
  }

  historyDiv.innerHTML = sales.map(s => {
    const date = new Date(s.timestamp).toLocaleString();
    const summary = s.items.map(i => `${i.name} (x${i.qty})`).join(', ');
    return `
      <div class="py-2.5 flex justify-between items-start border-b border-slate-50">
        <div>
          <p class="font-medium">${summary}</p>
          <p class="text-xs text-slate-400">${date} • <span class="font-semibold text-slate-600">${s.payment_method}</span></p>
        </div>
        <div class="text-right">
          <p class="font-bold">${s.total_amount.toFixed(2)}</p>
          <p class="text-xs text-emerald-600">+${s.total_profit.toFixed(2)} profit</p>
        </div>
      </div>
    `;
  }).join('');
}

// 6. Camera Scanner (Checks barcode against global catalog and active shop stock)
document.getElementById('toggle-scan-btn').addEventListener('click', () => {
  const readerDiv = document.getElementById('reader');
  if (isScanning) {
    html5QrCode.stop().then(() => {
      readerDiv.classList.add('hidden');
      isScanning = false;
    });
    return;
  }

  readerDiv.classList.remove('hidden');
  html5QrCode = new Html5Qrcode('reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 220 } },
    async (decodedText) => {
      const { data: product } = await _supabase.from('products').select('*').eq('barcode', decodedText).single();
      if (product) {
        const { data: shopInv } = await _supabase.from('shop_inventory').select('*').eq('shop_id', currentShopId).eq('product_id', product.id).maybeSingle();
        const stock = shopInv ? shopInv.stock : 0;
        addItemToCart(product.id, stock);
        html5QrCode.stop().then(() => {
          readerDiv.classList.add('hidden');
          isScanning = false;
        });
      } else {
        alert(`Barcode "${decodedText}" not recognized in system.`);
      }
    }
  ).then(() => { isScanning = true; });
});

document.getElementById('scan-stock-code-btn').addEventListener('click', () => {
  const stockReader = document.getElementById('stock-reader');
  stockReader.classList.remove('hidden');
  const scanner = new Html5Qrcode('stock-reader');
  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 200 },
    (decodedText) => {
      document.getElementById('item-code').value = decodedText;
      scanner.stop().then(() => stockReader.classList.add('hidden'));
    }
  );
});

// CSV Export for Active Shop
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
  a.download = `shop-${currentShopId}-records-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});