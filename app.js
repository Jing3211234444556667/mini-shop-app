// REPLACE THESE WITH YOUR SUPABASE PROJECT URL AND ANON KEY FROM SUPABASE DASHBOARD
const SUPABASE_URL = 'https://ktkvgyicasrdzxmrafga.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DZLo2mb2b_lCw9kN6za4sw_LY1XTdTr';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let cart = [];
let html5QrCode = null;
let isScanning = false;

// Navigation Tab Switcher
window.switchTab = function(tabName) {
  ['sell', 'stock', 'expenses', 'records'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  
  if (tabName === 'stock') loadInventory();
  if (tabName === 'expenses') loadExpenses();
  if (tabName === 'records') loadRecords();
};

// 1. Stock Intake / Update (Syncs across both shop phones)
document.getElementById('stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const barcode = document.getElementById('item-code').value.trim() || null;
  const buy_price = parseFloat(document.getElementById('item-buy').value);
  const sell_price = parseFloat(document.getElementById('item-sell').value);
  const qty = parseInt(document.getElementById('item-qty').value, 10);

  // Check if item already exists by name or barcode
  const { data: existing } = await _supabase
    .from('products')
    .select('*')
    .or(`name.ilike.${name}${barcode ? `,barcode.eq.${barcode}` : ''}`)
    .maybeSingle();

  if (existing) {
    // Update existing item prices and add to stock count
    const { error } = await _supabase
      .from('products')
      .update({
        buy_price,
        sell_price,
        barcode: barcode || existing.barcode,
        stock: existing.stock + qty
      })
      .eq('id', existing.id);

    if (error) alert('Error updating stock: ' + error.message);
    else alert('Stock & prices updated across all shops!');
  } else {
    // Insert new item
    const { error } = await _supabase
      .from('products')
      .insert([{ name, barcode, buy_price, sell_price, stock: qty }]);

    if (error) alert('Error adding item: ' + error.message);
    else alert('New item added and synced!');
  }

  e.target.reset();
  loadInventory();
});

async function loadInventory() {
  const { data: products, error } = await _supabase.from('products').select('*').order('name');
  const list = document.getElementById('inventory-list');
  if (error || !products || products.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No products found.</p>';
    return;
  }
  list.innerHTML = products.map(p => `
    <div class="py-2.5 flex justify-between items-center">
      <div>
        <p class="font-medium">${p.name} ${p.barcode ? `<span class="text-xs bg-slate-200 px-1.5 py-0.5 rounded">${p.barcode}</span>` : ''}</p>
        <p class="text-xs text-slate-500">Buy: ${p.buy_price} | Sell: ${p.sell_price} | Profit: ${(p.sell_price - p.buy_price).toFixed(2)}</p>
      </div>
      <span class="font-bold px-2.5 py-1 rounded-lg ${p.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-slate-100'}">
        ${p.stock} left
      </span>
    </div>
  `).join('');
}

// 2. Manual Search & Cart Handling
document.getElementById('search-input').addEventListener('input', async (e) => {
  const query = e.target.value.trim().toLowerCase();
  const resultsBox = document.getElementById('search-results');
  if (!query) {
    resultsBox.innerHTML = '';
    return;
  }

  const { data: matches } = await _supabase
    .from('products')
    .select('*')
    .or(`name.ilike.%${query}%,barcode.ilike.%${query}%`);

  if (!matches || matches.length === 0) {
    resultsBox.innerHTML = '<p class="text-xs text-slate-400 p-2">No items found</p>';
    return;
  }

  resultsBox.innerHTML = matches.map(p => `
    <button onclick="addToCart(${p.id})" class="w-full text-left py-2 px-1 hover:bg-slate-50 flex justify-between items-center">
      <span>${p.name} <small class="text-slate-400">(${p.stock} in stock)</small></span>
      <span class="font-semibold">${p.sell_price.toFixed(2)}</span>
    </button>
  `).join('');
});

window.addToCart = async function(productId) {
  const { data: product } = await _supabase.from('products').select('*').eq('id', productId).single();
  if (!product || product.stock <= 0) {
    alert('Out of stock!');
    return;
  }

  const existing = cart.find(c => c.id === product.id);
  if (existing) {
    if (existing.qty + 1 > product.stock) {
      alert('Not enough stock available.');
      return;
    }
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
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
    const lineTotal = item.sell_price * item.qty;
    const lineProfit = (item.sell_price - item.buy_price) * item.qty;
    total += lineTotal;
    profit += lineProfit;
    return `
      <div class="py-2 flex justify-between items-center">
        <div>
          <p class="font-medium">${item.name} x${item.qty}</p>
          <p class="text-xs text-slate-400">@ ${item.sell_price.toFixed(2)}</p>
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

// 3. Complete Sale (Cash or M-Pesa + Live Stock Deduction)
document.getElementById('complete-sale-btn').addEventListener('click', async () => {
  if (cart.length === 0) return;

  const payment_method = document.querySelector('input[name="payment-method"]:checked').value;
  let totalAmount = 0;
  let totalProfit = 0;

  for (const item of cart) {
    totalAmount += item.sell_price * item.qty;
    totalProfit += (item.sell_price - item.buy_price) * item.qty;

    // Deduct stock in Supabase database
    await _supabase
      .from('products')
      .update({ stock: item.stock - item.qty })
      .eq('id', item.id);
  }

  const { error } = await _supabase.from('sales').insert([{
    timestamp: new Date().toISOString(),
    total_amount: totalAmount,
    total_profit: totalProfit,
    payment_method,
    items: cart.map(c => ({ name: c.name, qty: c.qty, sell_price: c.sell_price }))
  }]);

  if (error) {
    alert('Error recording sale: ' + error.message);
    return;
  }

  cart = [];
  renderCart();
  alert(`Sale recorded successfully via ${payment_method}!`);
});

// 4. Expenses Tracker
document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('exp-desc').value.trim();
  const amount = parseFloat(document.getElementById('exp-amount').value);

  const { error } = await _supabase.from('expenses').insert([{
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
  const { data: expenses } = await _supabase.from('expenses').select('*').order('id', { ascending: false });
  const list = document.getElementById('expenses-list');
  if (!expenses || expenses.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No expenses logged yet.</p>';
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

// 5. Daily Reports & Breakdown (Cash vs M-Pesa + Profit)
async function loadRecords() {
  const { data: sales } = await _supabase.from('sales').select('*').order('id', { ascending: false });
  
  let cashTotal = 0;
  let mpesaTotal = 0;
  let totalRev = 0;
  let totalProf = 0;

  sales.forEach(s => {
    totalRev += s.total_amount;
    totalProf += s.total_profit;
    if (s.payment_method === 'Cash') cashTotal += s.total_amount;
    if (s.payment_method === 'M-Pesa') mpesaTotal += s.total_amount;
  });

  document.getElementById('cash-revenue').textContent = cashTotal.toFixed(2);
  document.getElementById('mpesa-revenue').textContent = mpesaTotal.toFixed(2);
  document.getElementById('total-revenue').textContent = totalRev.toFixed(2);
  document.getElementById('total-profit').textContent = totalProf.toFixed(2);

  const historyDiv = document.getElementById('sales-history');
  if (!sales || sales.length === 0) {
    historyDiv.innerHTML = '<p class="text-slate-400 py-2">No sales recorded yet.</p>';
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

// 6. Camera Scanner
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
        addToCart(product.id);
        html5QrCode.stop().then(() => {
          readerDiv.classList.add('hidden');
          isScanning = false;
        });
      } else {
        alert(`Code "${decodedText}" not found in inventory.`);
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

// CSV Export
document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const { data: sales } = await _supabase.from('sales').select('*');
  let csv = 'Date,Payment Method,Items,Total Sale,Net Profit\n';
  sales.forEach(s => {
    const itemsStr = s.items.map(i => `${i.name} x${i.qty}`).join(' | ');
    csv += `"${s.timestamp}","${s.payment_method}","${itemsStr}",${s.total_amount},${s.total_profit}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shop-records-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});