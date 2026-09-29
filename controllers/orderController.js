const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

// @desc    Checkout and create order
// @route   POST /api/orders/checkout
// @access  Private
const checkout = async (req, res, next) => {
  const deductedItems = [];
  let createdOrder;

  try {
    const cart = await Cart.findOne({ userId: req.user._id }).populate(
      'items.productId'
    );

    if (!cart || cart.items.length === 0) {
      res.status(400);
      throw new Error('No items in cart');
    }

    let totalAmount = 0;
    const orderItems = [];

    for (const item of cart.items) {
      const product = item.productId;
      if (!product || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        res.status(400);
        throw new Error('Cart contains an unavailable product or invalid quantity');
      }

      orderItems.push({
        productId: product._id,
        quantity: item.quantity,
        price: product.price,
      });
      totalAmount += product.price * item.quantity;
    }

    // Simulate Payment (80% success rate)
    const paymentSuccess = Math.random() < 0.8;

    if (!paymentSuccess) {
      res.status(400);
      throw new Error('Payment failed. Please try again.');
    }

    for (const item of orderItems) {
      const product = await Product.findOneAndUpdate(
        { _id: item.productId, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true, runValidators: true }
      );

      if (!product) {
        res.status(400);
        throw new Error('A product no longer has enough stock. Please review your cart.');
      }

      deductedItems.push(item);
    }

    const order = new Order({
      userId: req.user._id,
      items: orderItems,
      totalAmount,
      status: 'completed', // Payment is successful
    });

    createdOrder = await order.save();

    cart.items = [];
    await cart.save();

    res.status(201).json(createdOrder);
  } catch (error) {
    let rollbackFailed = false;

    if (createdOrder) {
      try {
        await Order.deleteOne({ _id: createdOrder._id });
      } catch (rollbackError) {
        rollbackFailed = true;
      }
    }

    for (const item of deductedItems.reverse()) {
      try {
        await Product.updateOne(
          { _id: item.productId },
          { $inc: { stock: item.quantity } }
        );
      } catch (rollbackError) {
        rollbackFailed = true;
      }
    }

    if (rollbackFailed) {
      console.error('Checkout compensation failed; inventory may need reconciliation');
      res.status(500);
      return next(new Error('Checkout failed and inventory rollback was incomplete'));
    }

    next(error);
  }
};

// @desc    Get logged in user orders
// @route   GET /api/orders
// @access  Private
const getUserOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ userId: req.user._id }).populate(
      'items.productId',
      'name price'
    );
    res.json(orders);
  } catch (error) {
    next(error);
  }
};

module.exports = { checkout, getUserOrders };
