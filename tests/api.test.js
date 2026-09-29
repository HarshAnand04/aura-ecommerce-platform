process.env.JWT_SECRET = 'test-secret-for-local-tests';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const expressApp = require('express');
const User = require('../models/User');
const Product = require('../models/Product');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const { registerUser, loginUser } = require('../controllers/userController');
const { protect, admin } = require('../middleware/authMiddleware');
const { escapeRegex, getProducts } = require('../controllers/productController');
const { addToCart, updateCartItem } = require('../controllers/cartController');
const { checkout, getUserOrders } = require('../controllers/orderController');
const productRouter = require('../routes/productRoutes');
const cartRouter = require('../routes/cartRoutes');
const { errorHandler: errorHandlerMiddleware } = require('../middleware/errorMiddleware');

function mockMethod(context, object, name, implementation) {
  const original = object[name];
  object[name] = implementation;
  context.after(() => {
    object[name] = original;
  });
}

function response() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      this.headers = { ...(this.headers || {}), ...headers };
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('registration ignores a requested admin role and normalizes email', async (context) => {
  let created;
  mockMethod(context, User, 'findOne', async () => null);
  mockMethod(context, User, 'create', async (values) => {
    created = values;
    return { _id: 'user-id', ...values };
  });

  const res = response();
  const errors = [];
  await registerUser({
    body: { name: ' Shop User ', email: ' USER@example.com ', password: 'secret1', role: 'admin' },
  }, res, (error) => errors.push(error));

  assert.equal(errors.length, 0);
  assert.equal(res.statusCode, 201);
  assert.equal(created.name, 'Shop User');
  assert.equal(created.email, 'user@example.com');
  assert.equal(created.role, 'user');
});

test('registration rejects malformed email and short passwords', async (context) => {
  let databaseCalls = 0;
  mockMethod(context, User, 'findOne', async () => {
    databaseCalls += 1;
    return null;
  });

  for (const body of [
    { name: 'A', email: 'not-an-email', password: 'secret1' },
    { name: 'A', email: 'a@example.com', password: '12345' },
  ]) {
    const res = response();
    let error;
    await registerUser({ body }, res, (nextError) => { error = nextError; });
    assert.equal(res.statusCode, 400);
    assert.ok(error);
  }

  assert.equal(databaseCalls, 0);
});

test('password save hook hashes new passwords and skips unchanged passwords', async () => {
  const user = new User({ name: 'Test', email: 'test@example.com', password: 'secret1' });
  const passwordHook = User.schema.s.hooks._pres.get('save')
    .find(({ fn }) => fn.toString().includes("isModified('password')")).fn;

  await passwordHook.call(user);
  const hashedPassword = user.password;
  assert.notEqual(hashedPassword, 'secret1');
  assert.equal(await user.matchPassword('secret1'), true);

  user.isModified = () => false;
  await passwordHook.call(user);
  assert.equal(user.password, hashedPassword);
});

test('auth rejects a token whose user no longer exists', async (context) => {
  mockMethod(context, User, 'findById', () => ({ select: async () => null }));
  const token = jwt.sign({ id: 'deleted-user' }, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = response();
  const errors = [];

  await protect(req, res, (error) => errors.push(error));

  assert.equal(res.statusCode, 401);
  assert.match(errors[0].message, /user no longer exists/);
  assert.equal(req.user, undefined);
});

test('admin middleware returns forbidden for non-admin users', () => {
  const res = response();
  let error;
  admin({ user: { role: 'user' } }, res, (nextError) => { error = nextError; });

  assert.equal(res.statusCode, 403);
  assert.match(error.message, /admin/);
});

test('search terms are escaped and treated as literals', async (context) => {
  const keyword = 'a.*[b]';
  let query;
  mockMethod(context, Product, 'countDocuments', async () => 1);
  mockMethod(context, Product, 'find', (filter) => {
    query = filter;
    return {
      sort() { return this; },
      skip() { return this; },
      limit() { return Promise.resolve([]); },
    };
  });
  const res = response();
  let error;

  await getProducts({ query: { keyword } }, res, (nextError) => { error = nextError; });

  assert.equal(error, undefined);
  assert.equal(query.name.$regex, escapeRegex(keyword));
  assert.equal(new RegExp(query.name.$regex).test(keyword), true);
  assert.equal(new RegExp(query.name.$regex).test('axxxb'), false);
});

test('product listing applies page offset and returns pagination headers', async (context) => {
  let skip;
  let limit;
  mockMethod(context, Product, 'countDocuments', async () => 25);
  mockMethod(context, Product, 'find', () => ({
    sort() { return this; },
    skip(value) { skip = value; return this; },
    limit(value) { limit = value; return Promise.resolve([{ name: 'Page two product' }]); },
  }));

  const res = response();
  await getProducts({ query: { page: '2', limit: '8' } }, res, (error) => { throw error; });

  assert.equal(skip, 8);
  assert.equal(limit, 8);
  assert.equal(res.headers['X-Page'], '2');
  assert.equal(res.headers['X-Limit'], '8');
  assert.equal(res.headers['X-Total-Pages'], '4');
  assert.equal(res.headers['X-Total-Products'], '25');
  assert.equal(res.body[0].name, 'Page two product');
});

test('product and cart routes enforce pagination, admin access, and stock limits over HTTP', async (context) => {
  const productId = new mongoose.Types.ObjectId();
  const cart = {
    _id: new mongoose.Types.ObjectId(),
    items: [{ productId, quantity: 1 }],
    save: async () => {},
  };
  const product = {
    _id: productId,
    name: 'Studio Mouse',
    price: 35,
    category: 'Peripherals',
    stock: 4,
    description: 'Wireless mouse',
    save: async function () { return this; },
  };
  let requestedSkip;

  mockMethod(context, User, 'findById', (id) => ({
    select: async () => ({
      _id: id,
      role: String(id) === 'admin-user' ? 'admin' : 'user',
    }),
  }));
  mockMethod(context, Product, 'countDocuments', async () => 25);
  mockMethod(context, Product, 'find', () => ({
    sort() { return this; },
    skip(value) { requestedSkip = value; return this; },
    limit() { return Promise.resolve([{ _id: productId, name: product.name }]); },
  }));
  mockMethod(context, Product, 'findById', async () => product);
  mockMethod(context, Cart, 'findOne', async () => cart);
  mockMethod(context, Cart, 'findById', () => ({ populate: async () => cart }));

  const app = expressApp();
  app.use(expressApp.json());
  app.use('/api/products', productRouter);
  app.use('/api/cart', cartRouter);
  app.use(errorHandlerMiddleware);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userToken = jwt.sign({ id: 'regular-user' }, process.env.JWT_SECRET);
  const adminToken = jwt.sign({ id: 'admin-user' }, process.env.JWT_SECRET);

  const pageResponse = await fetch(`${baseUrl}/api/products?page=2&limit=8`);
  assert.equal(pageResponse.status, 200);
  assert.equal(pageResponse.headers.get('x-page'), '2');
  assert.equal(pageResponse.headers.get('x-total-pages'), '4');
  assert.equal(requestedSkip, 8);

  const invalidPageResponse = await fetch(`${baseUrl}/api/products?page=0`);
  assert.equal(invalidPageResponse.status, 400);

  const forbiddenUpdate = await fetch(`${baseUrl}/api/products/${productId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ name: 'Unauthorized name' }),
  });
  assert.equal(forbiddenUpdate.status, 403);

  const allowedUpdate = await fetch(`${baseUrl}/api/products/${productId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name: 'Studio Mouse Pro', price: 45 }),
  });
  assert.equal(allowedUpdate.status, 200);
  assert.equal((await allowedUpdate.json()).name, 'Studio Mouse Pro');

  const cartUpdate = await fetch(`${baseUrl}/api/cart/${productId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ quantity: 3 }),
  });
  assert.equal(cartUpdate.status, 200);
  assert.equal((await cartUpdate.json()).items[0].quantity, 3);

  const overStockUpdate = await fetch(`${baseUrl}/api/cart/${productId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ quantity: 5 }),
  });
  assert.equal(overStockUpdate.status, 400);

  const anonymousCartUpdate = await fetch(`${baseUrl}/api/cart/${productId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 2 }),
  });
  assert.equal(anonymousCartUpdate.status, 401);
});

test('cart rejects fractional quantities before querying products', async (context) => {
  let productQueries = 0;
  mockMethod(context, Product, 'findById', async () => {
    productQueries += 1;
    return null;
  });
  const res = response();
  let error;

  await addToCart({ body: { productId: new mongoose.Types.ObjectId().toString(), quantity: 1.5 } }, res, (nextError) => { error = nextError; });

  assert.equal(res.statusCode, 400);
  assert.match(error.message, /whole number/);
  assert.equal(productQueries, 0);
});

test('cart quantity update saves a valid quantity within current stock', async (context) => {
  const productId = new mongoose.Types.ObjectId();
  let saved = false;
  const cart = {
    _id: new mongoose.Types.ObjectId(),
    items: [{ productId, quantity: 1 }],
    save: async () => { saved = true; },
  };
  mockMethod(context, Product, 'findById', async () => ({ stock: 4 }));
  mockMethod(context, Cart, 'findOne', async () => cart);
  mockMethod(context, Cart, 'findById', () => ({ populate: async () => cart }));

  const res = response();
  let error;
  await updateCartItem({
    params: { productId: productId.toString() },
    body: { quantity: 3 },
    user: { _id: new mongoose.Types.ObjectId() },
  }, res, (nextError) => { error = nextError; });

  assert.equal(error, undefined);
  assert.equal(saved, true);
  assert.equal(cart.items[0].quantity, 3);
  assert.equal(res.body, cart);
});

test('cart quantity update rejects quantities above current stock', async (context) => {
  const productId = new mongoose.Types.ObjectId();
  let saved = false;
  const cart = {
    items: [{ productId, quantity: 1 }],
    save: async () => { saved = true; },
  };
  mockMethod(context, Product, 'findById', async () => ({ stock: 2 }));
  mockMethod(context, Cart, 'findOne', async () => cart);

  const res = response();
  let error;
  await updateCartItem({
    params: { productId: productId.toString() },
    body: { quantity: 3 },
    user: { _id: new mongoose.Types.ObjectId() },
  }, res, (nextError) => { error = nextError; });

  assert.equal(res.statusCode, 400);
  assert.match(error.message, /exceeds available stock/);
  assert.equal(saved, false);
});

function checkoutCart() {
  return {
    items: [
      { productId: { _id: new mongoose.Types.ObjectId(), name: 'First', price: 10 }, quantity: 2 },
      { productId: { _id: new mongoose.Types.ObjectId(), name: 'Second', price: 5 }, quantity: 1 },
    ],
    save: async () => {},
  };
}

function mockCheckoutCart(context, cart) {
  mockMethod(context, Cart, 'findOne', () => ({ populate: async () => cart }));
}

test('checkout uses conditional stock deduction and rolls back if a later item is unavailable', async (context) => {
  const cart = checkoutCart();
  mockCheckoutCart(context, cart);
  const deductions = [];
  const rollbacks = [];
  mockMethod(context, Product, 'findOneAndUpdate', async (filter, update) => {
    deductions.push({ filter, update });
    return deductions.length === 1 ? {} : null;
  });
  mockMethod(context, Product, 'updateOne', async (filter, update) => {
    rollbacks.push({ filter, update });
  });
  mockMethod(context, Math, 'random', () => 0.1);

  const res = response();
  let error;
  await checkout({ user: { _id: new mongoose.Types.ObjectId() } }, res, (nextError) => { error = nextError; });

  assert.equal(res.statusCode, 400);
  assert.match(error.message, /no longer has enough stock/);
  assert.equal(deductions.length, 2);
  assert.equal(deductions[0].filter.stock.$gte, 2);
  assert.equal(deductions[0].update.$inc.stock, -2);
  assert.equal(rollbacks.length, 1);
  assert.equal(String(rollbacks[0].filter._id), String(cart.items[0].productId._id));
  assert.equal(rollbacks[0].update.$inc.stock, 2);
});

test('checkout restores inventory and removes the order if clearing the cart fails', async (context) => {
  const cart = checkoutCart();
  cart.save = async () => { throw new Error('cart save failed'); };
  mockCheckoutCart(context, cart);
  const deductions = [];
  const rollbacks = [];
  const deletedOrders = [];
  mockMethod(context, Product, 'findOneAndUpdate', async (filter) => {
    deductions.push(filter);
    return {};
  });
  mockMethod(context, Product, 'updateOne', async (filter, update) => {
    rollbacks.push({ filter, update });
  });
  mockMethod(context, Order.prototype, 'save', async function () { return { _id: 'created-order' }; });
  mockMethod(context, Order, 'deleteOne', async (filter) => { deletedOrders.push(filter); });
  mockMethod(context, Math, 'random', () => 0.1);

  const res = response();
  let error;
  await checkout({ user: { _id: new mongoose.Types.ObjectId() } }, res, (nextError) => { error = nextError; });

  assert.match(error.message, /cart save failed/);
  assert.equal(deductions.length, 2);
  assert.equal(rollbacks.length, 2);
  assert.equal(deletedOrders[0]._id, 'created-order');
});

test('order history returns only the signed-in user orders', async (context) => {
  const orders = [{ _id: 'order-1' }];
  let filter;
  mockMethod(context, Order, 'find', (query) => {
    filter = query;
    return { populate: async () => orders };
  });
  const res = response();

  await getUserOrders({ user: { _id: 'user-1' } }, res, (error) => { throw error; });

  assert.deepEqual(filter, { userId: 'user-1' });
  assert.deepEqual(res.body, orders);
});
if (process.env.RUN_DB_INTEGRATION_TESTS === '1') {
const dotenv = require('dotenv');
dotenv.config();

const testMongoUri = process.env.TEST_MONGO_URI;
const testDatabaseName = testMongoUri && testMongoUri.match(/\/([^/?]+)(?:\?|$)/)?.[1];
if (!testDatabaseName || !/test/i.test(testDatabaseName)) {
  throw new Error('Set TEST_MONGO_URI to a dedicated database with "test" in its name');
}
process.env.MONGO_URI = testMongoUri;

// Require server modules
const express = require('express');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { notFound, errorHandler } = require('../middleware/errorMiddleware');
const userRoutes = require('../routes/userRoutes');
const productRoutes = require('../routes/productRoutes');
const cartRoutes = require('../routes/cartRoutes');
const orderRoutes = require('../routes/orderRoutes');
const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use(notFound);
app.use(errorHandler);

let server;
let baseUrl;
let createdUserId;
let createdProductId;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING COMPREHENSIVE AURA TEST SUITE');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    await connectDB();
    
    server = app.listen(0, async () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Ephemeral test server running on port ${port}\n`);

      try {
        const userCreds = {
          name: 'Test User',
          email: `testuser-${Date.now()}@aura.test`,
          password: 'password123',
          role: 'admin' // Attempt privilege escalation
        };

        console.log('[1. Authentication & Security Tests]');
        
        // Invalid email format test
        const invalidEmailRes = await request('/api/users/register', {
          method: 'POST',
          body: JSON.stringify({ name: 'Bob', email: 'bob', password: 'password123' })
        });
        assert(invalidEmailRes.status === 400, 'Rejects invalid email format with 400');

        // Invalid password test
        const invalidPassRes = await request('/api/users/register', {
          method: 'POST',
          body: JSON.stringify({ name: 'Bob', email: 'bob@example.com', password: '123' })
        });
        assert(invalidPassRes.status === 400, 'Rejects password shorter than 6 characters with 400');

        // Valid registration
        const regRes = await request('/api/users/register', {
          method: 'POST',
          body: JSON.stringify(userCreds)
        });
        assert(regRes.status === 201, 'Registration succeeds');
        assert(regRes.data.role === 'user', 'Role escalation thwarted: User role is strictly "user"');
        createdUserId = regRes.data._id;

        const loginRes = await request('/api/users/login', {
          method: 'POST',
          body: JSON.stringify({ email: userCreds.email, password: userCreds.password })
        });
        assert(loginRes.status === 200, 'Login succeeds with valid credentials');
        assert(loginRes.data.token, 'Returns valid JWT token');
        
        const userToken = loginRes.data.token;

        console.log('\n[2. Search & Sanitization Tests]');
        const searchRes = await request('/api/products?keyword=([a-z]+)*');
        assert(searchRes.status === 200, 'Unescaped regex query handled safely without server crash or 500 error');

        // Create a test product directly via DB
        const product = await Product.create({
          name: 'Test Product',
          description: 'A test product',
          price: 99.99,
          stock: 5,
          category: 'Electronics'
        });
        createdProductId = product._id;

        console.log('\n[3. Cart & Validation Tests]');
        // Add to cart with negative quantity
        const negCartRes = await request('/api/cart', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${userToken}` },
          body: JSON.stringify({ productId: product._id, quantity: -1 })
        });
        assert(negCartRes.status === 400, 'Rejects negative cart quantity with 400');

        // Add valid quantity
        const cartRes = await request('/api/cart', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${userToken}` },
          body: JSON.stringify({ productId: product._id, quantity: 2 })
        });
        assert(cartRes.status === 200 || cartRes.status === 201, 'Adds valid quantity to cart');

        console.log('\n[4. Atomic Checkout & Stock Handling Tests]');
        const originalRandom = Math.random;
        Math.random = () => 0.1;
        let checkoutRes;
        try {
          checkoutRes = await request('/api/orders/checkout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${userToken}` },
          });
        } finally {
          Math.random = originalRandom;
        }
        assert(checkoutRes.status === 201, 'Checkout completes and creates order');

        const updatedProduct = await Product.findById(product._id);
        assert(updatedProduct.stock === 3, `Stock atomically decremented from 5 to 3 (actual: ${updatedProduct.stock})`);

        console.log('\n[5. Order History Tests]');
        const historyRes = await request('/api/orders', {
          headers: { 'Authorization': `Bearer ${userToken}` }
        });
        assert(historyRes.status === 200 && historyRes.data.length > 0, 'User can fetch order history');

      } catch (err) {
        console.error('Test execution failed:', err);
        failed++;
      } finally {
        try {
          if (createdUserId) {
            await Cart.deleteMany({ userId: createdUserId });
            await Order.deleteMany({ userId: createdUserId });
            await User.deleteOne({ _id: createdUserId });
          }
          if (createdProductId) await Product.deleteOne({ _id: createdProductId });
          await mongoose.disconnect();
        } catch (cleanupError) {
          console.error('Test cleanup failed:', cleanupError);
          failed++;
        }
        server.close();
        
        console.log('\n=============================================');
        console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
        console.log('=============================================\n');
        
        process.exit(failed > 0 ? 1 : 0);
      }
    });
  } catch (err) {
    console.error('Test initialization failed:', err);
    process.exit(1);
  }
}

runTests();
}
