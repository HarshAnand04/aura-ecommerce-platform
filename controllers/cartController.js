const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

// @desc    Get user cart
// @route   GET /api/cart
// @access  Private
const getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ userId: req.user._id }).populate(
      'items.productId',
      'name price stock'
    );

    if (!cart) {
      cart = await Cart.create({ userId: req.user._id, items: [] });
    }

    res.json(cart);
  } catch (error) {
    next(error);
  }
};

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      res.status(400);
      throw new Error('Quantity must be a positive whole number');
    }

    if (!mongoose.isValidObjectId(productId)) {
      res.status(400);
      throw new Error('Invalid product ID');
    }

    const product = await Product.findById(productId);
    if (!product) {
      res.status(404);
      throw new Error('Product not found');
    }

    if (quantity > product.stock) {
      res.status(400);
      throw new Error('Quantity exceeds available stock');
    }

    let cart = await Cart.findOne({ userId: req.user._id });

    if (!cart) {
      cart = new Cart({ userId: req.user._id, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId
    );

    if (existingItemIndex >= 0) {
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      if (newQuantity > product.stock) {
        res.status(400);
        throw new Error('Total quantity exceeds available stock');
      }
      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      cart.items.push({ productId, quantity });
    }

    await cart.save();
    res.json(cart);
  } catch (error) {
    next(error);
  }
};

// @desc    Set a cart item's quantity
// @route   PUT /api/cart/:productId
// @access  Private
const updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = req.body || {};
    const { productId } = req.params;

    if (!mongoose.isValidObjectId(productId)) {
      res.status(400);
      throw new Error('Invalid product ID');
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      res.status(400);
      throw new Error('Quantity must be a positive whole number');
    }

    const [product, cart] = await Promise.all([
      Product.findById(productId),
      Cart.findOne({ userId: req.user._id }),
    ]);

    if (!product) {
      res.status(404);
      throw new Error('Product not found');
    }
    if (!cart) {
      res.status(404);
      throw new Error('Cart not found');
    }
    if (quantity > product.stock) {
      res.status(400);
      throw new Error('Quantity exceeds available stock');
    }

    const item = cart.items.find((cartItem) => cartItem.productId.toString() === productId);
    if (!item) {
      res.status(404);
      throw new Error('Product is not in the cart');
    }

    item.quantity = quantity;
    await cart.save();

    const updatedCart = await Cart.findById(cart._id).populate(
      'items.productId',
      'name price stock'
    );
    res.json(updatedCart);
  } catch (error) {
    next(error);
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/:productId
// @access  Private
const removeFromCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });

    if (cart) {
      cart.items = cart.items.filter(
        (item) => item.productId.toString() !== req.params.productId
      );
      await cart.save();
      res.json(cart);
    } else {
      res.status(404);
      throw new Error('Cart not found');
    }
  } catch (error) {
    next(error);
  }
};

module.exports = { getCart, addToCart, updateCartItem, removeFromCart };
