// 1. Register Service Worker for Offline Mode
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 2. Initialize Local Phone Database (IndexedDB via Dexie)
const db = new Dexie('MiniShopDB');
db.version(1).stores({
  products: '++id, name, barcode, buyPrice, sellPrice, stock',
  sales: '++id, timestamp, totalAmount, totalProfit, items'
});

let cart = [];
let html5QrCode = null;
let isScanning = false;

// 3. Navigation Tab Switcher
window.switchTab = function(tabName) {
  ['sell', 'stock', 'records'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.add('hidden');
  });
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  
  if (tabName === 'stock') renderInventory();
  if (tabName === 'records') renderRecords();
};

// 4. Stock Intake (Add new item or restock existing)
document.getElementById('stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('item-name').value.trim();
  const barcode = document.getElementById('item-code').value.trim() || null;
  const buyPrice = parseFloat(document.getElementById('item-buy').value);
  const sellPrice = parseFloat(document.getElementById('item-sell').value);
  const qty = parseInt(document.getElementById('item-qty').value, 10);

  // Check if item already exists by name or barcode
  const existing = await db.products
    .filter(p => p.name.toLowerCase() === name.toLowerCase() || (barcode && p.barcode === barcode))
    .first();

  if (existing) {
    await db.products.update(existing.id, {
      buyPrice,
      sellPrice,
      barcode: barcode || existing.barcode,
      stock: existing.stock + qty
    });
  } else {
    await db.products.add({ name, barcode, buyPrice, sellPrice, stock: qty });
  }

  e.target.reset();
  renderInventory();
  alert('Stock updated!');
});

async function renderInventory() {
  const products = await db.products.toArray();
  const list = document.getElementById('inventory-list');
  if (products.length === 0) {
    list.innerHTML = '<p class="text-slate-400 py-2">No products in stock.</p>';
    return;
  }
  list.innerHTML = products.map(p => `
    <div class="py-2.5 flex justify-between items-center">
      <div>
        <p class="font-medium">${p.name} ${p.barcode ? `<span class="text-xs bg-slate-200 px-1.5 py-0.5 rounded">${p.barcode}</span>` : ''}</p>
        <p class="text-xs text-slate-500">Buy: ${p.buyPrice} | Sell: ${p.sellPrice} | Profit/unit: ${(p.sellPrice - p.buyPrice).toFixed(2)}</p>
      </div>
      <span class="font-bold px-2.5 py-1 rounded-lg ${p.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-slate-100'}">
        ${p.stock} left
      </span>
    </div>
  `).join('');
}

// 5. Manual Search & Add to Basket
document.getElementById('search-input').addEventListener('input', async (e) => {
  const query = e.target.value.trim().toLowerCase();
  const resultsBox = document.getElementById('search-results');
  if (!query) {
    resultsBox.innerHTML = '';
    return;
  }

  const matches = await db.products
    .filter(p => p.name.toLowerCase().includes(query) || (p.barcode && p.barcode.toLowerCase().includes(query)))
    .toArray();

  resultsBox.innerHTML = matches.map(p => `
    <button onclick="addToCart(${p.id})" class="w-full text-left py-2 px-1 hover:bg-slate-50 flex justify-between items-center">
      <span>${p.name} <small class="text-slate-400">(${p.stock} in stock)</small></span>
      <span class="font-semibold">${p.sellPrice.toFixed(2)}</span>
    </button>
  `).join('');
});

window.addToCart = async function(productId) {
  const product = await db.products.get(productId);
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

// 6. Complete Sale (Uptake & Profit Recording)
document.getElementById('complete-sale-btn').addEventListener('click', async () => {
  if (cart.length === 0) return;

  let totalAmount = 0;
  let totalProfit = 0;

  for (const item of cart) {
    totalAmount += item.sellPrice * item.qty;
    totalProfit += (item.sellPrice - item.buyPrice) * item.qty;

    // Deduct stock
    const currentProd = await db.products.get(item.id);
    await db.products.update(item.id, { stock: currentProd.stock - item.qty });
  }

  await db.sales.add({
    timestamp: new Date().toISOString(),
    totalAmount,
    totalProfit,
    items: cart.map(c => ({ name: c.name, qty: c.qty, sellPrice: c.sellPrice, buyPrice: c.buyPrice }))
  });

  cart = [];
  renderCart();
  alert('Sale recorded!');
});

// 7. Camera QR / Barcode Scanner
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
      const product = await db.products.where('barcode').equals(decodedText).first();
      if (product) {
        addToCart(product.id);
        html5QrCode.stop().then(() => {
          readerDiv.classList.add('hidden');
          isScanning = false;
        });
      } else {
        alert(`Code "${decodedText}" not found in stock.`);
      }
    }
  ).then(() => { isScanning = true; });
});

// Scan barcode when adding new stock
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

// 8. Records, Profit Summary & CSV Export
async function renderRecords() {
  const sales = await db.sales.reverse().toArray();
  let rev = 0;
  let prof = 0;

  sales.forEach(s => {
    rev += s.totalAmount;
    prof += s.totalProfit;
  });

  document.getElementById('total-revenue').textContent = rev.toFixed(2);
  document.getElementById('total-profit').textContent = prof.toFixed(2);

  const historyDiv = document.getElementById('sales-history');
  if (sales.length === 0) {
    historyDiv.innerHTML = '<p class="text-slate-400 py-2">No sales recorded yet.</p>';
    return;
  }

  historyDiv.innerHTML = sales.map(s => {
    const date = new Date(s.timestamp).toLocaleString();
    const summary = s.items.map(i => `${i.name} (x${i.qty})`).join(', ');
    return `
      <div class="py-2.5 flex justify-between items-start">
        <div>
          <p class="font-medium">${summary}</p>
          <p class="text-xs text-slate-400">${date}</p>
        </div>
        <div class="text-right">
          <p class="font-bold">${s.totalAmount.toFixed(2)}</p>
          <p class="text-xs text-emerald-600">+${s.totalProfit.toFixed(2)} profit</p>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const sales = await db.sales.toArray();
  let csv = 'Date,Items,Total Sale,Net Profit\n';
  sales.forEach(s => {
    const itemsStr = s.items.map(i => `${i.name} x${i.qty}`).join(' | ');
    csv += `"${s.timestamp}","${itemsStr}",${s.totalAmount},${s.totalProfit}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shop-records-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
});