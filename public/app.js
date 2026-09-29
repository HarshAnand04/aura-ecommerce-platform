// State
let token = localStorage.getItem('token') || null;
let user = null;
try {
  user = JSON.parse(localStorage.getItem('user'));
} catch (error) {
  localStorage.removeItem('user');
}
let isLoginMode = true;

// DOM Elements
const authLink = document.getElementById('auth-link');
const cartLink = document.getElementById('cart-link');
const ordersLink = document.getElementById('orders-link');
const adminLink = document.getElementById('admin-link');
const authModal = document.getElementById('auth-modal');
const toast = document.getElementById('toast');
const productSearch = document.getElementById('product-search');
const categoryFilter = document.getElementById('category-filter');
const productsPerPage = 8;
let productPage = 1;
let productTotalPages = 1;
let inventoryPage = 1;
let inventoryTotalPages = 1;
let editingProductId = null;
let searchTimer;

// Initialize
async function init() {
  bindEvents();
  updateAuthUI();
  await refreshCategoryOptions();
  fetchProducts();
  if (token) fetchCart();
}

// Navigation
function showSection(sectionId) {
  if (['cart', 'orders', 'admin'].includes(sectionId) && !token) {
    showToast('Please login to continue');
    toggleAuthModal();
    return;
  }

  if (sectionId === 'admin' && user?.role !== 'admin') {
    showToast('Admin access required');
    return;
  }

  if (sectionId === 'orders' && !token) {
    showToast('Please login to view your orders');
    toggleAuthModal();
    return;
  }

  document.querySelectorAll('section').forEach(sec => {
    sec.classList.remove('active-section');
    sec.classList.add('hidden-section');
  });
  document.getElementById(`${sectionId}-section`).classList.remove('hidden-section');
  document.getElementById(`${sectionId}-section`).classList.add('active-section');
  
  if(sectionId === 'cart' && token) fetchCart();
  if(sectionId === 'cart' && !token) showToast('Please login to view cart');
  if(sectionId === 'orders') fetchOrders();
  if(sectionId === 'admin') fetchAdminProducts();
}

// Auth UI Logic
function updateAuthUI() {
  if (token && user) {
    authLink.textContent = `Logout (${user.name})`;
    ordersLink.hidden = false;
    adminLink.hidden = user.role !== 'admin';
  } else {
    authLink.textContent = 'Login';
    cartLink.innerText = 'Cart (0)';
    ordersLink.hidden = true;
    adminLink.hidden = true;
  }
}

function toggleAuthModal() {
  authModal.classList.toggle('show');
}

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-title').innerText = isLoginMode ? 'Welcome Back' : 'Create Account';
  document.getElementById('auth-btn').innerText = isLoginMode ? 'Login' : 'Register';
  const nameInput = document.getElementById('auth-name');
  if (isLoginMode) {
    nameInput.classList.add('hidden-input');
  } else {
    nameInput.classList.remove('hidden-input');
  }
  document.querySelector('.toggle-text').firstChild.textContent = isLoginMode
    ? "Don't have an account? "
    : 'Already have an account? ';
  document.getElementById('auth-mode-toggle').textContent = isLoginMode ? 'Register' : 'Login';
}

// API Calls
async function handleAuth() {
  const email = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value;

  const endpoint = isLoginMode ? '/api/users/login' : '/api/users/register';
  const body = isLoginMode ? { email, password } : { name, email, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    const data = await res.json();
    
    if (res.ok) {
      token = data.token;
      user = data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      toggleAuthModal();
      updateAuthUI();
      fetchCart();
      showToast(isLoginMode ? 'Logged in successfully!' : 'Registration successful!');
    } else {
      showToast(data.message || 'Authentication failed');
    }
  } catch (err) {
    showToast('Network error');
  }
}

function logout() {
  token = null;
  user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  updateAuthUI();
  showSection('store');
  showToast('Logged out');
}

// Product Logic
async function fetchProducts(page = productPage) {
  try {
    const params = new URLSearchParams();
    const keyword = productSearch.value.trim();
    const category = categoryFilter.value;
    params.set('page', page);
    params.set('limit', productsPerPage);
    if (keyword) params.set('keyword', keyword);
    if (category && category !== 'All') params.set('category', category);

    const query = params.toString();
    const res = await fetch(`/api/products${query ? `?${query}` : ''}`);
    const products = await res.json();
    if (!res.ok) throw new Error(products.message || 'Failed to load products');

    productPage = Number(res.headers.get('X-Page')) || page;
    productTotalPages = Number(res.headers.get('X-Total-Pages')) || 1;
    updatePagination('products', productPage, productTotalPages);

    const grid = document.getElementById('product-grid');
    grid.replaceChildren();

    if (!products.length) {
      grid.textContent = 'No products match your search.';
      return;
    }

    products.forEach(product => grid.appendChild(createProductCard(product)));
  } catch (err) {
    document.getElementById('product-grid').textContent = err.message || 'Failed to load products.';
  }
}

async function refreshCategoryOptions() {
  try {
    const res = await fetch('/api/products?limit=50');
    const products = await res.json();
    if (!res.ok) return;

    const selectedCategory = categoryFilter.value || 'All';
    const categories = [...new Set(products.map(product => product.category).filter(Boolean))].sort();
    categoryFilter.replaceChildren(new Option('All categories', 'All'));
    categories.forEach(category => categoryFilter.add(new Option(category, category)));
    categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : 'All';
  } catch (error) {
    console.error('Could not load product categories', error);
  }
}

function createProductCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card glass-panel';

  const image = document.createElement('img');
  image.src = getProductImage(product.name);
  image.alt = product.name;
  image.className = 'product-img';

  const info = document.createElement('div');
  info.className = 'product-info';

  const title = document.createElement('h2');
  title.className = 'product-title';
  title.textContent = product.name;

  const price = document.createElement('p');
  price.className = 'product-price';
  price.textContent = `$${Number(product.price).toFixed(2)}`;

  const description = document.createElement('p');
  description.className = 'product-description';
  description.textContent = product.description;

  const stock = document.createElement('p');
  stock.className = 'product-stock';
  stock.textContent = `Stock: ${product.stock}`;

  const button = document.createElement('button');
  button.className = 'btn primary-btn';
  button.type = 'button';
  button.textContent = product.stock > 0 ? 'Add to Cart' : 'Out of Stock';
  button.disabled = product.stock === 0;
  button.addEventListener('click', () => addToCart(product._id));

  info.append(title, price, description, stock, button);
  card.append(image, info);
  return card;
}

function getProductImage(name = '') {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes('watch')) return 'images/smartwatch.png';
  if (normalizedName.includes('keyboard')) return 'images/keyboard.png';
  return 'images/headphones.png';
}

// Cart Logic
async function fetchCart() {
  if (!token) return;
  try {
    const res = await fetch('/api/cart', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const cart = await res.json();
      renderCart(cart);
    }
  } catch (err) {
    console.error(err);
  }
}

async function addToCart(productId) {
  if (!token) {
    toggleAuthModal();
    return;
  }
  
  try {
    const res = await fetch('/api/cart', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ productId, quantity: 1 })
    });
    
    const data = await res.json();
    if (res.ok) {
      showToast('Added to cart!');
      fetchCart();
    } else {
      showToast(data.message || 'Could not add to cart');
    }
  } catch (err) {
    showToast('Error adding to cart');
  }
}

async function removeFromCart(productId) {
  try {
    const res = await fetch(`/api/cart/${productId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      fetchCart();
    }
  } catch (err) {
    console.error(err);
  }
}

async function updateCartQuantity(productId, quantity, button) {
  if (button) button.disabled = true;

  if (quantity < 1) {
    await removeFromCart(productId);
    return;
  }

  try {
    const res = await fetch(`/api/cart/${productId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ quantity }),
    });
    const data = await res.json();

    if (res.ok) {
      renderCart(data);
    } else {
      showToast(data.message || 'Could not update quantity');
      fetchCart();
    }
  } catch (error) {
    showToast('Error updating quantity');
    fetchCart();
  }
}

function renderCart(cart) {
  const container = document.getElementById('cart-items');
  let total = 0;
  let itemCount = 0;
  container.replaceChildren();
  
  if (!cart.items || cart.items.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.textContent = 'Your cart is empty.';
    container.appendChild(emptyMessage);
    cartLink.innerText = 'Cart (0)';
    document.getElementById('cart-total').innerText = '$0.00';
    return;
  }

  cart.items.forEach(item => {
    // Determine image
    let img = 'images/headphones.png'; 
    if (item.productId.name.toLowerCase().includes('watch')) img = 'images/smartwatch.png';
    if (item.productId.name.toLowerCase().includes('keyboard')) img = 'images/keyboard.png';

    const itemTotal = item.productId.price * item.quantity;
    total += itemTotal;
    itemCount += item.quantity;

    const el = document.createElement('article');
    el.className = 'cart-item glass-panel';

    const image = document.createElement('img');
    image.src = getProductImage(item.productId.name);
    image.alt = item.productId.name;

    const details = document.createElement('div');
    details.className = 'cart-item-details';

    const title = document.createElement('h3');
    title.textContent = item.productId.name;

    const price = document.createElement('p');
    price.className = 'cart-item-price';
    price.textContent = `$${Number(item.productId.price).toFixed(2)}`;

    const controls = document.createElement('div');
    controls.className = 'quantity-controls';

    const decrement = document.createElement('button');
    decrement.type = 'button';
    decrement.className = 'quantity-button';
    decrement.textContent = '−';
    decrement.setAttribute('aria-label', `Decrease ${item.productId.name} quantity`);
    decrement.addEventListener('click', () => updateCartQuantity(
      item.productId._id,
      item.quantity - 1,
      decrement
    ));

    const quantity = document.createElement('span');
    quantity.className = 'quantity-value';
    quantity.textContent = item.quantity;

    const increment = document.createElement('button');
    increment.type = 'button';
    increment.className = 'quantity-button';
    increment.textContent = '+';
    increment.disabled = item.quantity >= item.productId.stock;
    increment.setAttribute('aria-label', `Increase ${item.productId.name} quantity`);
    increment.addEventListener('click', () => updateCartQuantity(
      item.productId._id,
      item.quantity + 1,
      increment
    ));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeFromCart(item.productId._id));

    controls.append(decrement, quantity, increment, remove);
    details.append(title, price, controls);
    el.append(image, details);
    container.appendChild(el);
  });

  cartLink.innerText = `Cart (${itemCount})`;
  document.getElementById('cart-total').innerText = `$${total.toFixed(2)}`;
}

// Checkout
async function checkout() {
  if (!token) return;
  document.getElementById('checkout-btn').innerText = 'Processing...';
  
  try {
    const res = await fetch('/api/orders/checkout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await res.json();
    document.getElementById('checkout-btn').innerText = 'Checkout Securely';
    
    if (res.ok) {
      showToast('Order Placed Successfully! 🎉');
      fetchCart(); // Will empty out
      fetchProducts(); // Refresh stock
      fetchOrders();
    } else {
      showToast(data.message || 'Checkout Failed');
    }
  } catch (err) {
    document.getElementById('checkout-btn').innerText = 'Checkout Securely';
    showToast('Network error during checkout');
  }
}

async function fetchOrders() {
  if (!token) return;

  const orderList = document.getElementById('order-list');
  orderList.textContent = 'Loading orders...';

  try {
    const res = await fetch('/api/orders', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      orderList.textContent = data.message || 'Could not load orders.';
      return;
    }

    renderOrders(data);
  } catch (err) {
    orderList.textContent = 'Could not load orders.';
  }
}

function renderOrders(orders) {
  const orderList = document.getElementById('order-list');
  orderList.replaceChildren();

  if (!orders.length) {
    orderList.textContent = 'You have no orders yet.';
    return;
  }

  orders.forEach(order => {
    const card = document.createElement('article');
    card.className = 'order-card glass-panel';

    const heading = document.createElement('h3');
    heading.textContent = `Order ${String(order._id).slice(-8)}`;

    const meta = document.createElement('p');
    const orderDate = new Date(order.createdAt);
    const dateText = Number.isNaN(orderDate.getTime()) ? 'Date unavailable' : orderDate.toLocaleString();
    meta.textContent = `${dateText} · ${order.status} · Total $${Number(order.totalAmount).toFixed(2)}`;

    const items = document.createElement('ul');
    order.items.forEach(item => {
      const row = document.createElement('li');
      const name = item.productId && item.productId.name ? item.productId.name : 'Unavailable product';
      row.textContent = `${name} × ${item.quantity} · $${(Number(item.price) * Number(item.quantity)).toFixed(2)}`;
      items.appendChild(row);
    });

    card.append(heading, meta, items);
    orderList.appendChild(card);
  });
}

async function fetchAdminProducts(page = inventoryPage) {
  if (user?.role !== 'admin') return;

  const inventory = document.getElementById('inventory-list');
  inventory.textContent = 'Loading inventory...';

  try {
    const res = await fetch(`/api/products?page=${page}&limit=${productsPerPage}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const products = await res.json();
    if (!res.ok) throw new Error(products.message || 'Could not load inventory');

    inventoryPage = Number(res.headers.get('X-Page')) || page;
    inventoryTotalPages = Number(res.headers.get('X-Total-Pages')) || 1;
    updatePagination('inventory', inventoryPage, inventoryTotalPages);

    inventory.replaceChildren();
    products.forEach(product => {
      const row = document.createElement('article');
      row.className = 'inventory-row';

      const details = document.createElement('div');
      details.className = 'inventory-details';

      const name = document.createElement('h3');
      name.textContent = product.name;

      const meta = document.createElement('p');
      meta.textContent = `${product.category} · $${Number(product.price).toFixed(2)} · ${product.stock} in stock`;

      const actions = document.createElement('div');
      actions.className = 'inventory-actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'inventory-edit-button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => startAdminProductEdit(product));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteAdminProduct(product._id, remove));

      details.append(name, meta);
      actions.append(edit, remove);
      row.append(details, actions);
      inventory.appendChild(row);
    });

    if (!products.length) inventory.textContent = 'No products in inventory.';
  } catch (error) {
    inventory.textContent = error.message || 'Could not load inventory.';
  }
}

function startAdminProductEdit(product) {
  editingProductId = product._id;
  document.getElementById('admin-form-title').textContent = 'Edit product';
  document.getElementById('admin-save-button').textContent = 'Save changes';
  document.getElementById('admin-cancel-edit').hidden = false;
  document.getElementById('admin-name').value = product.name;
  document.getElementById('admin-price').value = product.price;
  document.getElementById('admin-category').value = product.category;
  document.getElementById('admin-stock').value = product.stock;
  document.getElementById('admin-description').value = product.description;
  document.getElementById('admin-name').focus();
}

function resetAdminProductForm() {
  editingProductId = null;
  document.getElementById('admin-product-form').reset();
  document.getElementById('admin-form-title').textContent = 'Add product';
  document.getElementById('admin-save-button').textContent = 'Create product';
  document.getElementById('admin-cancel-edit').hidden = true;
}

async function saveAdminProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const wasEditing = Boolean(editingProductId);
  const productId = editingProductId;
  const formData = new FormData(form);
  const product = {
    name: formData.get('name').trim(),
    price: Number(formData.get('price')),
    category: formData.get('category').trim(),
    stock: Number(formData.get('stock')),
    description: formData.get('description').trim(),
  };

  try {
    const res = await fetch(wasEditing ? `/api/products/${productId}` : '/api/products', {
      method: wasEditing ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(product),
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.message || 'Could not create product');
      return;
    }

    resetAdminProductForm();
    await refreshCategoryOptions();
    await fetchProducts(1);
    await fetchAdminProducts(wasEditing ? inventoryPage : 1);
    showToast(wasEditing ? 'Product updated' : 'Product created');
  } catch (error) {
    showToast('Network error while creating product');
  }
}

async function deleteAdminProduct(productId, button) {
  if (user?.role !== 'admin') return;
  button.disabled = true;

  try {
    const res = await fetch(`/api/products/${productId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) {
      button.disabled = false;
      showToast(data.message || 'Could not delete product');
      return;
    }

    if (editingProductId === productId) resetAdminProductForm();
    await refreshCategoryOptions();
    await fetchProducts(1);
    await fetchAdminProducts();
    showToast('Product deleted');
  } catch (error) {
    button.disabled = false;
    showToast('Network error while deleting product');
  }
}

function bindEvents() {
  document.querySelectorAll('[data-section]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      showSection(link.dataset.section);
    });
  });

  authLink.addEventListener('click', () => {
    if (token && user) logout();
    else toggleAuthModal();
  });
  document.getElementById('auth-btn').addEventListener('click', handleAuth);
  document.getElementById('auth-close').addEventListener('click', toggleAuthModal);
  document.getElementById('auth-mode-toggle').addEventListener('click', toggleAuthMode);
  document.getElementById('checkout-btn').addEventListener('click', checkout);
  document.getElementById('admin-product-form').addEventListener('submit', saveAdminProduct);
  document.getElementById('admin-cancel-edit').addEventListener('click', resetAdminProductForm);
  document.getElementById('refresh-inventory').addEventListener('click', fetchAdminProducts);
  document.getElementById('products-previous').addEventListener('click', () => fetchProducts(productPage - 1));
  document.getElementById('products-next').addEventListener('click', () => fetchProducts(productPage + 1));
  document.getElementById('inventory-previous').addEventListener('click', () => fetchAdminProducts(inventoryPage - 1));
  document.getElementById('inventory-next').addEventListener('click', () => fetchAdminProducts(inventoryPage + 1));

  productSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    productPage = 1;
    searchTimer = setTimeout(() => fetchProducts(1), 250);
  });
  categoryFilter.addEventListener('change', () => {
    productPage = 1;
    fetchProducts(1);
  });
}

function updatePagination(prefix, page, totalPages) {
  const pagination = document.getElementById(`${prefix}-pagination`);
  const previous = document.getElementById(`${prefix}-previous`);
  const next = document.getElementById(`${prefix}-next`);

  pagination.hidden = totalPages <= 1;
  document.getElementById(`${prefix}-page`).textContent = `Page ${page} of ${totalPages}`;
  previous.disabled = page <= 1;
  next.disabled = page >= totalPages;
}

// Utilities
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Boot
init();
