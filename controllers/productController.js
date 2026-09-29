const Product = require('../models/Product');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Fetch all products (with optional search)
// @route   GET /api/products
// @access  Public
const getProducts = async (req, res, next) => {
  try {
    const rawKeyword = req.query.keyword;
    if (rawKeyword !== undefined && (typeof rawKeyword !== 'string' || rawKeyword.length > 100)) {
      res.status(400);
      throw new Error('Search keyword must be 100 characters or fewer');
    }

    const requestedPage = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? 8 : Number(req.query.limit);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      res.status(400);
      throw new Error('Page must be a positive integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      res.status(400);
      throw new Error('Limit must be an integer between 1 and 50');
    }

    const normalizedKeyword = rawKeyword ? rawKeyword.trim() : '';
    const keyword = normalizedKeyword
      ? {
          name: {
            $regex: escapeRegex(normalizedKeyword),
            $options: 'i',
          },
        }
      : {};

    const category = req.query.category && req.query.category !== 'All'
      ? { category: req.query.category }
      : {};

    const filter = { ...keyword, ...category };
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalProducts / limit));
    const page = Math.min(requestedPage, totalPages);
    const products = await Product.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.set({
      'X-Page': String(page),
      'X-Limit': String(limit),
      'X-Total-Pages': String(totalPages),
      'X-Total-Products': String(totalProducts),
    });
    res.json(products);
  } catch (error) {
    next(error);
  }
};

// @desc    Fetch single product
// @route   GET /api/products/:id
// @access  Public
const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (product) {
      res.json(product);
    } else {
      res.status(404);
      throw new Error('Product not found');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = async (req, res, next) => {
  try {
    const { name, price, category, stock, description } = req.body;

    if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
      res.status(400);
      throw new Error('Price must be non-negative and stock must be a non-negative integer');
    }

    const product = new Product({
      name,
      price,
      category,
      stock,
      description,
    });

    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
  } catch (error) {
    next(error);
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = async (req, res, next) => {
  try {
    const { name, price, category, stock, description } = req.body;

    if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
      res.status(400);
      throw new Error('Price must be a non-negative number');
    }
    if (stock !== undefined && (!Number.isSafeInteger(stock) || stock < 0)) {
      res.status(400);
      throw new Error('Stock must be a non-negative integer');
    }

    const product = await Product.findById(req.params.id);

    if (product) {
      product.name = name || product.name;
      product.price = price !== undefined ? price : product.price;
      product.category = category || product.category;
      product.stock = stock !== undefined ? stock : product.stock;
      product.description = description || product.description;

      const updatedProduct = await product.save();
      res.json(updatedProduct);
    } else {
      res.status(404);
      throw new Error('Product not found');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (product) {
      await product.deleteOne();
      res.json({ message: 'Product removed' });
    } else {
      res.status(404);
      throw new Error('Product not found');
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  escapeRegex,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
